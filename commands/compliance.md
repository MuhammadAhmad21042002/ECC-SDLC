---
name: compliance
description: Run a full regulatory compliance assessment against validated requirements and design components. Scans SBP-2024, PPRA-2024, GDPR, ISO-27001, PCI-DSS, SAMA-2024, CBUAE, and AAOIFI framework keyword lists. Produces a compliance matrix, gap analysis, and remediation report. Can run at any phase after /srs completes.
---

# /compliance — Regulatory Compliance Assessment

## Purpose

`/compliance` produces:

- **`.sdlc/artifacts/compliance-vN.json`** — machine-readable compliance matrix with all control findings, evidence status, gaps, and remediation suggestions
- **`.sdlc/state.json` updates** — `complianceFlags[]` refreshed with full assessment results, `requirements[].complianceFrameworks` updated, phase advanced to `compliance`

This command can run at **any phase after `/srs` completes** — it is not gated to a specific phase. Running it after `/sds` gives richer results because design component evidence is also available.

---

## Preconditions

Read `.sdlc/state.json` and verify before doing any work:

- `artifacts.srs` is non-null — compliance requires at least a validated requirements set
- `requirements[]` contains at least one entry

`artifacts.sds` is optional — if present, design component descriptions are also scanned for evidence. If absent, compliance runs in requirements-only mode.

If the SRS precondition fails → stop and tell the user to run `/srs` first.

---

## Orchestration Steps

### Step 0 — Resolve and cache ECC runtime root (Bash — one call, read-only on state.json)

**This step runs first, every time. Never scans if eccRoot is already valid.**

```bash
node -e "
const os   = require('os');
const path = require('path');
const fs   = require('fs');

function hasEccRuntime(root) {
  if (!root || typeof root !== 'string' || !root.trim()) return false;
  const r = root.trim();
  return fs.existsSync(path.join(r, 'frameworks'))
    && fs.existsSync(path.join(r, 'agents', 'compliance-checker.md'))
    && fs.existsSync(path.join(r, 'skills', 'sdlc-compliance', 'SKILL.md'))
    && fs.existsSync(path.join(r, 'lib', 'schema-validator.js'));
}

const stateFile = path.join(process.cwd(), '.sdlc', 'state.json');
let cachedRoot = null;
try {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (s && s.eccRoot) cachedRoot = s.eccRoot;
} catch (_) {}

if (cachedRoot && hasEccRuntime(cachedRoot)) {
  console.log('ECC_ROOT_CACHED:' + cachedRoot);
  process.exit(0);
}

function resolveEccDir() {
  const envRoot = (process.env.CLAUDE_PLUGIN_ROOT || '').trim();
  if (hasEccRuntime(envRoot)) return path.resolve(envRoot);

  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');
  const candidates = [
    path.join(claudeDir, 'plugins', 'ecc-sdlc'),
    path.join(claudeDir, 'plugins', 'ecc-sdlc@ecc-sdlc'),
    path.join(claudeDir, 'plugins', 'marketplace', 'ecc-sdlc'),
    path.join(claudeDir, 'ecc'),
  ];
  for (const c of candidates) { if (hasEccRuntime(c)) return c; }

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (hasEccRuntime(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const resolved = resolveEccDir();
if (!resolved) {
  console.error('ECC_ROOT_NOT_FOUND');
  console.error('Set CLAUDE_PLUGIN_ROOT=<path> or run npm install inside the ECC repo.');
  process.exit(1);
}
console.log('ECC_ROOT_RESOLVED:' + resolved);
"
```

Store the resolved path as `ECC_DIR`. Steps 3 and 4 read it from `state.json` — they never scan again.

---

### Step 1 — Load state and check preconditions (Read + Write tools — no Bash)

Read `.sdlc/state.json`. Extract and record:

- `projectName`, `clientName`, `eccRoot`
- `requirements[]` — full array with all REQ-\* entries
- `designComponents[]` — may be empty if `/sds` has not run
- `artifacts.srs` — must be non-null (hard stop if missing)
- `artifacts.sds` — optional; capture path if present
- `artifacts.compliance.version` (default 0 if null) → `nextVersion = version + 1`
- `artifacts.compliance.versionHistory` — existing accumulated array, preserve for Step 4
- `complianceFlags[]` — existing array (will be replaced, not merged, in Step 4)

