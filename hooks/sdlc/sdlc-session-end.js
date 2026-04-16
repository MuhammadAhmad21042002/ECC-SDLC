#!/usr/bin/env node
/**
 * SDLC Stop Hook - Save state and append sessions.log entry
 *
 * Event: Stop (fires after every Claude response)
 *
 * Responsibilities:
 *  1. Find .sdlc/state.json for the current project
 *  2. Flush an updated "lastSavedAt" timestamp to state.json so every
 *     session leaves a clear save marker (agents update the rest of the
 *     state themselves during the session)
 *  3. Parse the session transcript (provided via stdin JSON as
 *     transcript_path) to extract SDLC-relevant activity:
 *     - slash commands run (/srs, /sds, /scope, etc.)
 *     - artifacts written or modified
 *     - phase transitions detected
 *     - decisions captured from assistant messages
 *  4. Append one structured JSON line to .sdlc/sessions.log
 *
 * If no .sdlc/state.json exists the hook exits cleanly — it never blocks
 * non-SDLC projects.
 *
 * Cross-platform: Windows, macOS, Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';
const LOG_FILE = 'sessions.log';

/** SDLC slash commands — used to detect relevant activity in transcript. */
const SDLC_COMMANDS = ['/scope', '/mom', '/go-nogo', '/srs', '/sds', '/sts', '/estimate', '/compliance', '/proposal', '/sdlc-status', '/traceability'];

/** Artifact keys tracked in state.artifacts */
const ARTIFACT_KEYS = ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal'];

/** Max bytes read from stdin (1 MB) */
const MAX_STDIN = 1024 * 1024;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message) {
  process.stderr.write(`[SDLC-SessionEnd] ${message}\n`);
}

// ---------------------------------------------------------------------------
// State file resolution (mirrors sdlc-session-start.js)
// ---------------------------------------------------------------------------

function findStateFile(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, SDLC_DIR, STATE_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    log(`Could not read state: ${err.message}`);
    return null;
  }
}

