---
name: estimate
description: Generate a 3-sheet Excel cost model from design components. Applies FPA methodology via the Estimator agent, builds a live-formula .xlsx with Resource Plan / Effort by Phase / Cost Summary sheets, updates traceForward.costLineItemIds on all requirements, and registers the artifact. Requires /sds to have completed first.
---

# /estimate — Generate Cost Estimate (.xlsx)

## Purpose

`/estimate` produces:

- **`.sdlc/artifacts/estimate-v1.xlsx`** — 4-sheet Excel financial model with live formula chain:
  - **Sheet 1 "Resource Plan"** — one row per role with headcount, hours, hourly rate, total cost
  - **Sheet 2 "Effort by Phase"** — one row per design component with FPA type, complexity, effort hours
  - **Sheet 3 "Cost Summary"** — SUMPRODUCT formula referencing Sheet 2 hours × Sheet 1 rate; contingency and grand total formulas
  - **Sheet 4 "Gantt Timeline"** — hierarchical schedule (phase headers + component child rows) with a business-day calendar grid and colour-coded duration bars
- **`.sdlc/state.json` updates** — `artifacts.estimate` registered, `traceForward.costLineItemIds` populated on all requirements, phase advanced to `estimation`

## Preconditions

Read `.sdlc/state.json` and verify **all** before doing any work:

- `artifacts.sds` is non-null → if null, stop: `ERROR: No SDS artifact. Run /sds first.`
- `artifacts.sts` is non-null → if null, stop: `ERROR: No STS artifact. Run /sts before /estimate.`
- `designComponents[]` is non-empty → if empty, stop: `ERROR: No design components. Run /sds first.`
- `rateCard` object exists with at least one role entry → if missing, build it interactively from `teamRoles` (see Rate Card Format section)

If any precondition fails → stop and tell the user to complete the missing phase first.

---

## Orchestration Steps

### Step 0 — Resolve ECC runtime root (Bash — one call, read-only on state.json)

**This step runs first, every time. Never scans if eccRoot is already valid.**

```bash
node -e "
const os   = require('os');
const path = require('path');
const fs   = require('fs');

function hasEccRuntime(root) {
  if (!root || typeof root !== 'string' || !root.trim()) return false;
  const r = root.trim();
  return fs.existsSync(path.join(r, 'scripts', 'generate-xlsx.js'))
    && fs.existsSync(path.join(r, 'templates', 'estimation-template.json'))
    && fs.existsSync(path.join(r, 'node_modules', 'exceljs', 'package.json'));
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
    path.join(claudeDir, 'plugins', 'everything-claude-code'),
    path.join(claudeDir, 'plugins', 'everything-claude-code@everything-claude-code'),
    path.join(claudeDir, 'plugins', 'marketplace', 'everything-claude-code'),
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

Store the path from the output line as `ECC_DIR`. Steps 3 and 4 read it directly from `state.json` — they never scan again.

---

### Step 1 — Load state and check preconditions (Read tool — no Bash)

Read `.sdlc/state.json`. Verify:

- `artifacts.sds` is non-null → if null, stop: `ERROR: No SDS artifact found. Run /sds before /estimate.`
- `artifacts.sts` is non-null → if null, stop: `ERROR: No STS artifact found. Run /sts before /estimate.`
- `designComponents[]` has at least one entry → if empty, stop: `ERROR: No design components in state.json. Run /sds first.`
- `rateCard` object exists → if missing, go to **Step 1.5** before continuing

Extract and record:
- `eccRoot` → store as `ECC_DIR` (update state.json if Step 0 resolved a new path)
- `artifacts.estimate.version` (default 0 if null) → `nextVersion = version + 1`
- `artifacts.estimate.versionHistory` (existing array, preserve for Step 5)
- `rateCard`, `contingencyPct` (may be null)
- `projectStartDate` (ISO `YYYY-MM-DD`, optional) — used by the Estimator agent
  to build the Gantt schedule. If absent, the agent defaults to `today + 7 days`
  and flags it in `unmappableComponents`. No hard block — just a warning.

Write `eccRoot` back to state.json if Step 0 resolved a new path (same rule as `/scope` Step 1).

---

### Step 1.5 — Build rateCard interactively from teamRoles (only if rateCard missing)

**Skip this step entirely if `rateCard` already exists in state.json.**

Run this script to read `teamRoles` and print the prompt table:

```bash
node -e "
const fs   = require('fs');
const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const roles = state.teamRoles || [
  { key: 'juniorDev',  label: 'Junior Developer'   },
  { key: 'seniorDev',  label: 'Senior Developer'   },
  { key: 'architect',  label: 'Solution Architect' },
];
console.log('ROLES:' + JSON.stringify(roles));
"
```

Display this prompt to the user — **one role at a time**, using the `key` and `label` from `teamRoles`:

```
Hourly rates are needed to calculate project cost.
Rates will be saved to state.json and reused on future /estimate runs.

