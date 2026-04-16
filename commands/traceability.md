---
name: traceability
description: Generate a full REQ-* coverage matrix showing which requirements have design components, test cases, and cost line items — and which are missing each. Read-only. Available after /srs.
---

## Overview

`/traceability` reads `.sdlc/state.json` and produces a coverage matrix across
all requirements. It is completely read-only — it never writes to state.json,
never invokes an agent, and never modifies any file.

Run at any point after `/srs` to see the current traceability health of the
project.

## Prerequisite

Read `.sdlc/state.json` and confirm `requirements[]` is non-empty (populated
by `/srs`). If state.json does not exist or `requirements` is empty, stop and
tell the user to run `/srs` first.

## Workflow

1. Confirm `.sdlc/state.json` exists and is readable.

2. Run the following Node.js script to compute and render the matrix:

```bash
node -e "
const fs   = require('fs');
const path = require('path');

const statePath = path.join(process.cwd(), '.sdlc', 'state.json');

let s;
try {
  s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (e) {
  console.error('ERROR: Could not read .sdlc/state.json — ' + e.message);
  process.exit(1);
}

const reqs = Array.isArray(s.requirements) ? s.requirements : [];
if (reqs.length === 0) {
  console.log('No requirements found in state.json. Run /srs first.');
  process.exit(0);
}

const line  = '━'.repeat(90);
const dline = '─'.repeat(90);

// ── Header ────────────────────────────────────────────────────────────────────
console.log(line);
console.log('  ECC-SDLC Traceability Matrix');
console.log('  Project : ' + (s.projectName || 'Unknown') + '  |  Client : ' + (s.clientName || 'Unknown'));
console.log(line);
console.log('');

// ── Column headers ─────────────────────────────────────────────────────────────
const hdr = [
  'REQ-ID'.padEnd(18),
  'Title'.padEnd(38),
  'DC'.padEnd(5),
  'TC'.padEnd(5),
  'COST'.padEnd(6),
  'Gap'.padEnd(9),
  'Severity'.padEnd(10),
  'Status',
].join('');
console.log('  ' + hdr);
console.log('  ' + dline);

// ── Per-requirement rows ───────────────────────────────────────────────────────
const gapsBySeverity = { critical: [], high: [], medium: [] };
let fullyTraced = 0;

for (const r of reqs) {
  const tf   = r.traceForward || {};
  const dcs  = Array.isArray(tf.designComponentIds) ? tf.designComponentIds  : [];
  const tcs  = Array.isArray(tf.testCaseIds)         ? tf.testCaseIds         : [];
  const cost = Array.isArray(tf.costLineItemIds)      ? tf.costLineItemIds     : [];

  const hasDC   = dcs.length  > 0;
  const hasTC   = tcs.length  > 0;
  const hasCost = cost.length > 0;
  const fully   = hasDC && hasTC && hasCost;

  if (fully) fullyTraced++;

  // Gap type — classify by worst missing link
  let gapType = 'none';
  let severity = '—';
  if (!hasDC) {
    gapType  = 'design';
    severity = 'critical';
    gapsBySeverity.critical.push(r.id);
  } else if (!hasTC) {
    gapType  = 'test';
    severity = 'high';
    gapsBySeverity.high.push(r.id);
  } else if (!hasCost) {
    gapType  = 'cost';
    severity = 'medium';
    gapsBySeverity.medium.push(r.id);
  }

  const status = fully ? '✓ covered' : '✗ gap';
  const title  = (r.title || '').length > 37
    ? (r.title || '').substring(0, 34) + '...'
    : (r.title || '');

  const row = [
    (r.id || '').padEnd(18),
    title.padEnd(38),
    String(dcs.length).padEnd(5),
    String(tcs.length).padEnd(5),
    String(cost.length).padEnd(6),
    gapType.padEnd(9),
    severity.padEnd(10),
    status,
  ].join('');
  console.log('  ' + row);
}

// ── Summary ───────────────────────────────────────────────────────────────────
const total = reqs.length;
const pct   = total > 0 ? Math.round((fullyTraced / total) * 100) : 0;

console.log('  ' + dline);
console.log('');
console.log('  Coverage: ' + fullyTraced + '/' + total + ' requirements fully traced (' + pct + '%)');
console.log('');

// Gap summary
const critCount = gapsBySeverity.critical.length;
const highCount = gapsBySeverity.high.length;
const medCount  = gapsBySeverity.medium.length;

if (critCount + highCount + medCount === 0) {
  console.log('  Gaps: none — all requirements fully traced');
} else {
  console.log('  Gaps by severity:');
  if (critCount > 0) {
    console.log('    Critical (design gaps) : ' + critCount + '  — ' + gapsBySeverity.critical.join(', '));
  } else {
    console.log('    Critical (design gaps) : 0');
  }
  if (highCount > 0) {
    console.log('    High     (test gaps)   : ' + highCount  + '  — ' + gapsBySeverity.high.join(', '));
  } else {
    console.log('    High     (test gaps)   : 0');
  }
  if (medCount > 0) {
    console.log('    Medium   (cost gaps)   : ' + medCount   + '  — ' + gapsBySeverity.medium.join(', '));
  } else {
    console.log('    Medium   (cost gaps)   : 0');
  }
}
console.log('');

// ── Phase gate status ─────────────────────────────────────────────────────────
const mustReqs = reqs.filter(r => r.priority === 'must');

const mustMissingDC   = mustReqs.filter(r => {
  const tf = r.traceForward || {};
  return !(Array.isArray(tf.designComponentIds) && tf.designComponentIds.length > 0);
});
const mustMissingTC   = mustReqs.filter(r => {
  const tf = r.traceForward || {};
  return !(Array.isArray(tf.testCaseIds) && tf.testCaseIds.length > 0);
});
const mustMissingCost = mustReqs.filter(r => {
  const tf = r.traceForward || {};
  return !(Array.isArray(tf.costLineItemIds) && tf.costLineItemIds.length > 0);
});
const mustBelow100 = mustReqs.filter(r => {
  const tf  = r.traceForward || {};
  const dcs  = Array.isArray(tf.designComponentIds) ? tf.designComponentIds  : [];
  const tcs  = Array.isArray(tf.testCaseIds)         ? tf.testCaseIds         : [];
  const cost = Array.isArray(tf.costLineItemIds)      ? tf.costLineItemIds     : [];
  return !(dcs.length > 0 && tcs.length > 0 && cost.length > 0);
});

console.log('  Phase gate status:');

const g1 = mustMissingDC.length === 0
  ? '    Design → Test Planning    [PASS]'
  : '    Design → Test Planning    [BLOCKED] — ' + mustMissingDC.length + ' must req(s) missing DC: ' + mustMissingDC.map(r => r.id).join(', ');

const g2 = mustMissingTC.length === 0
  ? '    Test Planning → Estimate  [PASS]'
  : '    Test Planning → Estimate  [BLOCKED] — ' + mustMissingTC.length + ' must req(s) missing TC: ' + mustMissingTC.map(r => r.id).join(', ');

const g3 = mustMissingCost.length === 0
  ? '    Estimate → Proposal       [PASS]'
  : '    Estimate → Proposal       [BLOCKED] — ' + mustMissingCost.length + ' must req(s) missing COST: ' + mustMissingCost.map(r => r.id).join(', ');

const g4 = (pct >= 80 && mustBelow100.length === 0)
  ? '    Proposal → Handoff        [PASS]'
  : '    Proposal → Handoff        [BLOCKED] — coverage ' + pct + '% (need ≥ 80%) and ' + mustBelow100.length + ' must req(s) below 100%';

console.log(g1);
console.log(g2);
console.log(g3);
console.log(g4);
console.log('');
console.log(line);
"
```