function writeState(statePath, state) {
  try {
    const { writeJsonAtomic } = require('../../scripts/sdlc/utils/state-writer');
    writeJsonAtomic(statePath, state);
    return true;
  } catch (err) {
    log(`Could not write state: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

/**
 * Parse the JSONL transcript at transcriptPath and extract SDLC activity.
 * Returns a structured activity object.
 */
function extractActivity(transcriptPath) {
  const activity = {
    commandsRun: [], // SDLC slash commands detected in user messages
    artifactsModified: [], // .sdlc artifact paths written/edited
    phaseTransitions: [], // "currentPhase changed from X to Y"
    decisions: [], // short decision statements from assistant text
    filesModified: [], // any files written/edited this session
    toolsUsed: new Set()
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return activity;

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return activity;
  }

  const lines = raw.split('\n').filter(Boolean);
  let parseErrors = 0;
  let prevPhase = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    // ── User messages: look for SDLC slash commands ──────────────────────
    const isUser = entry.type === 'user' || entry.role === 'user' || entry.message?.role === 'user';

    if (isUser) {
      const rawContent = entry.message?.content ?? entry.content;
      const text = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent) ? rawContent.map(c => (c && c.text) || '').join(' ') : '';

      for (const cmd of SDLC_COMMANDS) {
        if (text.includes(cmd) && !activity.commandsRun.includes(cmd)) {
          activity.commandsRun.push(cmd);
        }
      }
    }

    // ── Assistant messages: extract decision sentences ────────────────────
    const isAssistant = entry.type === 'assistant' || entry.role === 'assistant' || entry.message?.role === 'assistant';

    if (isAssistant) {
      const rawContent = entry.message?.content ?? entry.content;
      const blocks = Array.isArray(rawContent) ? rawContent : [];

      for (const block of blocks) {
        // Tool use blocks — track file writes / edits
        if (block.type === 'tool_use') {
          const toolName = block.name || '';
          if (toolName) activity.toolsUsed.add(toolName);

          const filePath = block.input?.file_path || '';
          if (filePath && (toolName === 'Write' || toolName === 'Edit')) {
            if (!activity.filesModified.includes(filePath)) {
              activity.filesModified.push(filePath);
            }
            // Flag SDLC artifacts specifically
            if (filePath.includes(SDLC_DIR)) {
              if (!activity.artifactsModified.includes(filePath)) {
                activity.artifactsModified.push(filePath);
              }
            }
          }

          // Detect state.json writes — extract phase transitions
          if (filePath.endsWith(STATE_FILE) && block.input?.content) {
            try {
              const written = JSON.parse(block.input.content);
              const newPhase = written.currentPhase;
              if (newPhase && newPhase !== prevPhase && prevPhase !== null) {
                activity.phaseTransitions.push(`${prevPhase} → ${newPhase}`);
              }
              prevPhase = newPhase || prevPhase;
            } catch {
              /* ignore */
            }
          }
        }

        // Text blocks — pull short decision-like sentences
        if (block.type === 'text' && typeof block.text === 'string') {
          const sentences = block.text
            .split(/[.!?\n]/)
            .map(s => s.trim())
            .filter(s => s.length > 20 && s.length < 150)
            .filter(s => /\b(decided|chosen|selected|will use|approach|architecture|requirement|phase|approved|rejected|deferred)\b/i.test(s));

          for (const s of sentences.slice(0, 3)) {
            if (activity.decisions.length < 10) {
              activity.decisions.push(s);
            }
          }
        }
      }
    }
  }

  if (parseErrors > 0) {
    log(`Skipped ${parseErrors} unparseable transcript lines`);
  }

  activity.toolsUsed = Array.from(activity.toolsUsed);
  return activity;
}

// ---------------------------------------------------------------------------
// Log entry builder
// ---------------------------------------------------------------------------

/**
 * Build a single structured log entry and append it to sessions.log.
 * Each line is a self-contained JSON object (NDJSON format) so the log
 * is both human-readable (one entry per line) and machine-parseable.
 */
function appendSessionLog(sdlcDir, state, activity, sessionId) {
  const logPath = path.join(sdlcDir, LOG_FILE);

  const nextPhase = deriveNextPhase(state.currentPhase);
  const artifactStatus = buildArtifactStatusSnapshot(state.artifacts);

  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: sessionId || 'unknown',
    projectId: state.projectId || null,
    projectName: state.projectName || null,
    cwd: process.cwd(),
    phase: state.currentPhase || 'unknown',
    nextPhase,
    actionsThisSession: {
      commandsRun: activity.commandsRun,
      artifactsModified: activity.artifactsModified,
      filesModified: activity.filesModified.slice(0, 20),
      toolsUsed: activity.toolsUsed,
      phaseTransitions: activity.phaseTransitions
    },
    decisions: activity.decisions,
    artifactSnapshot: artifactStatus,
    requirementCount: Array.isArray(state.requirements) ? state.requirements.length : 0,
    complianceFlagCount: Array.isArray(state.complianceFlags) ? state.complianceFlags.length : 0,
    nextSteps: buildNextSteps(state, activity)
  };

  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    log(`Appended entry to ${logPath}`);
  } catch (err) {
    log(`Could not write sessions.log: ${err.message}`);
  }
}

/**
 * Derive the next expected phase from current phase.
 */
function deriveNextPhase(currentPhase) {
  const order = ['discovery', 'requirements', 'design', 'test-planning', 'estimation', 'compliance', 'proposal', 'handoff'];
  const idx = order.indexOf(currentPhase);
  if (idx === -1) return 'discovery';
  if (idx === order.length - 1) return 'complete';
  return order[idx + 1];
}

/**
 * Snapshot artifact completion status for the log entry.
 */
function buildArtifactStatusSnapshot(artifacts) {
  if (!artifacts) return {};
  const snapshot = {};
  for (const key of ARTIFACT_KEYS) {
    snapshot[key] = !!(artifacts[key] && artifacts[key].path);
  }
  return snapshot;
}

/**
 * Suggest next steps based on current phase and what happened this session.
 */
function buildNextSteps(state, activity) {
  const steps = [];
  const phase = state.currentPhase || 'discovery';
  const artifacts = state.artifacts || {};

  // If a phase transition happened this session, note what to do next
  if (activity.phaseTransitions.length > 0) {
    const last = activity.phaseTransitions[activity.phaseTransitions.length - 1];
    steps.push(`Phase advanced: ${last} — run /sdlc-status to verify gate`);
  }

  // Phase-specific next step
  const phaseNextCommand = {
    discovery: !artifacts.scope?.path ? '/scope to generate Scope Document' : '/srs to begin requirements',
    requirements: !artifacts.srs?.path ? '/srs to generate SRS' : '/sds to begin design',
    design: !artifacts.sds?.path ? '/sds to generate SDS' : '/sts to begin test planning',
    'test-planning': !artifacts.sts?.path ? '/sts to generate STS' : '/estimate to build cost model',
    estimation: !artifacts.estimate?.path ? '/estimate to generate cost model' : '/compliance to run compliance check',
    compliance: !artifacts.proposal?.path ? '/compliance then /proposal' : 'Review and submit proposal',
    proposal: 'Run /go-nogo for final bid decision',
    handoff: 'CLAUDE.md generated — hand off to development team'
  };

  const suggestion = phaseNextCommand[phase];
  if (suggestion) steps.push(suggestion);

  // Compliance urgency
  if (Array.isArray(state.complianceFlags)) {
    const critical = state.complianceFlags.filter(f => f.severity === 'critical').length;
    if (critical > 0) {
      steps.push(`CRITICAL: ${critical} compliance gap(s) must be resolved before proposal`);
    }
  }

  // Traceability gaps
  if (Array.isArray(state.requirements)) {
    const untraced = state.requirements.filter(r => {
      const tf = r.traceForward || {};
      return !(Array.isArray(tf.designComponentIds) && tf.designComponentIds.length > 0) || !(Array.isArray(tf.testCaseIds) && tf.testCaseIds.length > 0);
    }).length;
    if (untraced > 0) {
      steps.push(`${untraced} requirement(s) still need design/test traces — run /traceability`);
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// State flush
// ---------------------------------------------------------------------------

/**
 * Update state.json with a lastSavedAt timestamp.
 * Agents write the substantive state changes; this hook just marks
 * that the session ended cleanly so future sessions can detect gaps.
 */
function flushStateTimestamp(statePath, state) {
  const updated = { ...state, lastSavedAt: new Date().toISOString() };
  // Remove internal runtime key before writing
  delete updated._statePath;
  if (writeState(statePath, updated)) {
    log(`State flushed: ${statePath}`);
  }
}

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

function getSessionId() {
  // Claude Code sets CLAUDE_SESSION_ID in the environment
  return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || `sess-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Main (stdin-driven, matches ECC Stop hook convention)
// ---------------------------------------------------------------------------

let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
  }
});