For each role, enter the hourly rate and currency.

  [1/N] <roleLabel> (<roleKey>)
        Hourly rate: ___
        Currency [USD]: ___

  [2/N] <roleLabel> (<roleKey>)
        Hourly rate: ___
        Currency [USD]: ___

  Contingency % [10]: ___
```

**Rules:**
- Role labels and keys come from `teamRoles` — never use hardcoded names
- Currency defaults to `USD` if the user presses Enter without typing
- Contingency defaults to `10` if the user presses Enter without typing
- Do NOT proceed to Step 2 until all roles have a non-zero hourlyRate

Once collected, write `rateCard` and `contingencyPct` to state.json immediately (before Step 2):

```json
"rateCard": {
  "<roleKey1>": { "hourlyRate": <number>, "currency": "<string>" },
  "<roleKey2>": { "hourlyRate": <number>, "currency": "<string>" }
},
"contingencyPct": <number>
```

---

### Step 2 — Run Estimator agent

Invoke the `estimator` agent.

Provide the path to `.sdlc/state.json` as context. The agent will:
1. Read `state.json.designComponents[]` and `state.json.rateCard`
2. Apply FPA methodology (Section 1–6 of agent spec)
3. Build the `estimatePlan` JSON object
4. Determine the output path dynamically from the current estimate version in state.json
5. Write `.sdlc/tmp/estimate-vN.json` using the Write tool
6. Run `scripts/validate-estimate.js` via Section 9 — exits non-zero on failure
7. Emit: `SDLC:ESTIMATE:COMPLETE:...`

**The agent does NOT write to state.json.** All state.json writes are owned by this command (Steps 4 and 5).

**If the agent reports validation errors:** fix the noted FP or hours issues, then re-run the agent from the start of Step 2.

---

### Step 3 — Validate estimate JSON (Bash — reads eccRoot from state.json)

**Run this before generating the xlsx. If it exits non-zero, stop immediately — do not proceed to Steps 3.5, 4, or 5.**

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — was Step 1 skipped?'); process.exit(1); }

const currentVersion = (state.artifacts && state.artifacts.estimate && state.artifacts.estimate.version)
  ? state.artifacts.estimate.version : 0;
const nextVersion = currentVersion + 1;
const jsonPath    = path.join(process.cwd(), '.sdlc', 'tmp', 'estimate-v' + nextVersion + '.json');

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'validate-estimate.js'),
  '--file', jsonPath,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

**On exit code 0 (`VALIDATION PASSED`):** continue to Step 3.5 → xlsx generation.
**On exit code 1 (`VALIDATION FAILED`):** show the error list to the user. Ask the Estimator agent to fix the reported issues, overwrite the JSON using the Write tool, then re-run this step. Do not generate the xlsx or update state.json until this exits 0.
**On exit code 2 (bad args / file not found):** the agent did not write the JSON file — re-run Step 2.

---

### Step 3.5 — Generate estimate-v{nextVersion}.xlsx (Bash — reads eccRoot from state.json)

**What `generate-xlsx.js` does automatically (no extra steps required):**

1. Reads the tmp estimate JSON
2. **Auto-injects a Gantt schedule** if `plan.gantt` is missing. Uses `state.json.projectStartDate` if present, otherwise defaults to `today + 7 days` and logs a warning.
3. Writes the 4-sheet xlsx (Resource Plan, Effort by Phase, Cost Summary, Gantt Timeline)

The tmp estimate JSON is intentionally **not** deleted here — Step 4 still needs to read it to build the traceForward map. Cleanup happens inside `scripts/finalize-traceforward.js` during Step 4.



```bash
node -e "
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — was Step 1 skipped?'); process.exit(1); }

const currentVersion = (state.artifacts && state.artifacts.estimate && state.artifacts.estimate.version)
  ? state.artifacts.estimate.version : 0;
const nextVersion = currentVersion + 1;

const jsonPath   = path.join(process.cwd(), '.sdlc', 'tmp', 'estimate-v' + nextVersion + '.json');
const xlsxPath   = path.join(process.cwd(), '.sdlc', 'artifacts', 'estimate-v' + nextVersion + '.xlsx');
const tmplPath   = path.join(ECC_DIR, 'templates', 'estimation-template.json');

if (!fs.existsSync(jsonPath)) {
  console.error('estimate JSON not found at: ' + jsonPath);
  console.error('The Estimator agent did not complete successfully — re-run Step 2.');
  process.exit(1);
}

fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'artifacts'), { recursive: true });

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'generate-xlsx.js'),
  '--template', tmplPath,
  '--data',     jsonPath,
  '--output',   xlsxPath,
], { stdio: ['inherit', 'pipe', 'inherit'] });

if ((res.status ?? 1) !== 0) {
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(res.status ?? 1);
}

const hash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(xlsxPath)).digest('hex');
console.log('OK:' + xlsxPath + ':' + hash + ':v' + nextVersion);
"
```

**Success:** one stdout line: `OK:<xlsxPath>:sha256:<hex>:v<N>`. Extract path, hash, and version for Step 5.

**If generate-xlsx.js exits non-zero:** check that `exceljs` is installed (`npm install` in the ECC root), then retry.

---

### Step 4 — Update traceForward.costLineItemIds + sweep tmp (Bash — single script call)

This step delegates to `scripts/finalize-traceforward.js`, a dedicated Node.js script that **atomically** performs two actions in one process:

1. Reads the tmp estimate JSON, assigns `COST-NNN` identifiers per `effortBreakdown` row, and stamps every matching requirement's `traceForward.costLineItemIds` array in `state.json`
2. Sweeps every `estimate-v*.json` file from `.sdlc/tmp/`

Both actions live inside the same Node.js process — **do not split this into multiple steps.** If the first action succeeds, cleanup happens automatically in the same invocation. There is no separate cleanup step to skip.

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const statePath = path.join(process.cwd(), '.sdlc', 'state.json');
const state     = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const ECC_DIR   = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — was Step 1 skipped?'); process.exit(1); }

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'finalize-traceforward.js'),
  '--state', statePath,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

If this step exits non-zero, investigate the error before continuing — do not skip the traceForward update.

---

### Step 5 — Register artifact and save state (Write tool — no Bash)

Write the complete updated state to `.sdlc/state.json`. **Preserve `projectId` and `eccRoot` exactly.**

**Critical — versionHistory accumulation rule:**
`artifacts.estimate.versionHistory` is a **cumulative log** — never replace it with a single entry.
Read the existing `versionHistory` array from state.json (from Step 1), then **append** the new
entry for `{nextVersion}` to the end.

Use the `xlsx path` and `hash` from Step 3.

```json
{
  "...all existing fields...": "...",
  "projectId": "<preserved — never change>",
  "eccRoot": "<preserved — never change>",
  "currentPhase": "estimation",
  "phaseHistory": [
    "...all existing entries...",
    { "phase": "estimation", "startedAt": "{ISO 8601 now}", "completedAt": null }
  ],
  "artifacts": {
    "...existing scope, srs, sds, sts entries preserved...": "...",
    "estimate": {
      "path": ".sdlc/artifacts/estimate-v{nextVersion}.xlsx",
      "version": "{nextVersion}",
      "hash": "{sha256 from Step 3}",
      "createdAt": "{ISO 8601 — original createdAt if exists, else now}",
      "updatedAt": "{ISO 8601 now}",
      "versionHistory": [
        "...ALL prior entries from existing artifacts.estimate.versionHistory (preserve every existing row)...",
        {
          "version": "{nextVersion}.0",
          "date": "{YYYY-MM-DD today}",
          "author": "ECC-SDLC",
          "changes": "{version 1: 'Initial estimate — FPA applied to all design components', version N: describe what changed in this run}"
        }
      ]
    }
  }
}
```

**Note:** the Estimator agent already wrote `artifacts.estimate.path` pointing to the JSON in Step 2. Step 5 overwrites that entry to point to the `.xlsx` as the primary deliverable. The temporary JSON file was removed in Step 4.5 after all consumers finished.

---

### Step 6 — Confirm completion

Output the handoff signal:

```
SDLC:ESTIMATE:COMPLETE:[projectName]:[N] design components, [totalFP] FP, [totalHours]h, [currency][totalCost] total — ready for /compliance or /proposal
```

Then display a summary table:

```
Estimate complete
  File:          .sdlc/artifacts/estimate-v{N}.xlsx
  Design components processed: {N}
  Total function points:        {totalFP}
  Total effort hours:           {totalHours}h
  Total cost:                   {currency}{totalCost}
  Contingency:                  {contingencyPct}% ({contingencyAmount}) [or "none"]
  Cost IDs assigned:            COST-001 … COST-{N}
  Requirements updated:         {N} requirements have costLineItemIds populated
  Gantt schedule:               {projectStartDate} → {projectEndDate} ({totalBusinessDays} business days)
  Start date source:            {state.json | default-fallback (projectStartDate missing)}

