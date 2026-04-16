---
name: sdlc-status
description: Display current pipeline phase, artifact statuses with hashes, requirement counts by type, compliance flags, and traceability coverage. Read-only dashboard — no writes to state.json.
---

## Overview

This command reads `.sdlc/state.json` and displays a formatted project status
dashboard. It is completely read-only — it never writes to state.json, never
invokes an agent, and never modifies any file.

Run this command at any time to check where you are in the pipeline.

## Workflow

1. Check if `.sdlc/state.json` exists:

```bash
cat .sdlc/state.json 2>/dev/null || echo "STATE_NOT_FOUND"
```

2. If `STATE_NOT_FOUND`, display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ECC-SDLC Project Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase: not started

  No project found in this directory.
  Run /scope to initialize a new project and
  generate the first scope document.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

3. If state.json exists, read and display using this Node.js script:

```bash
node -e "
const fs = require('fs');

try {
  const statePath = '.sdlc/state.json';
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  const line = '━'.repeat(50);

  // Header
  console.log(line);
  console.log('  ECC-SDLC Project Status');
  console.log(line);
  console.log('  Project : ' + (s.projectName || 'Unknown'));
  console.log('  Client  : ' + (s.clientName  || 'Unknown'));
  console.log('  Phase   : ' + (s.currentPhase || 'not started'));
  console.log('');

  // ─── Artifacts ───────────────────────────────────────────
  console.log('  Artifacts:');
  const artifactKeys = ['scope','srs','sds','sts','estimate','proposal'];

  for (const key of artifactKeys) {
    const a = s.artifacts && s.artifacts[key];

    if (a && a.path) {
      let shortHash = 'no hash';

      if (a.hash) {
        const raw = a.hash.replace('sha256:', '');
        shortHash = 'sha256:' + raw.substring(0, 8) + '...';
      }

      console.log(
        '    ' +
        key.padEnd(10) +
        ' v' + a.version +
        '  ' + shortHash
      );
    } else {
      console.log('    ' + key.padEnd(10) + ' ✗ not generated');
    }
  }

  console.log('');

  // ─── Requirements ────────────────────────────────────────
  const reqs = Array.isArray(s.requirements) ? s.requirements : [];

  const func  = reqs.filter(r => r.type === 'functional').length;
  const nfunc = reqs.filter(r => r.type === 'non-functional').length;
  const con   = reqs.filter(r => r.type === 'constraint').length;

  console.log('  Requirements: ' + reqs.length + ' total');
  console.log('    REQ-FUNC  : ' + func);
  console.log('    REQ-NFUNC : ' + nfunc);
  console.log('    REQ-CON   : ' + con);

  const must   = reqs.filter(r => r.priority === 'must').length;
  const should = reqs.filter(r => r.priority === 'should').length;
  const could  = reqs.filter(r => r.priority === 'could').length;
  const wont   = reqs.filter(r => r.priority === 'wont').length;

  console.log('    Must/Should/Could/Wont: ' + must + '/' + should + '/' + could + '/' + wont);
  console.log('');

  // ─── Compliance ──────────────────────────────────────────
  const flags = Array.isArray(s.complianceFlags) ? s.complianceFlags : [];

  if (flags.length === 0) {
    console.log('  Compliance: not yet run — execute /compliance first');
  } else {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };

    for (const f of flags) {
      if (counts[f.severity] !== undefined) {
        counts[f.severity]++;
      }
    }

    console.log(
      '  Compliance: ' +
      'critical ' + counts.critical + ' | ' +
      'high ' + counts.high + ' | ' +
      'medium ' + counts.medium + ' | ' +
      'low ' + counts.low
    );
  }

  console.log('');

  // ─── Traceability ────────────────────────────────────────
  const hasTraceability = reqs.some(r => r.traceForward);

  if (reqs.length === 0 || !hasTraceability) {
    console.log('  Traceability: not yet run — execute /traceability first');
  } else {
    const fullyTraced = reqs.filter(r =>
      r.traceForward &&
      Array.isArray(r.traceForward.designComponentIds) && r.traceForward.designComponentIds.length > 0 &&
      Array.isArray(r.traceForward.testCaseIds) && r.traceForward.testCaseIds.length > 0 &&
      Array.isArray(r.traceForward.costLineItemIds) && r.traceForward.costLineItemIds.length > 0
    ).length;

    const pct = ((fullyTraced / reqs.length) * 100).toFixed(1);

    console.log('  Traceability: ' + pct + '%');
  }

  console.log('');

  // ─── Open Questions ──────────────────────────────────────
  const openQs = reqs.filter(r =>
    Array.isArray(r.assumptions) && r.assumptions.length > 0
  ).length;

  if (openQs > 0) {
    console.log('  Open Questions: ' + openQs + ' pending client clarification');
    console.log('');
  }

  // ─── Phase History ───────────────────────────────────────
  console.log('  Phase History:');

  const history = Array.isArray(s.phaseHistory) ? s.phaseHistory : [];

  for (const h of history) {
    const started   = h.startedAt ? h.startedAt.substring(0, 10) : 'unknown';
    const completed = h.completedAt ? h.completedAt.substring(0, 10) : 'in progress';

    console.log(
      '    ' +
      (h.phase || '?').padEnd(16) +
      ' started ' + started +
      '  ' + completed
    );
  }

  console.log('');

  // ─── Next Step ───────────────────────────────────────────
  const nextCommands = {
    'discovery':     '/srs — generate Software Requirements Specification',
    'requirements':  '/sds — generate Software Design Specification',
    'design':        '/sts — generate Software Test Specification',
    'test-planning': '/estimate — generate cost model and resource plan',
    'estimation':    '/compliance — run regulatory compliance check',
    'compliance':    '/proposal — assemble the final proposal',
    'proposal':      'Project complete — ready for handoff'
  };

  const nextStep = nextCommands[s.currentPhase];

  if (nextStep) {
    console.log('  Next: Run ' + nextStep);
  }

  console.log(line);

} catch (err) {
  console.log('ERROR: .sdlc/state.json exists but could not be parsed.');
  console.log('The file may be corrupted. Check the file manually or');
  console.log('restore from .sdlc/state.json.bak if available.');
}
"
```