3. Do NOT modify state.json at any point. This command is read-only.

4. If state.json exists but is malformed (invalid JSON), display:

```
ERROR: .sdlc/state.json exists but could not be parsed.
The file may be corrupted. Check the file manually or
restore from .sdlc/state.json.bak if available.
```

## Output Format Reference

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ECC-SDLC Traceability Matrix
  Project : FBR AI Knowledge Platform  |  Client : Federal Board of Revenue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  REQ-ID             Title                                  DC   TC   COST  Gap       Severity   Status
  ──────────────────────────────────────────────────────────────────────────────────────────────────────
  REQ-FUNC-001       AI-Powered Knowledge Base Search       1    1    1     none      —          ✓ covered
  REQ-FUNC-002       Bilingual Search Support               1    0    1     test      high       ✗ gap
  REQ-FUNC-003       User Authentication                    0    0    0     design    critical   ✗ gap
  REQ-NFUNC-001      Response Time SLA                      1    1    1     none      —          ✓ covered
  REQ-CON-001        On-Premise Hosting Constraint          1    1    0     cost      medium     ✗ gap
  ──────────────────────────────────────────────────────────────────────────────────────────────────────

  Coverage: 2/5 requirements fully traced (40%)

  Gaps by severity:
    Critical (design gaps) : 1  — REQ-FUNC-003
    High     (test gaps)   : 1  — REQ-FUNC-002
    Medium   (cost gaps)   : 1  — REQ-CON-001

  Phase gate status:
    Design → Test Planning    [BLOCKED] — 1 must req(s) missing DC: REQ-FUNC-003
    Test Planning → Estimate  [BLOCKED] — 1 must req(s) missing TC: REQ-FUNC-002
    Estimate → Proposal       [BLOCKED] — 1 must req(s) missing COST: REQ-CON-001
    Proposal → Handoff        [BLOCKED] — coverage 40% (need ≥ 80%) and 2 must req(s) below 100%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Gap Severity Reference

| Gap Type | Condition | Severity | Why |
| --- | --- | --- | --- |
| Design gap | `designComponentIds` empty | critical | Unbounded scope — cascades to force test and cost gaps |
| Test gap | `testCaseIds` empty (DC present) | high | Untested requirement — no agreed pass/fail conditions |
| Cost gap | `costLineItemIds` empty (DC + TC present) | medium | Unpriced work — commercial risk only |

When a requirement has multiple missing links, only the worst (highest severity)
gap is reported per row. Design gap takes priority over test gap, which takes
priority over cost gap.

## Coverage Formula

```
coverage% = count(requirements where designComponentIds.length > 0
                                  AND testCaseIds.length > 0
                                  AND costLineItemIds.length > 0)
            / total requirements
            × 100
            (rounded to nearest integer)
```

This is the same formula used by `/sdlc-status` — both commands read directly
from `requirements[].traceForward` arrays in state.json, so they always agree.

## Rules

- NEVER write to state.json
- NEVER invoke any agent
- NEVER modify any file
- Always display the matrix even if all traceForward arrays are empty — show 0%
- Truncate requirement titles to 37 characters with `...` if longer
- Show "not yet run" only if `requirements[]` is completely absent from state.json

## Related Commands

- `/srs` — must run before `/traceability`; initialises `traceForward` arrays
- `/sds` — populates `designComponentIds`
- `/sts` — populates `testCaseIds`
- `/estimate` — populates `costLineItemIds`
- `/sdlc-status` — shows overall coverage percentage in the project dashboard

## Related Skills

- `skills/sdlc-traceability/SKILL.md` — four-link chain, scoring formula,
  gap classification, and worked example
