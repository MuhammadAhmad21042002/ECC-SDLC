#!/usr/bin/env node
/**
 * SDLC SessionStart Hook - Load project state and inject context into agent
 *
 * Event: SessionStart
 * Fires when a new Claude session begins.
 *
 * Reads .sdlc/state.json from the current working directory (if it exists)
 * and injects a structured project summary into the agent context via
 * hookSpecificOutput.additionalContext. This gives every agent immediate
 * awareness of: project name, current phase, artifact status, open items,
 * and compliance flags — without the user having to re-explain the project.
 *
 * If no .sdlc/state.json exists the hook exits cleanly with no output so
 * it never blocks non-SDLC projects.
 *
 * Cross-platform: Windows, macOS, Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';

/** Ordered phase progression used to derive "next phase" suggestions. */
const PHASE_ORDER = [
  'discovery',
  'requirements',
  'design',
  'test-planning',
  'estimation',
  'compliance',
  'proposal',
  'handoff',
];

// ---------------------------------------------------------------------------
// Logging (stderr only — stdout is reserved for the JSON payload)
// ---------------------------------------------------------------------------

function log(message) {
  process.stderr.write(`[SDLC-SessionStart] ${message}\n`);
}

// ---------------------------------------------------------------------------
// State file resolution
// ---------------------------------------------------------------------------

/**
 * Locate the nearest .sdlc/state.json by walking up from startDir.
 * startDir should be payload.cwd from the Claude Code SessionStart payload —
 * process.cwd() is Claude Code's own directory, not the user's project.
 * Returns the full path string, or null if not found.
 */