Open the .xlsx in Excel or Google Sheets to review and adjust the financial model.
Sheet 3 "Cost Summary" recalculates automatically when you change hourly rates in Sheet 1.
Sheet 4 "Gantt Timeline" shows the project schedule — phase rollups in grey, component bars coloured by role (architect=blue, seniorDev=green, juniorDev=amber).
```

---

## Live Formula Chain

The generated .xlsx uses the following formula chain so rate changes cascade automatically:

| Cell | Formula |
|------|---------|
| Cost Summary G2 (effortCost) | `=SUMPRODUCT('Effort by Phase'!$K$2:$K${N}, IFERROR(VLOOKUP('Effort by Phase'!$B$2:$B${N},'Resource Plan'!$A:$I,9,FALSE),0))` |
| Cost Summary G3 (infrastructure) | manual numeric input |
| Cost Summary G4 (licences) | manual numeric input |
| Cost Summary G5 (contingency) | `=G2*{contingencyRate}` |
| Cost Summary G6 (grand total) | `=SUM(G2:G5)` |

**Rate cascade:** change any `Hourly Rate` cell in Sheet 1 ("Resource Plan") → Sheet 3 G2 recalculates via VLOOKUP → G5 recalculates → G6 (grand total) recalculates automatically.

---

## Rate Card Format

`state.json.rateCard` is built during `/estimate` from `state.json.teamRoles` established in `/scope`.
Role keys in `rateCard` always match `teamRoles` keys — no mismatch is possible.

**If `rateCard` is absent when `/estimate` runs:**

1. Read `state.json.teamRoles`
2. For each role, ask the user for `hourlyRate` and `currency`:
   ```
   Hourly rates needed for estimation.
   Enter rate for juniorDev  (Junior Developer)   [USD]: ___
   Enter rate for seniorDev  (Senior Developer)   [USD]: ___
   Enter rate for architect  (Solution Architect) [USD]: ___
   ```
3. Write the completed rateCard to `state.json`:
   ```json
   "rateCard": {
     "juniorDev": { "hourlyRate": <entered>, "currency": "<entered>" },
     "seniorDev": { "hourlyRate": <entered>, "currency": "<entered>" },
     "architect": { "hourlyRate": <entered>, "currency": "<entered>" }
   }
   ```
   Role keys come directly from `teamRoles[*].key` — never hardcoded.

**If `rateCard` already exists** (user pre-populated it): use as-is, no prompting needed.

Optional fields in state.json:
- `"contingencyPct": 10` — risk buffer percentage (default 10 if absent)
- `"roleAllocations": { "architect": 0.15, "seniorDev": 0.60, "juniorDev": 0.25 }` — override default allocation percentages
- `"infrastructureCost": 5000` — pre-fill infrastructure cost row
- `"licenseCost": 2000` — pre-fill licence cost row

---

## Error Handling

| Error | Action |
|-------|--------|
| `ECC_ROOT_NOT_FOUND` | Set `CLAUDE_PLUGIN_ROOT=<path>` or run `npm install` in the ECC repo root |
| `eccRoot missing from state.json` | Step 1 did not complete — check for write errors and re-run |
| Precondition: no SDS artifact | Run `/sds` first |
| Precondition: empty designComponents | Run `/sds` first — it populates designComponents |
| Precondition: rateCard missing | `/estimate` prompts for hourly rates and builds rateCard from `teamRoles` automatically |
| Agent validation errors | Fix FP or hours issues as reported, re-run Step 2 |
| generate-xlsx.js not found | Run `npm install` inside the ECC repo root |
| exceljs not installed | Run `npm install exceljs` inside the ECC repo root |
| traceForward update exits non-zero | Inspect error, fix the condition, and re-run Step 4 |

---

## Idempotency Contract

| Run | `projectId` | `eccRoot` | `estimate.version` | Output |
|-----|-------------|-----------|-------------------|--------|
| First | unchanged | cached | 1 | `estimate-v1.xlsx` |
| Second | unchanged | cached | 2 | `estimate-v2.xlsx` |

Re-running `/estimate` increments the version, overwrites the prior xlsx reference in state.json, but keeps versionHistory intact.

---

## Related Commands

- `/sds` — must run before `/estimate`
- `/compliance` — can run at any phase after /srs
- `/proposal` — next step, requires SRS + SDS + estimate artifacts
- `/sdlc-status` — current phase and artifact inventory
- `/traceability` — verify costLineItemIds coverage after /estimate

## Related Agents and Skills

- `agents/estimator.md` — FPA estimation engine (Step 2)
- `scripts/generate-xlsx.js` — ExcelJS financial model generator (Step 3)
- `templates/estimation-template.json` — 3-sheet layout and formula definitions