**If Step 0 resolved a new eccRoot:** write it back to state.json now using the Write tool. Preserve all other fields exactly.

**Determine assessment mode:**

- If `artifacts.sds` is non-null → **full mode** (requirements + design evidence check)
- If `artifacts.sds` is null → **requirements-only mode** (scan requirements, no evidence check against SDS)

---

### Step 2 — List available framework files (Bash — read-only)

```bash
node -e "
const path = require('path');
const fs   = require('fs');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — re-run /compliance from Step 0'); process.exit(1); }

const frameworksDir = path.join(ECC_DIR, 'frameworks');
if (!fs.existsSync(frameworksDir)) {
  console.error('frameworks/ directory not found in ECC root: ' + ECC_DIR);
  process.exit(1);
}

const files = fs.readdirSync(frameworksDir).filter(f => f.endsWith('.json'));
console.log('FRAMEWORKS:' + files.join(','));
console.log('FRAMEWORKS_DIR:' + frameworksDir);
"
```

Capture the list of framework files. Pass these paths to the compliance-checker agent in Step 3.

---

### Step 3 — Run compliance-checker agent (full mode)

Invoke `compliance-checker` with `sdlc-compliance` skill loaded.

Provide all of the following as context:

- `requirements[]` array from state.json (all REQ-FUNC/NFUNC/CON with full fields)
- `designComponents[]` array from state.json (may be empty)
- Path to each framework file: `{ECC_DIR}/frameworks/*.json` — agent must Read these
- `artifacts.srs.path` — agent should Read this file for evidence scanning
- `artifacts.sds.path` — agent should Read this file if present (full mode)
- Assessment mode: **full** (or **requirements-only** if sds artifact absent)

Instruct the agent to run in `/compliance` **full mode** and return exactly one JSON object:

```json
{
  "mode": "full",
  "complianceMatrix": [
    {
      "frameworkCode": "SBP-2024",
      "controlId": "SBP-SEC-001",
      "controlTitle": "Data Encryption at Rest",
      "triggeredBy": ["REQ-NFUNC-003", "DC-004"],
      "keyword": "encryption / AES / data at rest",
      "severity": "critical",
      "requiredEvidence": ["Encryption standard in SDS", "Key management procedure"],
      "evidenceFound": ["AES-256 specified in DC-004 responsibility"],
      "gaps": ["Key management procedure not documented"],
      "status": "partial",
      "remediationSuggestions": ["Add a Key Management component (DC-NNN) specifying key rotation policy, storage (HSM/KMS), and access controls"]
    }
  ],
  "complianceFlags": [
    {
      "frameworkCode": "SBP-2024",
      "controlId": "SBP-SEC-001",
      "controlTitle": "Data Encryption at Rest",
      "triggeredBy": "REQ-NFUNC-003",
      "keyword": "encryption / data at rest",
      "severity": "critical",
      "requiredEvidence": ["Encryption standard in SDS", "Key management procedure"],
      "status": "partial",
      "detectedAt": "<ISO 8601 timestamp>"
    }
  ],
  "requirementUpdates": [
    {
      "id": "REQ-NFUNC-003",
      "complianceFrameworks": ["SBP-2024", "ISO-27001"]
    }
  ],
  "gapAnalysis": {
    "totalControls": 0,
    "compliant": 0,
    "partial": 0,
    "nonCompliant": 0,
    "notApplicable": 0
  },
  "criticalGaps": [],
  "summary": {
    "frameworksCovered": ["SBP-2024", "GDPR"],
    "overallRiskLevel": "high",
    "recommendation": "Short paragraph on overall compliance posture and priority remediations"
  }
}
```

**If the agent returns no `complianceMatrix` or an empty array:** this means no framework keywords matched the project requirements — this is a valid result for non-regulated projects. Continue to Step 3.5.

**If the agent returns `mode: "requirements"` instead of `"full"`:** it ran in the wrong mode. Re-invoke with explicit instructions to use full mode.

---

### Step 3.5 — Validate compliance output (Bash — reads eccRoot from state.json)