function findStateFile(startDir) {
  let dir = startDir || process.cwd();

  // Walk up at most 6 levels to find the project root
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, SDLC_DIR, STATE_FILE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Read and parse state.json. Returns null on any error.
 */
function readState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    log(`Could not read state file at ${statePath}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

/**
 * Build a human-readable artifact status table.
 * @param {object} artifacts - state.artifacts object
 * @returns {string}
 */
function buildArtifactStatus(artifacts) {
  if (!artifacts || typeof artifacts !== 'object') {
    return '  (no artifact data)';
  }

  const lines = [];
  const keys = ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal'];

  for (const key of keys) {
    const artifact = artifacts[key];
    if (artifact && artifact.path) {
      const version = artifact.version ? `v${artifact.version}` : 'v?';
      lines.push(`  [DONE] ${key.toUpperCase().padEnd(10)} ${version}  →  ${artifact.path}`);
    } else {
      lines.push(`  [ -- ] ${key.toUpperCase().padEnd(10)} not yet generated`);
    }
  }

  return lines.join('\n');
}

/**
 * Derive the next expected phase based on current state.
 * @param {string} currentPhase
 * @param {object} artifacts
 * @returns {string}
 */
function deriveNextPhase(currentPhase, artifacts) {
  const idx = PHASE_ORDER.indexOf(currentPhase);
  if (idx === -1) return 'unknown — check state.json';
  if (idx === PHASE_ORDER.length - 1) return 'none — project complete';

  const next = PHASE_ORDER[idx + 1];
  return next;
}

/**
 * Build a summary of open compliance flags.
 * @param {Array} flags
 * @returns {string}
 */
function buildComplianceFlags(flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return '  none';
  }

  return flags
    .slice(0, 10) // cap at 10 to keep context concise
    .map(f => {
      const severity = (f.severity || 'unknown').toUpperCase().padEnd(8);
      const control = f.controlId || f.id || '?';
      const title = f.title || f.description || '';
      return `  [${severity}] ${control} — ${title}`;
    })
    .join('\n');
}

/**
 * Build requirement coverage summary (counts by status).
 * @param {Array} requirements
 * @returns {string}
 */
function buildRequirementSummary(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return '  none';
  }

  const counts = { approved: 0, validated: 0, draft: 0, deferred: 0, rejected: 0 };
  let untraced = 0;

  for (const req of requirements) {
    const status = req.status || 'draft';
    if (counts[status] !== undefined) counts[status]++;

    // Flag requirements with no forward traces
    const tf = req.traceForward || {};
    const hasDesign = Array.isArray(tf.designComponentIds) && tf.designComponentIds.length > 0;
    const hasTest = Array.isArray(tf.testCaseIds) && tf.testCaseIds.length > 0;
    if (!hasDesign || !hasTest) untraced++;
  }

  const total = requirements.length;
  const parts = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');

  const traceNote = untraced > 0
    ? `  WARNING: ${untraced}/${total} requirement(s) missing design or test traces`
    : `  All ${total} requirement(s) have forward traces`;

  return `  Total: ${total}  (${parts || 'none'})\n${traceNote}`;
}

/**
 * Build the full additionalContext string injected into the agent.
 * @param {object} state - parsed state.json
 * @param {string} statePath - resolved path (for display)
 * @returns {string}
 */
function buildContext(state, statePath) {
  const projectName = state.projectName || state.projectId || 'Unnamed Project';
  const clientName = state.clientName || '—';
  const currentPhase = state.currentPhase || 'unknown';
  const nextPhase = deriveNextPhase(currentPhase, state.artifacts);

  // Phase history summary
  const phaseHistory = Array.isArray(state.phaseHistory) ? state.phaseHistory : [];
  const completedPhases = phaseHistory
    .filter(p => p.completedAt)
    .map(p => p.phase);
  const inProgressPhase = phaseHistory.find(p => p.startedAt && !p.completedAt);

  const lines = [
    '═══════════════════════════════════════════════════════',
    '  SDLC PROJECT CONTEXT (loaded from .sdlc/state.json)',
    '═══════════════════════════════════════════════════════',
    '',
    `  Project  : ${projectName}`,
    `  Client   : ${clientName}`,
    `  Phase    : ${currentPhase.toUpperCase()}`,
    `  Next     : ${nextPhase}`,
    `  State    : ${statePath}`,
    '',
    '── Completed Phases ──────────────────────────────────',
    completedPhases.length > 0
      ? `  ${completedPhases.join(' → ')}`
      : '  none yet',
    '',
    '── Artifact Status ───────────────────────────────────',
    buildArtifactStatus(state.artifacts),
    '',
    '── Requirements ──────────────────────────────────────',
    buildRequirementSummary(state.requirements),
    '',
    '── Compliance Flags ──────────────────────────────────',
    buildComplianceFlags(state.complianceFlags),
    '',
    '── Pending Items ─────────────────────────────────────',
    buildPendingItems(state, currentPhase),
    '',
    '═══════════════════════════════════════════════════════',
    '  Use /sdlc-status for a full real-time project dashboard.',
    '═══════════════════════════════════════════════════════',
  ];

  return lines.join('\n');
}

/**
 * Build pending items based on current phase and artifact gaps.
 * @param {object} state
 * @param {string} currentPhase
 * @returns {string}
 */
function buildPendingItems(state, currentPhase) {
  const items = [];
  const artifacts = state.artifacts || {};

  // Phase-specific pending item suggestions
  switch (currentPhase) {
    case 'discovery':
      if (!artifacts.scope || !artifacts.scope.path) {
        items.push('Run /scope to generate the Scope Document');
      }
      break;

    case 'requirements':
      if (!artifacts.srs || !artifacts.srs.path) {
        items.push('Run /srs to generate the Software Requirements Specification');
      }
      break;

    case 'design':
      if (!artifacts.sds || !artifacts.sds.path) {
        items.push('Run /sds to generate the Software Design Specification');
      }
      break;

    case 'test-planning':
      if (!artifacts.sts || !artifacts.sts.path) {
        items.push('Run /sts to generate the Software Test Specification');
      }
      break;

    case 'estimation':
      if (!artifacts.estimate || !artifacts.estimate.path) {
        items.push('Run /estimate to generate the cost model and resource plan');
      }
      break;

    case 'compliance':
      if (Array.isArray(state.complianceFlags) && state.complianceFlags.length > 0) {
        const critical = state.complianceFlags.filter(f => f.severity === 'critical').length;
        if (critical > 0) {
          items.push(`CRITICAL: ${critical} compliance gap(s) require remediation before proceeding`);
        }
        items.push('Run /compliance to review the full compliance matrix');
      }
      break;

    case 'proposal':
      if (!artifacts.proposal || !artifacts.proposal.path) {
        items.push('Run /proposal to generate the final bid response');
      }
      break;

    case 'handoff':
      items.push('CLAUDE.md handoff file should be generated — verify with /sdlc-status');
      break;

    default:
      items.push('Run /scope to begin SDLC discovery phase');
  }

  // Cross-phase: flag any artifact with a hash mismatch (modification outside SDLC)
  const projectRoot = state._statePath
    ? path.dirname(path.dirname(state._statePath))
    : process.cwd();

  for (const [name, artifact] of Object.entries(artifacts)) {
    if (!artifact || !artifact.path || !artifact.hash) continue;
    if (path.isAbsolute(artifact.path)) {
      items.push(`WARNING: ${name.toUpperCase()} artifact path is absolute — skipping integrity check`);
      continue;
    }
    const fullPath = path.resolve(projectRoot, artifact.path);
    const normalizedRoot = path.resolve(projectRoot) + path.sep;
    if (!fullPath.startsWith(normalizedRoot)) {
      items.push(`WARNING: ${name.toUpperCase()} artifact path escapes project root — skipping integrity check`);
      continue;
    }
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath);
        const crypto = require('crypto');
        const actualHash = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
        if (artifact.hash !== actualHash) {
          items.push(`WARNING: ${name.toUpperCase()} artifact was modified outside SDLC — re-run /${name} or update state`);
        }
      } catch {
        // skip hash check on read error
      }
    }
  }

  if (items.length === 0) {
    items.push(`Phase ${currentPhase} artifacts complete — advance with /sdlc-status`);
  }

  return items.map(item => `  • ${item}`).join('\n');
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

/**
 * Write the SessionStart JSON payload to stdout.
 * Claude Code reads hookSpecificOutput.additionalContext and prepends it
 * to the agent's system context for the session.
 *
 * @param {string} additionalContext
 * @returns {Promise<void>}
 */
function writePayload(additionalContext) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    });

    const handleError = (err) => {
      if (settled) return;
      settled = true;
      reject(err || new Error('stdout stream error'));
    };

    process.stdout.once('error', handleError);
    process.stdout.write(payload, (err) => {
      process.stdout.removeListener('error', handleError);
      if (settled) return;
      settled = true;
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Session hash snapshot
// ---------------------------------------------------------------------------

/**
 * Write a hash snapshot of all artifact files to .sdlc/.session-hashes.json.
 * document-version.js (Stop hook) reads this at session end to detect which
 * artifacts changed during the session and increments their versions.
 * Errors never block the session.
 */
function writeSessionHashSnapshot(statePath, state) {
  try {
    const sdlcDir     = path.dirname(statePath);
    const projectRoot = path.dirname(sdlcDir);
    const snapPath    = path.join(sdlcDir, '.session-hashes.json');
    const artifacts   = state.artifacts || {};
    const snapshot    = { capturedAt: new Date().toISOString(), hashes: {} };

    for (const key of ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal']) {
      const artifact = artifacts[key];
      if (!artifact || !artifact.path) continue;
      const p        = artifact.path.trim();
      const fullPath = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const buf = fs.readFileSync(fullPath);
        snapshot.hashes[key] = {
          path:    artifact.path,
          hash:    'sha256:' + crypto.createHash('sha256').update(buf).digest('hex'),
          version: artifact.version ?? 0,
        };
      } catch { /* unreadable — skip */ }
    }

    fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
    log(`Hash snapshot written → ${snapPath}`);
  } catch (err) {
    log(`WARNING: could not write hash snapshot: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(stdinPayload) {
  // Use cwd from the Claude Code SessionStart payload, not process.cwd().
  // When Claude Code runs a hook as a subprocess, process.cwd() is Claude
  // Code's own directory — not the user's project folder.
  const projectCwd = (stdinPayload?.cwd && typeof stdinPayload.cwd === 'string')
    ? stdinPayload.cwd.trim()
    : process.cwd();
  const statePath = findStateFile(projectCwd);

  if (!statePath) {
    // No .sdlc/state.json in this project — not an SDLC project, exit cleanly.
    log('No .sdlc/state.json found — skipping SDLC context injection');
    return;
  }

  log(`Found state file: ${statePath}`);
  const state = readState(statePath);

  if (!state) {
    // File exists but is unreadable/invalid — warn but don't block the session.
    log('State file unreadable or invalid JSON — skipping context injection');
    return;
  }

  // Attach the resolved path so buildPendingItems can resolve artifact paths
  state._statePath = statePath;

  // Write hash snapshot so document-version.js can detect changes at session end
  writeSessionHashSnapshot(statePath, state);

  const context = buildContext(state, statePath);
  log(`Injecting SDLC context for project: ${state.projectName || state.projectId || 'unknown'}`);
  log(`Current phase: ${state.currentPhase || 'unknown'}`);

  await writePayload(context);
}

// Read stdin synchronously to get the Claude Code SessionStart payload.
// Claude Code sends { cwd, session_id, ... } on stdin.
// readFileSync(0) works reliably on Windows named pipes; async events do not.
let stdinPayload = null;
try {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (raw) stdinPayload = JSON.parse(raw);
} catch { /* stdin empty or not JSON — main() falls back to process.cwd() */ }

main(stdinPayload).catch((err) => {
  // Never block the session on hook errors
  log(`ERROR: ${err.message}`);
  process.exitCode = 0;
});