4. Do NOT modify state.json at any point. This command is read-only.

5. If state.json exists but is malformed (invalid JSON), display:

```
ERROR: .sdlc/state.json exists but could not be parsed.
The file may be corrupted. Check the file manually or
restore from .sdlc/state.json.bak if available.
```

## Output Format Reference

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ECC-SDLC Project Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Project : Punjab Revenue Authority Tax Portal
  Client  : Punjab Revenue Authority (PRA)
  Phase   : compliance

  Artifacts:
    scope      v1  sha256:29dec3e5...
    srs        v1  sha256:a1b2c3d4...
    sds        v1  sha256:e5f6a7b8...
    sts        v1  sha256:c9d0e1f2...
    estimate   v1  sha256:34567890...
    proposal   ✗ not generated

  Requirements: 28 total
    REQ-FUNC  : 13
    REQ-NFUNC : 8
    REQ-CON   : 7
    Must/Should/Could/Wont: 18/7/1/2

  Compliance: critical 3 | high 4 | medium 0 | low 0

  Traceability: 80.0%

  Phase History:
    discovery        started 2026-03-30  2026-03-31
    requirements     started 2026-04-01  2026-04-02
    design           started 2026-04-03  2026-04-05
    test-planning    started 2026-04-06  2026-04-07
    estimation       started 2026-04-07  2026-04-08
    compliance       started 2026-04-08  in progress

  Next: Run /proposal — assemble the final proposal
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Rules

- NEVER write to state.json
- NEVER invoke any agent
- NEVER modify any file
- Always display output even if some fields are missing — use "not yet run"
  or "unknown" for missing values
- Response must complete in under 2 seconds on any state.json up to 50 requirements
