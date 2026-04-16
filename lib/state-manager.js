'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSchemaValidator } = require('./schema-validator');

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';
const ARTIFACT_KEYS = new Set(['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal']);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const unique = `${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = `${filePath}.${unique}.tmp`;
  const bakPath = `${filePath}.bak`;

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');

    // Windows-safe replace with best-effort durability:
    // - If target exists, move it to .bak first (keeps a last-known-good copy)
    // - Move tmp into place
    // - Remove .bak
    if (fs.existsSync(filePath)) {
      try {
        if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
      } catch {
        // ignore
      }
      fs.renameSync(filePath, bakPath);
    }

    fs.renameSync(tmpPath, filePath);

    if (fs.existsSync(bakPath)) {
      try {
        fs.unlinkSync(bakPath);
      } catch {
        // ignore cleanup errors
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    // Attempt rollback if we moved the original aside.
    try {
      if (!fs.existsSync(filePath) && fs.existsSync(bakPath)) {
        fs.renameSync(bakPath, filePath);
      }
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  const hex = crypto.createHash('sha256').update(bytes).digest('hex');
  return `sha256:${hex}`;
}

function getPaths(projectRoot) {
  const root = projectRoot || process.cwd();
  const sdlcDir = path.join(root, SDLC_DIR);
  const statePath = path.join(sdlcDir, STATE_FILE);
  return { projectRoot: root, sdlcDir, statePath };
}

function initProject(projectName, clientName, options = {}) {
  const { projectRoot = process.cwd() } = options;
  const { statePath } = getPaths(projectRoot);

  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    throw new Error('initProject requires a non-empty projectName');
  }
  if (typeof clientName !== 'string' || clientName.trim().length === 0) {
    throw new Error('initProject requires a non-empty clientName');
  }

  const now = new Date().toISOString();

  const state = {
    $schema: '../schemas/sdlc-state.schema.json',
    projectId: crypto.randomUUID(),
    projectName: projectName.trim(),
    clientName: clientName.trim(),
    currentPhase: 'discovery',
    phaseHistory: [{ phase: 'discovery', startedAt: now, completedAt: null }],
    artifacts: {
      scope: null,
      srs: null,
      sds: null,
      sts: null,
      estimate: null,
      proposal: null
    },
    requirements: [],
    designComponents: [],
    testCases: [],
    complianceFlags: [],
    traceabilityMatrix: {}
  };

  saveState(state, { projectRoot });
  return state;
}

function loadState(options = {}) {
  const { projectRoot = process.cwd() } = options;
  const { statePath } = getPaths(projectRoot);

  try {
    if (!fs.existsSync(statePath)) {
      const err = new Error(`State file not found: ${statePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return readJson(statePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') throw err;
    const e = new Error(`Failed to parse state.json at ${statePath}: ${err.message}`);
    e.code = 'EINVALIDJSON';
    throw e;
  }
}

function saveState(state, options = {}) {
  const { projectRoot = process.cwd(), repoRoot } = options;
  const { statePath } = getPaths(projectRoot);

  // Strip internal runtime-only keys (prefixed with _) that are injected by hooks
  // at session start (e.g. _statePath from sdlc-session-start.js) and must never
  // be persisted to disk or passed to schema validation.
  const toWrite = Object.fromEntries(Object.entries(state).filter(([k]) => !k.startsWith('_')));

  const validator = createSchemaValidator({ repoRoot });
  validator.assertValid(toWrite, 'state');

  writeJsonAtomic(statePath, toWrite);
}

function loadOrInit(projectName, clientName, options = {}) {
  try {
    return loadState(options);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return initProject(projectName, clientName, options);
    }
    throw err;
  }
}

function updatePhase(state, newPhase) {
  const now = new Date().toISOString();
  const prevPhase = state.currentPhase;

  const prevHistory = Array.isArray(state.phaseHistory) ? state.phaseHistory : [];
  const updatedHistory = prevHistory.map(entry => {
    if (entry && entry.phase === prevPhase && !entry.completedAt) {
      return { ...entry, completedAt: now };
    }
    return entry;
  });

  updatedHistory.push({ phase: newPhase, startedAt: now, completedAt: null });

  return {
    ...state,
    currentPhase: newPhase,
    phaseHistory: updatedHistory
  };
}

function registerArtifact(state, type, filePath) {
  if (!type || typeof type !== 'string') {
    throw new Error('Artifact type must be a non-empty string');
  }
  if (!ARTIFACT_KEYS.has(type)) {
    throw new Error(`Artifact type must be one of: ${Array.from(ARTIFACT_KEYS).join(', ')}`);
  }
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Artifact filePath must be a non-empty string');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Artifact file not found: ${filePath}`);
  }

  const artifacts = state.artifacts && typeof state.artifacts === 'object' ? state.artifacts : {};
  const prev = artifacts[type] || null;
  const prevVersion = prev && typeof prev.version === 'number' ? prev.version : 0;
  const nextVersion = prevVersion + 1;

  const now = new Date().toISOString();
  const hash = sha256File(filePath);

  // Prefer storing paths relative to the project root when possible, to keep
  // hooks and phase-gates portable across machines.
  const projectRoot = process.cwd();
  const resolved = path.resolve(filePath);
  const relative = path.relative(projectRoot, resolved);
  const storedPath = !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : resolved.split(path.sep).join('/');

  const nextArtifact = {
    path: storedPath,
    version: nextVersion,
    hash,
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
    // Preserve accumulated versionHistory — never discard prior rows.
    // Pipeline commands append their own entry; document-version.js appends minor-increment entries.
    versionHistory: prev && Array.isArray(prev.versionHistory) ? prev.versionHistory : [],
    // Preserve schemaId and templateId if already stamped on the prior artifact
    ...(prev && prev.schemaId ? { schemaId: prev.schemaId } : {}),
    ...(prev && prev.templateId ? { templateId: prev.templateId } : {})
  };

  return {
    ...state,
    artifacts: {
      ...artifacts,
      [type]: nextArtifact
    }
  };
}

module.exports = {
  initProject,
  loadState,
  loadOrInit,
  saveState,
  updatePhase,
  registerArtifact
};
