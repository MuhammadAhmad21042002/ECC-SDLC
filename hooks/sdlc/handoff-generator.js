#!/usr/bin/env node
'use strict';

/**
 * SDLC Handoff Generator Hook
 *
 * Event: Stop (fires after every Claude response)
 *
 * Generates a CLAUDE.md context file in the project root when SRS, SDS,
 * and STS artifacts are all present in .sdlc/state.json. This file gives
 * the development team full project context without manual handoff work.
 *
 * Behaviour:
 *   - If SRS, SDS, and STS are all non-null in state.artifacts:
 *       Write CLAUDE.md.tmp → quality check → rename to CLAUDE.md
 *   - If any of SRS, SDS, or STS is missing:
 *       Log which artifact is absent, exit 0, create no file
 *   - Quality check failure:
 *       Delete CLAUDE.md.tmp, log reason, exit 0
 *   - Interrupted write:
 *       finally block removes CLAUDE.md.tmp if it still exists
 *
 * CLAUDE.md sections (in order):
 *   # Project Overview
 *   ## Architecture
 *   ## Requirements
 *   ## Testing Strategy
 *   ## Compliance Status
 *   ## Open Items
 *
 * Exit code: always 0 — this hook must never prevent a session from closing.
 */

const fs = require('fs');
const path = require('path');

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';
const OUTPUT_FILE = 'CLAUDE.md';
const TMP_FILE = 'CLAUDE.md.tmp';
const MAX_STDIN = 1024 * 1024;
const REQUIRED_ARTIFACTS = ['srs', 'sds', 'sts'];
// Minimum number of unique REQ-* IDs the Requirements section must contain.
// Real projects always have many more; 3 guards against accidentally empty output.
const MIN_REQ_IDS = 3;

// stdinBuf declared at module top so main() can reference it safely.
let stdinBuf = '';

function log(msg) {
  process.stderr.write(`[SDLC-HandoffGenerator] ${msg}\n`);
}

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

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    log(`Could not parse JSON at ${filePath}: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prerequisite check
// ---------------------------------------------------------------------------

function checkPrerequisites(artifacts) {
  return REQUIRED_ARTIFACTS.filter(key => !artifacts[key] || !artifacts[key].path);
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function buildProjectOverview(state) {
  const lines = ['# Project Overview', ''];
  lines.push(`**Project:** ${state.projectName || 'Unknown'}`);
  lines.push(`**Client:** ${state.clientName || 'Unknown'}`);
  lines.push(`**Current Phase:** ${state.currentPhase || 'Unknown'}`);
  lines.push('');

  const arts = state.artifacts || {};
  lines.push('### Artifacts');
  lines.push('');
  for (const key of ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal']) {
    const a = arts[key];
    if (a && a.path) {
      lines.push(`- **${key.toUpperCase()}** v${a.version || 1} — \`${a.path}\` (${a.status || 'draft'})`);
    } else {
      lines.push(`- **${key.toUpperCase()}** — not yet generated`);
    }
  }

  if (Array.isArray(state.phaseHistory) && state.phaseHistory.length > 0) {
    lines.push('');
    lines.push('### Phase History');
    lines.push('');
    for (const p of state.phaseHistory) {
      const completed = p.completedAt ? `completed ${p.completedAt.slice(0, 10)}` : 'in progress';
      lines.push(`- **${p.phase}** — started ${(p.startedAt || '').slice(0, 10)}, ${completed}`);
    }
  }

  return lines.join('\n');
}

