#!/usr/bin/env node
'use strict';

/**
 * SDLC Document Version Hook
 *
 * Event: Stop (fires after every Claude response)
 *
 * Compares current on-disk SHA-256 hashes of registered SDLC artifacts against
 * hashes captured at session start in .sdlc/.session-hashes.json (written by
 * sdlc-session-start.js). For any artifact whose hash changed:
 *   1. Increments the artifact version by 0.1 (minor increment)
 *   2. Updates hash in state.json to reflect current file
 *   3. Updates updatedAt timestamp
 *   4. Appends a new row to artifact's versionHistory[] (cumulative log)
 *
 * Version numbering:
 *   Pipeline commands do MAJOR increments (1 → 2) when they regenerate an artifact.
 *   This hook does MINOR increments (1.0 → 1.1 → 1.2) for in-session edits.
 *   Version is stored as a float: 1.0, 1.1, 1.2, 2.0, 2.1, ...
 *
 * Falls back to comparing against state.json hashes if no session snapshot exists.
 * Never blocks the session — always exits 0.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';
const SNAPSHOT_FILE = '.session-hashes.json';
const ARTIFACT_KEYS = ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal'];
const MAX_STDIN = 1024 * 1024;

function log(msg) {
  process.stderr.write(`[SDLC-DocumentVersion] ${msg}\n`);
}

function findStateFile() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, SDLC_DIR, STATE_FILE);
    if (fs.existsSync(c)) return c;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return null;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(statePath, state) {
  try {
    const { writeJsonAtomic } = require('../../scripts/sdlc/utils/state-writer');
    writeJsonAtomic(statePath, state);
    return true;
  } catch (e) {
    log(`Could not write state: ${e.message}`);
    return false;
  }
}

function hashFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function resolveArtifactPath(projectRoot, artifact) {
  if (!artifact || typeof artifact.path !== 'string' || !artifact.path.trim()) return null;
  const p = artifact.path.trim();
  const resolved = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
  const root = path.resolve(projectRoot) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

/**
 * Increment version by 0.1 (minor), rounded to 1 decimal.
 * Examples: 1 → 1.1, 1.9 → 2.0, 2.1 → 2.2
 */
function incrementVersion(current) {
  const v = typeof current === 'number' ? current : parseFloat(current) || 0;
  return Math.round((v + 0.1) * 10) / 10;
}

function buildVersionHistory(artifact, newVersion, today, key) {
  const prior = Array.isArray(artifact.versionHistory) ? artifact.versionHistory : [];
  const row = {
    version: newVersion.toFixed(1),
    date: today,
    author: 'ECC-SDLC (auto)',
    changes: `${key.toUpperCase()} artifact modified during session — minor version increment by document-version hook`
  };
  if (key === 'sds') row.status = 'Draft';
  return [...prior, row];
}

async function main() {
  const statePath = findStateFile();
  if (!statePath) {
    log('No .sdlc/state.json — skipping');
    process.exit(0);
  }

  const state = readJson(statePath);
  if (!state) {
    log('State unreadable — skipping');
    process.exit(0);
  }

  log(`Project: ${state.projectName || 'unknown'} | Phase: ${state.currentPhase || 'unknown'}`);

  const sdlcDir = path.dirname(statePath);
  const projectRoot = path.dirname(sdlcDir);
  const artifacts = state.artifacts || {};
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // Read session-start snapshot (preferred) or fall back to state.json hashes
  const snapRaw = readJson(path.join(sdlcDir, SNAPSHOT_FILE));
  const snapshot = snapRaw && snapRaw.hashes ? snapRaw.hashes : null;
  log(snapshot ? `Using session snapshot (${Object.keys(snapshot).length} artifact(s))` : 'No session snapshot — using state.json hashes (fallback)');

  let modified = 0;

  for (const key of ARTIFACT_KEYS) {
    const artifact = artifacts[key];
    if (!artifact || !artifact.path) continue;

    const fullPath = resolveArtifactPath(projectRoot, artifact);
    if (!fullPath || !fs.existsSync(fullPath)) {
      log(`${key}: not on disk — skipping`);
      continue;
    }

    const diskHash = hashFile(fullPath);
    if (!diskHash) {
      log(`${key}: could not hash — skipping`);
      continue;
    }

    const baselineHash = snapshot && snapshot[key] ? snapshot[key].hash : artifact.hash;
    if (!baselineHash) {
      log(`${key}: no baseline hash — skipping`);
      continue;
    }

    if (diskHash === baselineHash) {
      log(`${key}: unchanged`);
      continue;
    }

    const current = typeof artifact.version === 'number' ? artifact.version : parseFloat(artifact.version) || 0;
    const newVersion = incrementVersion(current);

    log(`${key}: MODIFIED v${current.toFixed(1)} → v${newVersion.toFixed(1)}`);

    artifacts[key] = {
      ...artifact,
      version: newVersion,
      hash: diskHash,
      updatedAt: nowIso,
      versionHistory: buildVersionHistory(artifact, newVersion, today, key)
    };
    modified++;
  }

  if (modified === 0) {
    log('No changes detected');
    try {
      fs.unlinkSync(path.join(sdlcDir, SNAPSHOT_FILE));
    } catch {
      /**/
    }
    process.exit(0);
  }

  writeState(statePath, { ...state, artifacts, lastSavedAt: nowIso });
  log(`${modified} artifact(s) version-incremented`);
  try {
    fs.unlinkSync(path.join(sdlcDir, SNAPSHOT_FILE));
  } catch {
    /**/
  }
  process.exit(0);
}

let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => {
  if (stdinBuf.length < MAX_STDIN) stdinBuf += c;
});
process.stdin.on('end', () => {
  main().catch(e => {
    log(`ERROR: ${e.message}`);
    process.exit(0);
  });
});
