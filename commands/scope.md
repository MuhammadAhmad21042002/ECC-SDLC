---
name: scope
description: Run the SDLC discovery phase. Accepts an RFP, client brief, meeting notes, or any unstructured input. Extracts scope using the business-analyst agent, validates the output, generates scope.docx, and initialises .sdlc/state.json. Pipeline entry point — must complete before /srs.
---

# /scope — SDLC Discovery Phase

## Purpose

`/scope` is the entry point of the ECC-SDLC pipeline. It produces:

- **`.sdlc/state.json`** — project state with a UUID v4 `projectId`, `currentPhase: "discovery"`, and a registered scope artifact entry
- **`.sdlc/artifacts/scope-vN.docx`** — a formatted Scope Document with all sections populated

## Inputs to Gather

Ask the user for these four things before doing any work:

1. **Project name** (e.g. "FBR AI Knowledge Platform")
2. **Client name** (e.g. "Federal Board of Revenue")
3. **RFP / brief content** — pasted text, or a file path to read
4. **Team roles** — ALWAYS ask this, even if the user did not mention it.
   Display the defaults and wait for explicit confirmation before proceeding:

   ```
   The following default team roles will be used for this project.
   Please confirm, modify, or add roles before we continue.

   #   Role Key    Label                  Hours/FP
   1   juniorDev   Junior Developer       12
   2   seniorDev   Senior Developer        8
   3   architect   Solution Architect      6

   Options:
     - Type "confirm" or press Enter to accept these defaults
     - Type "edit N" to change a role (e.g. "edit 2")
     - Type "add" to add a new role
     - Type "remove N" to remove a role
   ```

   **Do NOT proceed to Step 0 until the user has explicitly confirmed or modified the team roles.**

   For each custom role the user adds, collect: key (camelCase, no spaces), label, and hoursPerFP.
   hoursPerFP guidance: entry-level = 12, mid-level = 8, senior/lead = 6, principal/architect = 4–6.

5. **Team profiles** (optional) — AFTER team roles are confirmed, ask:

   ```
   Would you like to register specific team members for the proposal now?
   These names, experience, and project history will appear verbatim in the
   proposal's "Team Profiles" section. You can skip this and let /proposal
   fill it later.

   Options:
     - Type "skip" or press Enter to skip
     - Type "add" to register a team member
   ```

   For each team member the user adds, collect:
   - `name` (e.g. "Dr. Arif Mahmood")
   - `roleKey` — must match one of the confirmed `teamRoles[*].key` values exactly
   - `yearsExperience` (free-text string, e.g. "22 years")
   - `relevantProjects` (semicolon-delimited string describing prior engagements)

   **Validation rule — hard block:** If the user enters a `roleKey` that is not
   in the confirmed `teamRoles` list, reject with:

   ```
   Role key "<entered>" is not in teamRoles. Valid keys: <comma-separated list>.
   To add a new role, go back to Step 4 and use "add".
   ```

   Do NOT silently create a new role from a profile entry — role changes affect
   FP estimation and belong in Input 4, not here.

   Multiple profiles may share the same `roleKey` (e.g. three juniorDev members).
   A `roleKey` with zero profiles is also valid — roles exist for estimation
   regardless of whether specific people are named.

   For each confirmed profile, also populate the `role` field from the matching
   `teamRoles[*].label` so renderers have a human-readable label without a lookup.

If the user gives a file path, use the `Read` tool to load it. If multiple files, read all before proceeding.

---

## Orchestration Steps

### Step 0 — Resolve the ECC runtime root (Bash — one call, read-only on state.json)

**This step runs first, every time. It is the only place directory scanning happens.**

**Critical design rule: Step 0 never writes to `state.json`.** It only prints the resolved path
to stdout. Step 1 is the sole owner of `state.json` and is responsible for writing `eccRoot`
into it — whether creating it fresh or updating an existing file.

Logic:

- If `state.json` exists and already has a valid `eccRoot` field → print it and skip scanning.
- Otherwise → scan candidate directories → print the result.
- Either way, Step 1 will write `eccRoot` into `state.json` on this run.