Validate the agent's JSON against `schemas/compliance.schema.json` before writing anything to disk.

Write the agent's output to `.sdlc/tmp/compliance-data.json` first, then:

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — re-run /compliance from Step 0'); process.exit(1); }

fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'tmp'), { recursive: true });

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'validate-json.js'),
  '--schema',   'compliance',
  '--file',     path.join(process.cwd(), '.sdlc', 'tmp', 'compliance-data.json'),
  '--repoRoot', ECC_DIR,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

If validation fails → show AJV errors → ask the compliance-checker agent to fix the output → retry from Step 3. Do not write the artifact until validation passes.

---

### Step 4 — Write compliance artifact and update state (Write tool + Bash)

**4a — Write the compliance JSON artifact:**

Copy the validated `.sdlc/tmp/compliance-data.json` to the permanent artifact path:
`.sdlc/artifacts/compliance-v{nextVersion}.json`

Ensure `.sdlc/artifacts/` exists first. Then delete the tmp file.

**4b — Hash the artifact (Bash):**

```bash
node -e "
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const artifactPath = path.join(process.cwd(), '.sdlc', 'artifacts', 'compliance-v<nextVersion>.json');
if (!fs.existsSync(artifactPath)) {
  console.error('Compliance artifact not found — was Step 4a completed?');
  process.exit(1);
}

const hash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
console.log('OK:' + artifactPath + ':' + hash);
"
```

Replace `<nextVersion>` with the actual number from Step 1.

**4c — Update state.json (Write tool — no Bash):**

Read the current state.json (which may have been updated by other steps this session), then write the complete updated state. **Preserve `projectId` and `eccRoot` exactly.**

**Critical — versionHistory accumulation rule:**
`artifacts.compliance.versionHistory` is a **cumulative log**. Read the existing array from Step 1, then append the new entry for `{nextVersion}`.

**RequirementUpdates merge rule:**
For each entry in `requirementUpdates[]` from the agent, update the matching requirement in `requirements[]` by setting `complianceFrameworks` to the returned array.

**ComplianceFlags merge rule:**
Do **not** replace `state.complianceFlags[]` entirely. Instead, merge the agent's `complianceFlags[]` into the existing array using `(frameworkCode + controlId)` as the composite key:

- For each flag in the agent output, find any existing entry with the same `frameworkCode` + `controlId`.
- If found: update `status`, `evidenceFound`, `gaps`, and `detectedAt` in place — preserve everything else.
- If not found: append the new flag to the array.
  This ensures that flags written by `/srs` (Step 4.5) are updated with full-mode evidence findings rather than being silently discarded.

```json
{
  "...all existing fields...": "...",
  "projectId": "<preserved — never change>",
  "eccRoot": "<preserved — never change>",
  "currentPhase": "compliance",
  "phaseHistory": ["...all existing entries...", { "phase": "compliance", "startedAt": "{ISO 8601 now}", "completedAt": null }],
  "requirements": ["...all requirements with complianceFrameworks updated from requirementUpdates[]..."],
  "complianceFlags": ["...merged result: existing flags updated by frameworkCode+controlId key, new flags appended..."],
  "artifacts": {
    "...existing scope, srs, sds, sts, estimate entries preserved...": "...",
    "compliance": {
      "path": ".sdlc/artifacts/compliance-v{nextVersion}.json",
      "version": "{nextVersion}",
      "hash": "{sha256 from Step 4b}",
      "schemaId": "ecc-sdlc.compliance.v1",
      "createdAt": "{ISO 8601 — original createdAt if exists, else now}",
      "updatedAt": "{ISO 8601 now}",
      "versionHistory": [
        "...ALL prior entries from existing artifacts.compliance.versionHistory...",
        {
          "version": "{nextVersion}.0",
          "date": "{YYYY-MM-DD today}",
          "author": "ECC-SDLC",
          "changes": "{version 1: 'Initial compliance assessment', version N: describe what changed — e.g. re-assessed after SDS completed}",
          "status": "Draft"
        }
      ]
    }
  }
}
```

**Phase note:** Only advance `currentPhase` to `"compliance"` if it is not already at `"compliance"`, `"proposal"`, or `"handoff"`. Never regress the phase. `/compliance` is allowed at any phase after SRS — if the project is in `estimation`, keep it in `estimation` and only add the compliance artifact.

