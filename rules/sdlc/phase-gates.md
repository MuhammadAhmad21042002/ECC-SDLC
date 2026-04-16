# Phase Gate Rules

ECC-SDLC enforces a strict phase-gated progression. No phase can begin until
its prerequisites are complete. Claude must respect these gates and never
attempt to skip or bypass them.

---

## 1. Phase Order

Phases must be completed in this exact sequence:

```
discovery → requirements → design → test-planning → estimation → compliance → proposal → handoff
```

No phase can be skipped. No phase can run in parallel with another.

---

## 2. Phase Gate Prerequisites

| Phase | Command | Prerequisites | Blocked Until |
|---|---|---|---|
| Discovery | `/scope`, `/mom`, `/go-nogo` | None — no prerequisites required | — |
| Requirements | `/srs` | scope artifact exists in state.json | scope.md written |
| Design | `/sds` | SRS artifact exists in state.json | srs.docx generated |
| Test Planning | `/sts` | SRS + SDS artifacts exist | sds.docx generated |
| Estimation | `/estimate` | STS artifact exists | sts.docx generated |
| Proposal | `/proposal` | SRS + SDS + Estimate artifacts exist | all three generated |
| Handoff | auto (hook) | All 6 artifacts exist + `must` coverage 100% | proposal.docx generated |

**Commands allowed at any phase — no gate check:**

- `/sdlc-status` — always allowed
- `/compliance` — always allowed after SRS exists
- `/traceability` — allowed from Design phase onward
- `/mom` — always allowed

---

## 3. How Phase Gates Work

The phase-gate.js hook fires on every Write tool use. It:

1. Reads `.sdlc/state.json`
2. Checks `state.json.artifacts` for the required prerequisite artifacts — each artifact must be non-null
3. Verifies the artifact file actually exists on disk at the registered path
4. If prerequisites are missing — exits with code 2 (blocks the write)
5. If prerequisites exist — allows the write to proceed
6. Logs the gate check result to `.sdlc/sessions.log`

**Mode is controlled by environment variable:**

```bash
# Log only — observe behavior without blocking (default in Sprint 1)
export ECC_PHASE_GATE_MODE=logging

# Full enforcement — hard block on missing prerequisites (Sprint 2+)
export ECC_PHASE_GATE_MODE=enforcing
```

---

> **WARNING:** Logging mode is for internal development only. Never run a
> real client engagement with `ECC_PHASE_GATE_MODE=logging` — phase gates
> will not block anything and invalid phase transitions will go undetected.
> All client sessions must use `ECC_PHASE_GATE_MODE=enforcing`.

## 3.1 Artifact Deletion Recovery

If the phase-gate hook detects that a registered artifact path in state.json
points to a file that no longer exists on disk, follow this recovery process:

1. **Do not silently ignore it** — a missing artifact is a critical error
2. **Log the missing file** to `.sdlc/sessions.log` with timestamp
3. **Block the current operation** — exit code 2, same as a missing prerequisite
4. **Output a clear error message:**

```text
SDLC:ERROR:ARTIFACT_MISSING — [artifact type] registered at [path] not found on disk.
Re-run /[command] to regenerate it before continuing.
```

5. **Do not revert the phase** — phase history is preserved
6. **Do not modify state.json** — keep the registered path as-is
7. The user must re-run the appropriate command to regenerate the artifact

**Recovery commands by artifact:**

| Missing Artifact | Command to regenerate |
|---|---|
| scope | `/scope` |
| srs | `/srs` |
| sds | `/sds` |
| sts | `/sts` |
| estimate | `/estimate` |
| proposal | `/proposal` |

---

## 4. Bypass Rules

Phase gates can be bypassed only in these cases:

```bash
# Development and testing only — NEVER use in a client session
export ECC_PHASE_GATE_BYPASS=true
```

Bypass is permitted only when:

- Running smoke tests against fixture data
- Developing and testing a specific agent in isolation
- Explicitly approved by the team lead

Never use `ECC_PHASE_GATE_BYPASS=true` during a real client engagement.

---

## 5. Phase Transition Rules

When a phase completes, Claude must:

1. Verify the output artifact exists on disk at the registered path
2. Generate SHA-256 hash of the artifact file
3. Update `state.currentPhase` to the next phase name
4. Update `state.phaseHistory` — set `completedAt` for current phase,
   add new entry with `startedAt` for next phase
5. Update `state.artifacts` with path, version, hash, and createdAt
   for the newly generated artifact
6. Output the phase handoff signal so hooks can trigger

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const state = JSON.parse(fs.readFileSync('.sdlc/state.json', 'utf8'));
const filePath = '.sdlc/artifacts/srs-v1.docx';
const hash = 'sha256:' + crypto.createHash('sha256')
  .update(fs.readFileSync(filePath)).digest('hex');

// Complete current phase
const currentIdx = state.phaseHistory.findIndex(p => p.completedAt === null);
state.phaseHistory[currentIdx].completedAt = new Date().toISOString();

// Start next phase
state.phaseHistory.push({
  phase: 'design',
  startedAt: new Date().toISOString(),
  completedAt: null
});
state.currentPhase = 'design';

// Register artifact
state.artifacts.srs = {
  path: filePath,
  version: 1,
  hash: hash,
  createdAt: new Date().toISOString(),
  status: 'draft'
};

fs.writeFileSync('.sdlc/state.json', JSON.stringify(state, null, 2));
console.log('Phase transition complete');
"
```

---

## 6. Phase Handoff Signals

Claude must output these exact strings when a phase completes:

| Phase Completed | Signal |
|---|---|
| Discovery | `SDLC:SCOPE:COMPLETE:[projectName]:[N] requirements extracted, [N] compliance flags — ready for /srs` |
| Requirements | `SDLC:SRS:COMPLETE:[projectName]:[N] requirements validated — ready for /sds` |
| Design | `SDLC:SDS:COMPLETE:[projectName]:[N] components defined — ready for /sts` |
| Test Planning | `SDLC:STS:COMPLETE:[projectName]:[N] test cases defined — ready for /estimate` |
| Estimation | `SDLC:ESTIMATE:COMPLETE:[projectName]:[N] components, [totalFP] FP, [totalHours]h, [currency][totalCost] total — ready for /compliance or /proposal` |
| Proposal | `SDLC:PROPOSAL:COMPLETE:[projectName]:ready for delivery` |

---

## 7. /sdlc-status Output Format

The /sdlc-status command must always display:

```text
Project: [name]
Client:  [name]
Current Phase: [phase]

Artifacts:
  scope     [✓ v1 | ✗ missing]
  srs       [✓ v2 | ✗ missing]
  sds       [✗ missing]
  sts       [✗ missing]
  estimate  [✗ missing]
  proposal  [✗ missing]

Requirements: [N] total ([N] must, [N] should, [N] could, [N] wont)
Compliance Flags: [N] ([frameworks])
Traceability: [N]% design / [N]% test / [N]% cost
Open Questions: [N] unresolved
```

---

## 8. What Claude Must Never Do

- Run /srs if no scope artifact exists in state.json
- Run /sds if no SRS artifact exists in state.json
- Run /sts if no SDS artifact exists in state.json
- Run /estimate if no STS artifact exists in state.json
- Run /proposal if SRS, SDS, or estimate artifacts are missing
- Update currentPhase without also updating phaseHistory
- Skip writing the phase handoff signal
- Mark an artifact as complete if the file does not exist on disk
- Register an artifact in state.json without a SHA-256 hash
- Use ECC_PHASE_GATE_BYPASS=true in a client session
- Skip phases — every phase must produce its artifact before the next begins
