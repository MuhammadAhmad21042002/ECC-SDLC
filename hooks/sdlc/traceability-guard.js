#!/usr/bin/env node
/**
 * SDLC Traceability Guard Hook — PostToolUse (Write | Edit)
 *
 * Event: PostToolUse — fires after every Write or Edit tool call.
 *
 * Proposal spec (§6.2):
 *   "Scans written content for REQ-FUNC/NFUNC/CON patterns. Warns if any
 *    H2/H3 section in SDS/STS files lacks at least one requirement reference."
 *
 * Implementation note:
 *   The SDS/STS pipeline produces .docx artifacts via generate-sds-doc.js
 *   called through spawnSync — NOT via Claude's Write tool. The Write tool
 *   is used for JSON files: state.json, tmp/sds-data.json,
 *   tmp/design-components.json. This hook checks those JSON writes for
 *   traceability gaps — equivalent to the proposal's "H2/H3 section check"
 *   in a JSON-based pipeline.
 *
 * Scope: any write to a .json file inside .sdlc/
 *
 * Checks performed (warning-only — never blocks):
 *   1. state.json: any designComponent with empty requirementIds
 *   2. state.json: any must-requirement with empty traceForward.designComponentIds
 *      when currentPhase is design or later
 *   3. tmp/sds-data.json: any traceabilityMatrixRows entry with empty designComponentIds
 *   4. tmp/design-components.json: any DC with empty requirementIds
 *
 * Exit code: always 0 — warning-only, never blocks a write.
 *
 * Cross-platform: Windows, macOS, Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function warn(msg) {
  process.stderr.write(`[TRACEABILITY] ${msg}\n`);
}

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
// Scope check
// ---------------------------------------------------------------------------

/**
 * Returns true only when filePath refers to an SDS or STS artifact inside the
 * .sdlc/artifacts/ directory. Handles both absolute and relative paths and
 * normalises Windows backslashes before matching.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isInScope(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const n = filePath.replace(/\\/g, '/');
  return /(^|\/)\.sdlc\//.test(n) && n.endsWith('.json');
}

function checkType(normalized) {
  if (/(^|\/)\.sdlc\/state\.json$/.test(normalized)) return 'state';
  if (/(^|\/)\.sdlc\/tmp\/sds-data\.json$/.test(normalized)) return 'sds-data';
  if (/(^|\/)\.sdlc\/tmp\/design-components\.json$/.test(normalized)) return 'design-components';
  return null;
}

function checkStateJson(filePath) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return;
  }

  const DCs = Array.isArray(state.designComponents) ? state.designComponents : [];
  const reqs = Array.isArray(state.requirements) ? state.requirements : [];
  const phase = typeof state.currentPhase === 'string' ? state.currentPhase : '';

  for (const dc of DCs) {
    const id = dc && typeof dc.id === 'string' ? dc.id : '(unknown)';
    const rIds = dc && Array.isArray(dc.requirementIds) ? dc.requirementIds : [];
    if (rIds.length === 0) {
      warn(`DC ${id} has no requirementIds — traceability gap`);
    }
  }

  const designPhases = ['design', 'test-planning', 'estimation', 'compliance', 'proposal', 'handoff'];
  if (designPhases.includes(phase)) {
    for (const req of reqs) {
      if (!req || req.priority !== 'must') continue;
      const id = typeof req.id === 'string' ? req.id : '(unknown)';
      const dcIds = req.traceForward && Array.isArray(req.traceForward.designComponentIds) ? req.traceForward.designComponentIds : [];
      if (dcIds.length === 0) {
        warn(`must-requirement ${id} has no designComponentIds — traceability gap`);
      }
    }
  }
}

function checkSdsDataJson(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return;
  }

  const rows = Array.isArray(data.traceabilityMatrixRows) ? data.traceabilityMatrixRows : [];
  for (const row of rows) {
    const reqId = row && typeof row.reqId === 'string' ? row.reqId : '(unknown)';
    const dcIds = row && Array.isArray(row.designComponentIds) ? row.designComponentIds : [];
    if (dcIds.length === 0) {
      warn(`traceabilityMatrixRows: ${reqId} has no designComponentIds — traceability gap`);
    }
  }
}

function checkDesignComponentsJson(filePath) {
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(arr)) return;

  for (const dc of arr) {
    const id = dc && typeof dc.id === 'string' ? dc.id : '(unknown)';
    const rIds = dc && Array.isArray(dc.requirementIds) ? dc.requirementIds : [];
    if (rIds.length === 0) {
      warn(`DC ${id} has no requirementIds — traceability gap`);
    }
  }
}

function main() {
  const raw = readStdin();
  const payload = safeJsonParse(raw);

  const toolInput = (payload && payload.tool_input) || {};
  const rawFilePath = toolInput.file_path || toolInput.path || '';
  if (!rawFilePath) {
    process.exit(0);
  }

  const cwd = (payload && typeof payload.cwd === 'string' && payload.cwd) || process.cwd();
  const resolvedPath = path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(cwd, rawFilePath);
  const normalized = resolvedPath.replace(/\\/g, '/');

  if (!isInScope(normalized)) {
    process.exit(0);
  }

  const type = checkType(normalized);
  if (!type) {
    process.exit(0);
  }

  switch (type) {
    case 'state':
      checkStateJson(resolvedPath);
      break;
    case 'sds-data':
      checkSdsDataJson(resolvedPath);
      break;
    case 'design-components':
      checkDesignComponentsJson(resolvedPath);
      break;
  }

  process.exit(0);
}

main();
