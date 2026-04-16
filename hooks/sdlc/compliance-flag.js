#!/usr/bin/env node
'use strict';

/**
 * SDLC Compliance Flag Hook — PostToolUse (Write | Edit)
 *
 * Event: PostToolUse — fires after every Write or Edit tool call.
 *
 * Scans the content just written against regulatory keyword lists in
 * frameworks/*.json. For every keyword match found, appends a structured
 * flag to .sdlc/state.json complianceFlags[] so the /compliance command
 * and /sdlc-status dashboard always reflect in-session edits.
 *
 * Scope: only files inside .sdlc/ — ignores all other writes.
 *
 * Exit code: always 0 — warning-only hook, never blocks a write.
 *
 * Cross-platform: Windows, macOS, Linux.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Logging — stderr only (stdout reserved for structured hook output)
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(`[SDLC-ComplianceFlag] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Stdin / payload
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scope guard — only scan files inside .sdlc/
// ---------------------------------------------------------------------------

function isInScope(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  // Match any write inside .sdlc/ (state, artifacts, tmp)
  return /(^|\/)\.sdlc\//.test(normalized);
}

// ---------------------------------------------------------------------------
// Binary file guard — skip .docx / .xlsx / .pdf / .png / .svg
// ---------------------------------------------------------------------------

const BINARY_EXTS = new Set(['.docx', '.xlsx', '.pdf', '.png', '.svg', '.jpg', '.jpeg']);

function isBinary(filePath) {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Framework loading
// ---------------------------------------------------------------------------

/**
 * Find the ECC root by reading eccRoot from .sdlc/state.json in cwd,
 * or fall back to the CLAUDE_PLUGIN_ROOT env var.
 */
function findEccRoot(projectRoot) {
  // Try state.json first (fastest)
  const stateFile = path.join(projectRoot, '.sdlc', 'state.json');
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (s && s.eccRoot && typeof s.eccRoot === 'string') return s.eccRoot.trim();
  } catch {
    /* ignore */
  }

  // Fall back to env var
  const envRoot = (process.env.CLAUDE_PLUGIN_ROOT || '').trim();
  if (envRoot) return envRoot;

  return null;
}

/**
 * Load all framework files from {eccRoot}/frameworks/*.json.
 * Returns an array of { frameworkId, controls[] }.
 * Returns [] if the directory doesn't exist or can't be read.
 */
function loadFrameworks(eccRoot) {
  if (!eccRoot) return [];
  const fwDir = path.join(eccRoot, 'frameworks');
  if (!fs.existsSync(fwDir)) return [];

  const frameworks = [];
  try {
    const files = fs.readdirSync(fwDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const fw = JSON.parse(fs.readFileSync(path.join(fwDir, file), 'utf8'));
        if (fw && fw.frameworkId && Array.isArray(fw.controls)) {
          frameworks.push(fw);
        }
      } catch {
        /* skip malformed framework file */
      }
    }
  } catch {
    /* ignore */
  }

  return frameworks;
}

// ---------------------------------------------------------------------------
// Keyword scanner
// ---------------------------------------------------------------------------

/**
 * Scan text against all framework controls.
 * Returns an array of match objects.
 *
 * @param {string} text
 * @param {{ frameworkId: string, controls: Array }[]} frameworks
 * @returns {{ frameworkCode, controlId, controlTitle, keyword, severity }[]}
 */