process.stdin.on('end', () => {
  main().catch(err => {
    log(`ERROR: ${err.message}`);
    process.exit(0); // never block on errors
  });
});

async function main() {
  // 1. Parse stdin for transcript_path and cwd
  let transcriptPath = null;
  // project root, not Claude Code's own working directory.
  let projectCwd = null;
  try {
    const input = JSON.parse(stdinData);
    transcriptPath = input.transcript_path;
    if (input.cwd && typeof input.cwd === 'string') projectCwd = input.cwd.trim();
  } catch {
    transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH || null;
  }

  const statePath = findStateFile(projectCwd);
  if (!statePath) {
    log('No .sdlc/state.json found — skipping');
    process.exit(0);
  }

  const state = readState(statePath);
  if (!state) {
    log('State unreadable — skipping');
    process.exit(0);
  }

  log(`Project: ${state.projectName || state.projectId || 'unknown'} | Phase: ${state.currentPhase || 'unknown'}`);

  // 3. Extract activity from transcript
  const activity = extractActivity(transcriptPath);
  log(`Activity: ${activity.commandsRun.length} command(s), ${activity.filesModified.length} file(s) modified`);

  // 4. Flush lastSavedAt to state.json
  flushStateTimestamp(statePath, state);

  // 5. Append entry to sessions.log
  const sdlcDir = path.dirname(statePath);
  appendSessionLog(sdlcDir, state, activity, getSessionId());

  process.exit(0);
}