function buildArchitecture(state) {
  const components = Array.isArray(state.designComponents) ? state.designComponents : [];
  const lines = ['## Architecture', ''];

  if (components.length === 0) {
    lines.push('_No design components recorded in state.json._');
    return lines.join('\n');
  }

  lines.push(`${components.length} design component(s) defined in SDS.`);
  lines.push('');

  for (const cmp of components) {
    const id = cmp.id || 'UNKNOWN-ID';
    lines.push(`### ${id} — ${cmp.title || cmp.name || 'Unnamed'}`);
    if (cmp.type) lines.push(`**Type:** ${cmp.type}`);
    if (cmp.technology) lines.push(`**Technology:** ${cmp.technology}`);
    if (cmp.description) {
      lines.push('');
      lines.push(cmp.description);
    }
    if (Array.isArray(cmp.tracesTo) && cmp.tracesTo.length > 0) {
      lines.push('');
      lines.push(`**Traces to:** ${cmp.tracesTo.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildRequirements(state) {
  const reqs = Array.isArray(state.requirements) ? state.requirements : [];
  const lines = ['## Requirements', ''];

  if (reqs.length === 0) {
    lines.push('_No requirements recorded in state.json._');
    return lines.join('\n');
  }

  const KNOWN_PRIORITIES = new Set(['must', 'should', 'could', 'wont']);
  const byPriority = reqs.reduce((acc, r) => {
    const p = KNOWN_PRIORITIES.has(r.priority) ? r.priority : 'should';
    return { ...acc, [p]: [...acc[p], r] };
  }, { must: [], should: [], could: [], wont: [] });

  const total = reqs.length;
  lines.push(
    `${total} requirement(s) total — ${byPriority.must.length} must, ` +
    `${byPriority.should.length} should, ${byPriority.could.length} could, ${byPriority.wont.length} wont.`
  );
  lines.push('');

  for (const [priority, group] of Object.entries(byPriority)) {
    if (group.length === 0) continue;
    lines.push(`### ${priority.charAt(0).toUpperCase() + priority.slice(1)}`);
    lines.push('');
    lines.push('| ID | Title | Status |');
    lines.push('|---|---|---|');
    for (const r of group) {
      const id = (r.id || 'REQ-???').replace(/\|/g, '\\|');
      const title = (r.title || 'Untitled').replace(/\|/g, '\\|');
      const status = (r.status || 'draft').replace(/\|/g, '\\|');
      lines.push(`| ${id} | ${title} | ${status} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildTestingStrategy(state) {
  const testCases = Array.isArray(state.testCases) ? state.testCases : [];
  const lines = ['## Testing Strategy', ''];

  if (testCases.length === 0) {
    // Empty body — checkQuality will detect this is below the ≥50 char threshold
    // and abort the write. This is intentional: a blank Testing Strategy section
    // gives the dev team no useful context.
    return lines.join('\n');
  }

  const byType = testCases.reduce((acc, tc) => {
    const t = tc.testType || tc.type || 'functional';
    return { ...acc, [t]: [...(acc[t] || []), tc] };
  }, {});

  lines.push(`${testCases.length} test case(s) defined in STS.`);
  lines.push('');

  for (const [type, group] of Object.entries(byType)) {
    lines.push(`**${type.charAt(0).toUpperCase() + type.slice(1)} tests (${group.length}):**`);
    for (const tc of group) {
      const id = tc.testCaseId || tc.id || 'TC-???';
      const title = tc.description || tc.title || 'Untitled';
      const linkedReqs = tc.linkedRequirements || tc.tracesTo;
      const traces = linkedReqs
        ? ` → ${Array.isArray(linkedReqs) ? linkedReqs.join(', ') : linkedReqs}`
        : '';
      lines.push(`- ${id}: ${title}${traces}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildComplianceStatus(state) {
  const flags = Array.isArray(state.complianceFlags) ? state.complianceFlags : [];
  const lines = ['## Compliance Status', ''];

  if (flags.length === 0) {
    lines.push('Compliance: /compliance not yet run');
    return lines.join('\n');
  }

  const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
  const bySeverity = flags.reduce((acc, f) => {
    const s = KNOWN_SEVERITIES.has(f.severity) ? f.severity : 'medium';
    return { ...acc, [s]: [...acc[s], f] };
  }, { critical: [], high: [], medium: [], low: [] });

  const critCount = bySeverity.critical.length;
  lines.push(
    `${flags.length} compliance flag(s) detected${critCount > 0 ? ` — **${critCount} CRITICAL**` : ''}.`
  );
  lines.push('');

  for (const [severity, group] of Object.entries(bySeverity)) {
    if (group.length === 0) continue;
    lines.push(`### ${severity.toUpperCase()} (${group.length})`);
    lines.push('');
    for (const f of group) {
      lines.push(
        `- **${f.frameworkCode || 'UNKNOWN'}** triggered by \`${f.triggeredBy || 'unknown'}\`` +
        ` — ${f.description || f.keyword || ''} (${f.status || 'pending-review'})`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildOpenItems(state) {
  const questions = Array.isArray(state.openQuestions) ? state.openQuestions : [];
  const lines = ['## Open Items', ''];

  if (questions.length === 0) {
    lines.push('No open items recorded.');
    return lines.join('\n');
  }

  const open = questions.filter(q => q.status === 'open' || !q.status);
  const resolved = questions.filter(q => q.status && q.status !== 'open');

  lines.push(`${open.length} open question(s), ${resolved.length} resolved.`);
  lines.push('');

  if (open.length > 0) {
    lines.push('### Open');
    lines.push('');
    for (const q of open) {
      const id = q.id ? `**${q.id}**` : '';
      const owner = q.askedTo ? ` — _${q.askedTo}_` : '';
      lines.push(`- ${id} ${q.question || ''}${owner}`);
    }
    lines.push('');
  }

  if (resolved.length > 0) {
    lines.push('### Resolved');
    lines.push('');
    for (const q of resolved) {
      lines.push(`- ~~${q.question || ''}~~ (${q.status})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Content assembly
// ---------------------------------------------------------------------------

function buildContent(state) {
  const sections = [
    buildProjectOverview(state),
    buildArchitecture(state),
    buildRequirements(state),
    buildTestingStrategy(state),
    buildComplianceStatus(state),
    buildOpenItems(state)
  ];
  const generated = new Date().toISOString();
  const footer =
    `\n---\n_Generated by ECC-SDLC handoff-generator on ${generated}. ` +
    `Re-run by closing and reopening a session after /sts completes._\n`;
  return sections.join('\n\n') + footer;
}

// ---------------------------------------------------------------------------
// Quality check
// ---------------------------------------------------------------------------

/**
 * Extract the body of a named section from CLAUDE.md content.
 * Cuts from the heading to the next h2 boundary (or end of file).
 * Returns the trimmed body string, or null if the heading is not found.
 *
 * @param {string} content - Full document content.
 * @param {string} heading - Exact heading string (e.g. '## Architecture').
 * @returns {string|null}
 */
function extractSectionBody(content, heading) {
  // Require the heading to start at a line boundary (column 0) so that heading
  // text embedded inside a description field does not produce a false match.
  let headingStart;
  if (content.startsWith(heading)) {
    headingStart = 0;
  } else {
    const pos = content.indexOf('\n' + heading);
    if (pos === -1) return null;
    headingStart = pos + 1; // skip the leading \n — point at the heading itself
  }
  const afterHeading = content.slice(headingStart + heading.length);
  // Use \n## (exactly two hashes) so h3 subheadings inside a section do not
  // prematurely terminate the body scan.
  const nextSection = afterHeading.search(/\n## /);
  return (nextSection === -1 ? afterHeading : afterHeading.slice(0, nextSection)).trim();
}

/**
 * Inspect every CLAUDE.md section against minimum content thresholds before
 * the atomic rename commits the file to the project root.
 *
 * Thresholds:
 *   Project Overview  : ≥ 50 characters
 *   Architecture      : ≥ 100 characters AND contains at least one DC-NNN ref
 *   Requirements      : ≥ 3 unique REQ-* IDs in section body
 *   Testing Strategy  : ≥ 50 characters
 *   Compliance Status : any non-empty content
 *   Open Items        : always passes (empty is acceptable)
 *
 * Log format on failure:
 *   [HANDOFF] ABORTED: {Section} section failed quality check — {reason}.
 *   Fix by running /{command} first.
 *
 * @param {string} content - Full CLAUDE.md content string.
 * @returns {string[]} Array of failure messages. Empty array means all passed.
 */
function checkQuality(content) {
  const failures = [];

  // ── Project Overview (≥50 chars) ──────────────────────────────────────────
  const overviewBody = extractSectionBody(content, '# Project Overview');
  if (overviewBody === null) {
    failures.push(
      '[HANDOFF] ABORTED: Project Overview section failed quality check — section is missing. ' +
      'Fix by running /scope first.'
    );
  } else if (overviewBody.length < 50) {
    failures.push(
      `[HANDOFF] ABORTED: Project Overview section failed quality check — ` +
      `section body is ${overviewBody.length} chars, minimum is 50. ` +
      'Fix by running /scope first.'
    );
  }

  // ── Architecture (≥100 chars AND DC-NNN ref) ──────────────────────────────
  const archBody = extractSectionBody(content, '## Architecture');
  if (archBody === null) {
    failures.push(
      '[HANDOFF] ABORTED: Architecture section failed quality check — section is missing. ' +
      'Fix by running /sds first.'
    );
  } else {
    if (archBody.length < 100) {
      failures.push(
        `[HANDOFF] ABORTED: Architecture section failed quality check — ` +
        `section body is ${archBody.length} chars, minimum is 100. ` +
        'Fix by running /sds first.'
      );
    }
    if (!/DC-\d{3}/.test(archBody)) {
      failures.push(
        '[HANDOFF] ABORTED: Architecture section failed quality check — ' +
        'no DC-NNN component reference found. ' +
        'Fix by running /sds first.'
      );
    }
  }

  // ── Requirements (≥3 REQ-* refs scoped to section body) ───────────────────
  // Scoped to the Requirements section only — Architecture tracesTo fields
  // also contain REQ-* IDs and would inflate the count if scanned globally.
  const reqBody = extractSectionBody(content, '## Requirements');
  if (reqBody === null) {
    failures.push(
      '[HANDOFF] ABORTED: Requirements section failed quality check — section is missing. ' +
      'Fix by running /srs first.'
    );
  } else {
    const uniqueReqIds = new Set((reqBody.match(/REQ-(?:FUNC|NFUNC|CON)-\d{3}/g) || []));
    if (uniqueReqIds.size < MIN_REQ_IDS) {
      failures.push(
        `[HANDOFF] ABORTED: Requirements section failed quality check — ` +
        `section contains ${uniqueReqIds.size} REQ-* reference(s), minimum is 3. ` +
        'Fix by running /srs first.'
      );
    }
  }

  // ── Testing Strategy (≥50 chars) ──────────────────────────────────────────
  const testingBody = extractSectionBody(content, '## Testing Strategy');
  if (testingBody === null) {
    failures.push(
      '[HANDOFF] ABORTED: Testing Strategy section failed quality check — section is missing. ' +
      'Fix by running /sts first.'
    );
  } else if (testingBody.length < 50) {
    failures.push(
      `[HANDOFF] ABORTED: Testing Strategy section failed quality check — ` +
      `section body is ${testingBody.length} chars, minimum is 50. ` +
      'Fix by running /sts first.'
    );
  }

  // ── Compliance Status (any non-empty content) ──────────────────────────────
  // buildComplianceStatus always writes a fallback string when flags is empty,
  // so this section should never be genuinely blank.
  const complianceBody = extractSectionBody(content, '## Compliance Status');
  if (complianceBody === null) {
    failures.push(
      '[HANDOFF] ABORTED: Compliance Status section failed quality check — section is missing. ' +
      'Fix by running /compliance first.'
    );
  } else if (complianceBody.length === 0) {
    failures.push(
      '[HANDOFF] ABORTED: Compliance Status section failed quality check — section body is empty. ' +
      'Fix by running /compliance first.'
    );
  }

  // ── Open Items — always passes (empty is acceptable) ──────────────────────

  return failures;
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

function writeAtomic(projectRoot, content) {
  const tmpPath = path.join(projectRoot, TMP_FILE);
  const outPath = path.join(projectRoot, OUTPUT_FILE);

  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    log('Wrote CLAUDE.md.tmp');

    const failures = checkQuality(content);
    if (failures.length > 0) {
      for (const f of failures) log(f);
      try { fs.unlinkSync(tmpPath); } catch (e) { log(`Could not delete CLAUDE.md.tmp: ${e.message}`); }
      log('Deleted CLAUDE.md.tmp — no partial file left');
      return false;
    }

    // Wrap renameSync so a failure returns false rather than throwing,
    // keeping the function's boolean contract intact on all paths.
    try {
      fs.renameSync(tmpPath, outPath);
    } catch (e) {
      log(`Failed to rename CLAUDE.md.tmp → CLAUDE.md: ${e.message}`);
      return false;
    }

    log(`CLAUDE.md generated at ${outPath}`);
    return true;
  } finally {
    // Guard: remove .tmp if still present after any failure path.
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
        log('Cleanup: removed lingering CLAUDE.md.tmp');
      }
    } catch (e) { log(`Cleanup warning: could not remove CLAUDE.md.tmp: ${e.message}`); }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let projectCwd = null;
  try {
    const input = JSON.parse(stdinBuf);
    if (input.cwd && typeof input.cwd === 'string') projectCwd = input.cwd.trim();
  } catch { /* stdin not JSON — fall back to process.cwd() */ }

  const statePath = findStateFile(projectCwd);
  if (!statePath) {
    log('No .sdlc/state.json found — skipping');
    process.exit(0);
  }

  // Confine the output path to the expected workspace to prevent writing
  // CLAUDE.md outside the project directory if input.cwd is malformed.
  const resolvedStatePath = path.resolve(statePath);
  const resolvedCwd = path.resolve(projectCwd || process.cwd());
  if (!resolvedStatePath.startsWith(resolvedCwd + path.sep) &&
      resolvedStatePath !== resolvedCwd) {
    log(`Safety: state.json at ${resolvedStatePath} is outside cwd ${resolvedCwd} — skipping`);
    process.exit(0);
  }

  const state = readJson(statePath);
  if (!state) {
    log('State unreadable — skipping');
    process.exit(0);
  }

  log(`Project: ${state.projectName || 'unknown'} | Phase: ${state.currentPhase || 'unknown'}`);

  const artifacts = state.artifacts || {};
  const missing = checkPrerequisites(artifacts);
  if (missing.length > 0) {
    for (const key of missing) {
      log(`Prerequisite missing: ${key.toUpperCase()} artifact not found in state.json — skipping CLAUDE.md generation`);
    }
    process.exit(0);
  }

  log('All prerequisites met (SRS, SDS, STS) — generating CLAUDE.md');

  const sdlcDir = path.dirname(resolvedStatePath);
  const projectRoot = path.dirname(sdlcDir);

  // Confirm projectRoot is an ancestor of (or equal to) resolvedCwd — prevents
  // writing CLAUDE.md outside the workspace if cwd points inside .sdlc/ itself.
  if (!resolvedCwd.startsWith(projectRoot + path.sep) && resolvedCwd !== projectRoot) {
    log(`Safety: project root ${projectRoot} is not an ancestor of cwd ${resolvedCwd} — skipping`);
    process.exit(0);
  }

  const content = buildContent(state);
  const ok = writeAtomic(projectRoot, content);

  if (ok) {
    log('Handoff complete — CLAUDE.md ready for development team');
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point — stdin-driven, matching ECC Stop hook convention
// ---------------------------------------------------------------------------

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  const remaining = MAX_STDIN - stdinBuf.length;
  if (remaining > 0) stdinBuf += chunk.substring(0, remaining);
});
process.stdin.on('end', () => {
  main().catch(e => {
    log(`ERROR: ${e.message}`);
    process.exit(0);
  });
});