```bash
node -e "
const os   = require('os');
const path = require('path');
const fs   = require('fs');

function hasEccRuntime(root) {
  if (!root || typeof root !== 'string' || !root.trim()) return false;
  const r = root.trim();
  return fs.existsSync(path.join(r, 'scripts', 'generate-scope-doc.js'))
    && fs.existsSync(path.join(r, 'scripts', 'validate-json.js'))
    && fs.existsSync(path.join(r, 'schemas', 'scope.schema.json'))
    && fs.existsSync(path.join(r, 'lib', 'schema-validator.js'))
    && fs.existsSync(path.join(r, 'lib', 'doc-generator', 'generic-doc.js'))
    && fs.existsSync(path.join(r, 'templates', 'scope-template.json'))
    && fs.existsSync(path.join(r, 'node_modules', 'docx', 'package.json'));
}

// Read-only: try cached value from state.json
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

// Cache miss or first run — scan
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
  for (const c of candidates) {
    if (hasEccRuntime(c)) return c;
  }
  // Walk up from cwd — handles running from inside the ECC repo
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
  console.error('Fix: set CLAUDE_PLUGIN_ROOT=<path> or run npm install inside the ECC repo.');
  process.exit(1);
}

// Print only — Step 1 writes this into state.json
console.log('ECC_ROOT_RESOLVED:' + resolved);
"
```

**Read the output line and store the path as `ECC_DIR` for this entire run:**

- `ECC_ROOT_CACHED:<path>` — valid cache hit, no scanning done.
- `ECC_ROOT_RESOLVED:<path>` — freshly scanned. Step 1 will persist this into `state.json`.
- Exit code 1 / `ECC_ROOT_NOT_FOUND` — stop. Tell the user to set `CLAUDE_PLUGIN_ROOT` or run `npm install` in the ECC repo.

**Steps 3c and 5 read `eccRoot` directly from `state.json`. They never scan.**

---

### Step 1 — Initialise or resume state (Write tool — no Bash)

**Step 1 is the sole writer of `.sdlc/state.json`. It always writes `eccRoot` — on both first run and resume.**

Read `.sdlc/state.json` with the `Read` tool.

**Case A — file does NOT exist (first run):**

Create it now with the `Write` tool using this exact structure. `eccRoot` comes from Step 0.

```json
{
  "$schema": "../schemas/sdlc-state.schema.json",
  "projectId": "<generate a UUID v4>",
  "projectName": "<projectName from user>",
  "clientName": "<clientName from user>",
  "eccRoot": "<ECC_DIR resolved in Step 0>",
  "currentPhase": "discovery",
  "phaseHistory": [{ "phase": "discovery", "startedAt": "<ISO 8601 timestamp>", "completedAt": null }],
  "artifacts": {
    "scope": null,
    "srs": null,
    "sds": null,
    "sts": null,
    "estimate": null,
    "proposal": null
  },
  "teamRoles": [
    { "key": "juniorDev",  "label": "Junior Developer",   "hoursPerFP": 12 },
    { "key": "seniorDev",  "label": "Senior Developer",   "hoursPerFP": 8  },
    { "key": "architect",  "label": "Solution Architect", "hoursPerFP": 6  }
  ],
  "teamProfiles": [],
  "requirements": [],
  "designComponents": [],
  "testCases": [],
  "complianceFlags": [],
  "traceabilityMatrix": {}
}
```

Replace `teamRoles` with the user's confirmed list from Input 4. The array above represents the defaults shown to the user — always use the final confirmed/modified list, never silently apply defaults without the user seeing and acknowledging them.