---

### Step 5 — Display compliance report (no Bash, no file writes)

Present a formatted summary to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Compliance Assessment — {projectName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mode:              {full | requirements-only}
  Frameworks scanned: {N} ({SBP-2024, PPRA-2024, ...})
  Overall risk:      {CRITICAL | HIGH | MEDIUM | LOW}

  Controls assessed: {totalControls}
    ✓ Compliant:     {compliant}
    ⚠ Partial:       {partial}
    ✗ Non-compliant: {nonCompliant}
    — Not applicable:{notApplicable}

  Flags by severity:
    Critical: {N}
    High:     {N}
    Medium:   {N}
    Low:      {N}

  Critical gaps requiring immediate action:
    {for each criticalGap: "• [controlId] {controlTitle} — {gap description}"}
    (or: "None — no critical gaps found")

  Artifact: .sdlc/artifacts/compliance-v{N}.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {summary.recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then list any critical and high-severity gaps with their remediation suggestions so the user can act immediately without opening the JSON file.

---

### Step 6 — Report completion

```
SDLC:COMPLIANCE:COMPLETE:[projectName]:[N] controls assessed, [N] gaps found ([N] critical) — ready for /proposal
```

---

## Re-running /compliance

`/compliance` is idempotent and can be re-run at any time after `/srs`. Common re-run triggers:

- After `/sds` completes (adds design-component evidence to the assessment)
- After adding or modifying requirements
- After a regulatory framework update (`frameworks/*.json` changed)
- Before generating the final `/proposal` to ensure the report is current

Each run increments `artifacts.compliance.version` and appends to `versionHistory`.

---

## Framework File Gaps

The agent currently has access to these on-disk framework files:

| File             | Framework | Domain                |
| ---------------- | --------- | --------------------- |
| `sbp-2024.json`  | SBP-2024  | Pakistani banking     |
| `ppra-2024.json` | PPRA-2024 | Pakistani procurement |
| `gdpr.json`      | GDPR      | EU data protection    |
| `iso-27001.json` | ISO-27001 | Information security  |
| `sama-2024.json` | SAMA-2024 | GCC banking           |

The following frameworks listed in `agents/compliance-checker.md` do **not yet have framework files** and will be skipped during scanning:

| Missing File        | Framework                    |
| ------------------- | ---------------------------- |
| `p3a-act-2017.json` | P3A-Act-2017 (Pakistani PPP) |
| `pci-dss.json`      | PCI-DSS (Payment card)       |
| `cbuae.json`        | CBUAE (UAE central bank)     |
| `aaoifi.json`       | AAOIFI (Islamic finance)     |

The agent will note these in `summary` and skip them. Add the missing framework files to enable full coverage.

---

## Error Handling

| Error                                | Action                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `ECC_ROOT_NOT_FOUND`                 | Set `CLAUDE_PLUGIN_ROOT` or run `npm install` in ECC repo                          |
| `artifacts.srs` missing              | Run `/srs` first — compliance requires validated requirements                      |
| frameworks/ directory not found      | Verify ECC root is correct; check `eccRoot` in state.json                          |
| Schema validation fails (Step 3.5)   | Agent output is structurally invalid — re-invoke agent with strict output contract |
| Agent returns empty complianceMatrix | Valid for non-regulated projects — continue to Step 4                              |
| Agent returns wrong mode             | Re-invoke with explicit full-mode instruction                                      |
| State write fails                    | Do not leave partial state — report error and stop                                 |

---

## Related Commands

- `/srs` — must run before `/compliance`
- `/sds` — run before `/compliance` for richer evidence checking
- `/proposal` — next step; includes a Compliance Statement section sourced from this output
- `/sdlc-status` — shows compliance flag counts in the dashboard
- `/traceability` — verifies full traceability coverage including compliance linkage

## Related Agents and Skills

- `agents/compliance-checker.md` — runs the 7-step compliance assessment (Step 3)
- `skills/sdlc-compliance/SKILL.md` — keyword matching methodology, severity definitions, output contract
- `frameworks/*.json` — regulatory control definitions and keyword lists