function scanForKeywords(text, frameworks) {
  if (!text || !text.trim()) return [];
  const lower = text.toLowerCase();
  const matches = [];
  const seen = new Set(); // deduplicate frameworkCode+controlId combos

  for (const fw of frameworks) {
    for (const control of fw.controls) {
      if (!Array.isArray(control.keywords)) continue;
      for (const keyword of control.keywords) {
        if (typeof keyword !== 'string') continue;
        if (lower.includes(keyword.toLowerCase())) {
          const key = `${fw.frameworkId}::${control.controlId}`;
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              frameworkCode: fw.frameworkId,
              controlId: control.controlId,
              controlTitle: control.title || '',
              keyword: keyword,
              severity: control.severity || 'medium',
              requiredEvidence: Array.isArray(control.requiredEvidence) ? control.requiredEvidence : []
            });
          }
          break; // one keyword match per control is enough
        }
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// State read / write
// ---------------------------------------------------------------------------

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(statePath, state) {
  try {
    const { writeJsonAtomic } = require('../../scripts/sdlc/utils/state-writer');
    writeJsonAtomic(statePath, state);
    return true;
  } catch (e) {
    log(`Could not write state: ${e.message}`);
    return false;
  }
}

/**
 * Merge new flags into state.complianceFlags[] using
 * (frameworkCode + controlId) as the composite key.
 * Never duplicates — updates status/detectedAt if already present.
 */
function mergeFlags(existing, newFlags, filePath) {
  const result = Array.isArray(existing) ? [...existing] : [];
  const now = new Date().toISOString();
  const basename = path.basename(filePath);

  for (const match of newFlags) {
    const key = match.frameworkCode + '::' + match.controlId;
    const idx = result.findIndex(f => f.frameworkCode === match.frameworkCode && f.controlId === match.controlId);

    const flag = {
      frameworkCode: match.frameworkCode,
      controlId: match.controlId,
      controlTitle: match.controlTitle,
      triggeredBy: basename,
      keyword: match.keyword,
      severity: match.severity,
      requiredEvidence: match.requiredEvidence,
      status: 'pending-review',
      detectedAt: now
    };

    if (idx === -1) {
      result.push(flag);
    } else {
      // Update detectedAt and triggeredBy; keep the rest
      result[idx] = { ...result[idx], detectedAt: now, triggeredBy: basename };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const raw = readStdin();
  const payload = safeJsonParse(raw);

  // Claude Code PostToolUse payload: { cwd, tool_name, tool_input: { file_path, content? } }
  const toolInput = (payload && payload.tool_input) || {};
  const rawFilePath = toolInput.file_path || toolInput.path || '';

  if (!rawFilePath) {
    process.exit(0);
  }

  const cwd = (payload && typeof payload.cwd === 'string' && payload.cwd) || process.cwd();
  const resolvedPath = path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(cwd, rawFilePath);

  // Scope guard
  if (!isInScope(resolvedPath)) {
    process.exit(0);
  }

  // Binary guard
  if (isBinary(resolvedPath)) {
    process.exit(0);
  }

  // Read the content that was just written
  let content = '';
  // Claude Code sometimes passes content directly in the payload; otherwise read from disk.
  if (typeof toolInput.content === 'string') {
    content = toolInput.content;
  } else {
    try {
      content = fs.readFileSync(resolvedPath, 'utf8');
    } catch {
      process.exit(0);
    }
  }

  if (!content.trim()) {
    process.exit(0);
  }

  // Find ECC root
  const eccRoot = findEccRoot(cwd);
  if (!eccRoot) {
    log('eccRoot not found — skipping compliance scan (run /scope first)');
    process.exit(0);
  }

  // Load frameworks
  const frameworks = loadFrameworks(eccRoot);
  if (frameworks.length === 0) {
    log('No framework files found in ' + path.join(eccRoot, 'frameworks'));
    process.exit(0);
  }

  // Scan content
  const matches = scanForKeywords(content, frameworks);
  if (matches.length === 0) {
    process.exit(0);
  }

  // Load state
  const statePath = path.join(cwd, '.sdlc', 'state.json');
  const state = loadState(statePath);
  if (!state) {
    log('state.json not found — skipping compliance flag write');
    process.exit(0);
  }

  // Merge flags
  const merged = mergeFlags(state.complianceFlags, matches, resolvedPath);
  state.complianceFlags = merged;

  // Save state
  if (saveState(statePath, state)) {
    const newCount = matches.length;
    log(`Flagged ${newCount} regulatory keyword match(es) in ${path.basename(resolvedPath)}: ` + matches.map(m => `${m.frameworkCode}/${m.controlId}`).join(', '));
  }

  process.exit(0);
}

main();