Generate UUID v4 yourself (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`).

**Case B — file DOES exist (resume):**

Read the existing content. Then write it back with these fields preserved or updated:

- `projectId` — **never change**
- `eccRoot` — **always set to `ECC_DIR` from Step 0** (this is how the cache gets written on the very first real run, and how it gets corrected if the path ever changes)
- `teamRoles` — preserve if already present; if absent, write defaults or the user's confirmed list from Input 4
- `teamProfiles` — preserve if already present. If the user added new profiles in Input 5 this run, **append** them to the existing array (do not replace). If absent, initialise as `[]`. Before writing, verify every profile's `roleKey` matches a `teamRoles[*].key` in the final confirmed list — if any mismatch, halt and report which profile is invalid.
- All other existing fields — preserve unchanged
- Note the current `artifacts.scope.version` (default 0 if null) for Step 4

The write on resume looks like:

```json
{
  "...all existing fields preserved...": "...",
  "eccRoot": "<ECC_DIR from Step 0 — overwrite with current resolved value>"
}
```

This means `eccRoot` is always fresh after any `/scope` run, regardless of how `state.json` was created.

---

### Step 2 — Extract scope (Business Analyst agent)

Invoke the `business-analyst` agent with the `sdlc-requirements` skill loaded.

Give it all the RFP/brief content. Instruct it to produce a **structured JSON object** with this exact shape:

```json
{
  "projectOverview": "1-3 paragraph summary of the project",
  "objectives": ["objective 1", "objective 2"],
  "inScope": [{ "id": "SCOPE-001", "title": "Feature or capability", "description": "Detail" }],
  "outOfScope": ["item 1", "item 2"],
  "stakeholders": [{ "name": "Name", "role": "Role", "organization": "Org", "contactType": "client sponsor" }],
  "assumptions": ["assumption 1"],
  "constraints": [{ "type": "timeline", "description": "Detail" }],
  "risks": [{ "id": "RISK-001", "description": "Risk", "likelihood": "medium", "impact": "high", "mitigation": "Mitigation" }],
  "complianceFlags": [],
  "deliverables": ["Deliverable 1"]
}
```

**`timeline` (optional):** Omit entirely if dates are unknown. If included, all date fields must be `YYYY-MM-DD`. Never use `"TBD"` in date fields.

The BA agent must output only this JSON. It must NOT write files or run scripts.

---

### Step 3 — Merge, persist, and validate scope JSON

#### Step 3a — Merge enrichment (Write tool — no Bash)

- Start from the BA agent's JSON.
- Add `projectName` and `clientName` from Step 1.
- Optionally add `preparedBy` (default `ECC-SDLC`).

#### Step 3b — Write temp file (Write tool — no Bash)

Write merged object to **`.sdlc/tmp_scope_data.json`**.

#### Step 3c — Validate with AJV (Bash — reads eccRoot from state.json, no scan)

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing from state.json — was Step 1 skipped?'); process.exit(1); }

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'validate-json.js'),
  '--schema',   'scope',
  '--file',     path.join(process.cwd(), '.sdlc', 'tmp_scope_data.json'),
  '--repoRoot', ECC_DIR,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

If validation fails, fix the reported fields, then repeat Step 3a–3c.

---

### Step 4 — Determine output path (no Bash)

- `state.artifacts.scope` is null → `nextVersion = 1`
- Otherwise → `nextVersion = state.artifacts.scope.version + 1`

Output path: `.sdlc/artifacts/scope-v{nextVersion}.docx`

---

### Step 5 — Generate scope.docx (Bash — reads eccRoot from state.json, no scan)

```bash
node -e "
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing from state.json — was Step 1 skipped?'); process.exit(1); }

const outputPath = path.join(process.cwd(), '.sdlc', 'artifacts', 'scope-v<nextVersion>.docx');

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'generate-scope-doc.js'),
  '--data',     path.join(process.cwd(), '.sdlc', 'tmp_scope_data.json'),
  '--out',      outputPath,
  '--template', path.join(ECC_DIR, 'templates', 'scope-template.json'),
  '--version',  '<nextVersion>',
  '--state',    path.join(process.cwd(), '.sdlc', 'state.json'),
], { stdio: ['inherit', 'pipe', 'inherit'] });

if ((res.status ?? 1) !== 0) {
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(res.status ?? 1);
}

const hash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
console.log('OK:' + outputPath + ':' + hash);
try { fs.unlinkSync(path.join(process.cwd(), '.sdlc', 'tmp_scope_data.json')); } catch (_) {}
"
```

Replace `<nextVersion>` with the actual number from Step 4.

**Success:** one stdout line: `OK:<path>:sha256:<hex>`. Use path and hash in Step 6.

---

### Step 6 — Register artifact and save state (Write tool — no Bash)

Write the complete updated state to `.sdlc/state.json`. **Always preserve `projectId` and `eccRoot` exactly.**

**Critical — versionHistory accumulation rule:**
`artifacts.scope.versionHistory` is a **cumulative log** — never replace it with a single entry.
Read the existing `versionHistory` array from state.json (if it exists), then **append** the new
entry for `{nextVersion}` to the end. The final array must contain all prior entries plus the new one.

```json
{
  "...all existing fields...": "...",
  "projectId": "<preserved — never change>",
  "eccRoot": "<preserved — never change>",
  "currentPhase": "requirements",
  "phaseHistory": [
    { "phase": "discovery", "startedAt": "{existing}", "completedAt": "{ISO 8601 now}" },
    { "phase": "requirements", "startedAt": "{ISO 8601 now}", "completedAt": null }
  ],
  "artifacts": {
    "...existing...": "...",
    "scope": {
      "path": ".sdlc/artifacts/scope-v{nextVersion}.docx",
      "version": "{nextVersion}",
      "hash": "{sha256 from Step 5}",
      "createdAt": "{ISO 8601 — original createdAt if it exists, else now}",
      "updatedAt": "{ISO 8601 now}",
      "versionHistory": [
        "...ALL prior entries from existing state.json artifacts.scope.versionHistory (preserve every existing row)...",
        {
          "version": "{nextVersion}.0",
          "date": "{YYYY-MM-DD today}",
          "author": "{preparedBy from scope data, or ECC-SDLC}",
          "changes": "{version 1: 'Initial draft — scope extracted from RFP/brief', version N: describe what changed in this run}"
        }
      ]
    }
  }
}
```

**Example:** if state already has `versionHistory: [{ version: "9.0", ... }, { version: "10.0", ... }]`
and you are generating version 11, the written array must be:
`[{ version: "9.0", ... }, { version: "10.0", ... }, { version: "11.0", date: "today", ... }]`
Never discard the existing rows.

---

### Step 7 — Confirm completion

```
SDLC:SCOPE:COMPLETE:[projectName]:[N] requirements extracted, [N] compliance flags — ready for /srs
```

---

## How ECC Root Caching Works

```
FIRST RUN (state.json does not exist):
  Step 0  → reads state.json → file missing → scans directories → prints ECC_ROOT_RESOLVED:<path>
  Step 1  → state.json missing → writes full structure including eccRoot from Step 0
  Step 3c → reads eccRoot from state.json ✓
  Step 5  → reads eccRoot from state.json ✓

SECOND RUN (state.json exists with eccRoot):
  Step 0  → reads state.json → eccRoot present and valid → prints ECC_ROOT_CACHED:<path> → exits immediately
  Step 1  → state.json exists → updates it, keeps eccRoot unchanged
  Step 3c → reads eccRoot from state.json ✓
  Step 5  → reads eccRoot from state.json ✓

EDGE CASE (state.json exists but has no eccRoot — e.g. created by old version of /scope):
  Step 0  → reads state.json → eccRoot absent → scans → prints ECC_ROOT_RESOLVED:<path>
  Step 1  → state.json exists → updates it, writes eccRoot into it for the first time
  All subsequent runs → cached path found, no scanning
```

`eccRoot` is re-resolved (scanning happens) only when:

- `state.json` does not exist yet
- `eccRoot` is missing from `state.json`
- The stored path no longer passes `hasEccRuntime()` (ECC was moved or `node_modules` deleted)

---

## Idempotency Contract

| Run    | `projectId` | `eccRoot`                    | `scope.version` | Output          |
| ------ | ----------- | ---------------------------- | --------------- | --------------- |
| First  | new UUID v4 | resolved + written by Step 1 | 1               | `scope-v1.docx` |
| Second | unchanged   | read from cache, no scan     | 2               | `scope-v2.docx` |

---

## Error Handling

| Error                                          | Action                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `ECC_ROOT_NOT_FOUND` in Step 0                 | Set `CLAUDE_PLUGIN_ROOT` or run `npm install` in the ECC repo root         |
| `eccRoot missing from state.json` in Step 3c/5 | Step 1 did not complete — check for write errors and re-run                |
| Scope JSON validation fails                    | Fix AJV-reported fields, retry Step 3a–3c                                  |
| RFP file path not found                        | Ask user to paste content directly                                         |
| `ERR:...` from doc generator                   | Verify `eccRoot` in state.json points to ECC repo with `node_modules/docx` |
| State write fails                              | Report error; do not leave partial state                                   |

---

## Phase Gate

`hooks/sdlc/phase-gate.js` reads `.sdlc/state.json`, checks prerequisites, and blocks or allows writes based on `ECC_PHASE_GATE_MODE` / `ECC_PHASE_GATE_ENABLED` / `ECC_PHASE_GATE_BYPASS`.

---

## Related Commands

- `/srs` — next step after `/scope`
- `/sdlc-status` — current phase and artifact inventory
- `/mom` — extract Minutes of Meeting

## Related Agents and Skills

- `agents/business-analyst.md` — scope extraction (Step 2)
- `skills/sdlc-requirements/SKILL.md` — IEEE 830 methodology
