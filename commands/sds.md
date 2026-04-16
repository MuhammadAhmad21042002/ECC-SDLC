---
name: sds
description: Generate the Software Design Specification (IEEE Std 1016). Reads validated requirements from state.json, runs the solution-architect agent, validates output, renders sds-vN.docx with Mermaid code blocks, and registers the artifact. Requires /scope and /srs to have completed first.
---

# /sds — Software Design Specification (IEEE Std 1016)

## Purpose

`/sds` produces:

- **`.sdlc/artifacts/sds-vN.docx`** — IEEE-format SDS with cover, TOC, version history, architecture overview, component specifications, database schema, API contracts, integration points, security architecture, and requirements traceability matrix
- **`.sdlc/state.json` updates** — `designComponents[]` populated, `artifacts.sds` registered, phase advanced to `test-planning`

Mermaid diagrams (architecture, ER) are rendered as embedded PNG images using pure-Node rendering — no browser, no Chrome, no mmdc required. Install two packages in the ECC project once: `npm install @dagrejs/dagre sharp`. Falls back to styled Mermaid code listings (paste into [mermaid.live](https://mermaid.live)) if those packages are absent.

## Preconditions

Read `.sdlc/state.json` and verify **all three** before doing any work:

- `artifacts.scope` is present
- `artifacts.srs` is present
- `requirements[]` contains at least one entry

If any precondition fails → stop and tell the user to complete the missing phase first.

---

## Orchestration Steps

### Step 0 — Resolve and cache the ECC runtime root (Bash — one call, read-only on state.json)

**This step runs first, every time. Never scans if eccRoot is already valid.**

```bash
node -e "
const os   = require('os');
const path = require('path');
const fs   = require('fs');

function hasEccRuntime(root) {
  if (!root || typeof root !== 'string' || !root.trim()) return false;
  const r = root.trim();
  return fs.existsSync(path.join(r, 'scripts', 'generate-sds-doc.js'))
    && fs.existsSync(path.join(r, 'scripts', 'validate-json.js'))
    && fs.existsSync(path.join(r, 'schemas', 'sds.schema.json'))
    && fs.existsSync(path.join(r, 'lib', 'schema-validator.js'))
    && fs.existsSync(path.join(r, 'lib', 'doc-generator', 'generic-doc.js'))
    && fs.existsSync(path.join(r, 'templates', 'sds-template.json'))
    && fs.existsSync(path.join(r, 'node_modules', 'docx', 'package.json'));
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

Store the path from the output line as `ECC_DIR`. Steps 3, 3.1, 4, and 4.5 read it directly from `state.json` — they never scan again.

---

### Step 1 — Load state and check preconditions (Read + Write tools — no Bash)

Read `.sdlc/state.json`. Extract:

- `projectName`, `clientName`, `eccRoot` (= `ECC_DIR`)
- `requirements[]` — full list of REQ-\* with descriptions, MoSCoW, acceptance criteria
- `artifacts.srs` — confirm it exists
- `artifacts.sds.version` (default 0 if null) → `nextVersion = version + 1`
- `artifacts.sds.versionHistory` — the **existing accumulated array** (preserve it for Step 5)
- `designComponents[]` (may be empty)

**If Step 0 resolved a new `eccRoot` path** (printed `ECC_ROOT_RESOLVED:...` rather than `ECC_ROOT_CACHED:...`), write it back into state.json now using the Write tool — same rule as `/scope` Step 1. Update only the `eccRoot` field; preserve all other fields exactly.

This is the only place `eccRoot` is written. Steps 3, 3.1, 4, and 4.5 read it from state.json — they never scan.

---

### Step 2 — Run the Solution Architect agent

Invoke `solution-architect` with `sdlc-design` skill loaded.

Provide:

- Full `requirements[]` from state.json
- Any SRS constraints, assumptions, external interfaces available
- `projectName`, `clientName`

**Require strict JSON output only** — no markdown, no extra text:

```json
{
  "designComponents": [
    {
      "id": "DC-001",
      "title": "Component name (max 140 chars)",
      "description": "What this component does and why it exists",
      "type": "service | module | component | api | database | job | integration | ui | infra | library | other",
      "status": "draft",
      "requirementIds": ["REQ-FUNC-001", "REQ-NFUNC-002"],
      "responsibilities": ["Responsibility 1", "Responsibility 2"],
      "interfaces": [{ "name": "POST /auth/login", "kind": "api", "description": "Authenticates user and returns token" }],
      "dependencies": ["DC-002"],
      "dataStores": ["PostgreSQL users table"],
      "complexity": "simple | average | complex",
      "assumptions": [],
      "risks": []
    }
  ],
  "sdsData": {
    "projectName": "...",
    "clientName": "...",
    "preparedBy": "ECC-SDLC",
    "generatedDate": "YYYY-MM-DD",
    "documentVersion": "1.0",
    "architectureOverviewParagraphs": ["..."],
    "architectureDiagramMermaid": ["flowchart TD", "  A[Auth] --> B[API]", "  B --> C[DB]"],
    "architectureDecisionsNumbered": ["..."],
    "designComponents": [
      {
        "id": "DC-001",
        "name": "...",
        "responsibility": "...",
        "interfaces": "...",
        "tracesToReq": ["REQ-FUNC-001"]
      }
    ],
    "databaseSchemaIntroParagraphs": ["..."],
    "databaseErDiagramMermaid": ["erDiagram", "  USERS ||--o{ ORDERS : places"],
    "databaseTables": [{ "table": "users", "primaryKey": "id (UUID)", "fields": "email, name, created_at", "relationships": "1:N orders" }],
    "apiEndpoints": [{ "method": "POST", "path": "/api/auth/login", "description": "Authenticate user", "request": "email, password", "response": "JWT token" }],
    "integrationIntroParagraphs": ["..."],
    "integrationPointsBullets": ["..."],
    "securityArchitectureParagraphs": ["..."],
    "securityAuthParagraphs": ["..."],
    "securityAuthorizationParagraphs": ["..."],
    "securityDataProtectionParagraphs": ["..."],
    "securityAuditLoggingParagraphs": ["..."],
    "traceabilityMatrixRows": [{ "reqId": "REQ-FUNC-001", "requirementTitle": "...", "designComponentIds": ["DC-001"], "coverage": "100%" }]
  },
  "openQuestions": []
}
```

**Mermaid rules:**

- `architectureDiagramMermaid` — array of strings, each string is one line of a `flowchart TD` or `flowchart LR` diagram
- `databaseErDiagramMermaid` — array of strings, each string is one line of an `erDiagram` diagram
- Use only `flowchart`, `sequenceDiagram`, and `erDiagram` types — these render reliably
- Do not include markdown fences (no ` ```mermaid ` — just the raw lines)
- Do NOT add a top-level `"mermaid"` key — all diagram content lives inside `sdsData`
- **Never use HTML tags in node labels** — no `<br/>`, `<br>`, `<b>`, `<i>` or any other HTML inside node label brackets. Use a plain space or shorten the label. Bad: `DC001[Project Inception<br/>and Management]`. Good: `DC001[Project Inception and Management]`
- **Keep node labels concise** — aim for ≤ 40 characters per label to avoid layout overflow
- **`databaseErDiagramMermaid` MUST include attribute blocks for EVERY entity** — relationship-only erDiagram produces empty tables in the output document. Every entity needs `{ type fieldName [PK|FK] }` lines. Example: `"  USERS {"`, `"    string id PK"`, `"    string email"`, `"  }"`. **This is not optional.**
- **`databaseTables[].fields` must list ALL column names** — write every column as a comma-separated string. Never truncate with "..." or write partial lists.

**Design component rules:**

- `designComponents[]` in the root (for state.json) uses schema shape: `id`, `title`, `description`, `type`, `status`, `requirementIds`
- `sdsData.designComponents[]` (for the SDS table) uses template shape: `id`, `name`, `responsibility`, `interfaces`, `tracesToReq` (array of REQ-\* strings)
- Every `must` REQ-\* must trace to at least one DC
- **`sdsData.versionHistory` is auto-built** by `sds-render-data.js` from `state.json` via `_versionHistory` injection — do **not** include it in the agent's `sdsData` output; omit the field entirely

---

### Step 3 — Validate sdsData (Bash — reads eccRoot from state.json)

Write agent's `sdsData` to `.sdlc/tmp/sds-data.json`, then:

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — re-run /sds from Step 0'); process.exit(1); }

fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'tmp'), { recursive: true });

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'validate-json.js'),
  '--schema',   'sds',
  '--file',     path.join(process.cwd(), '.sdlc', 'tmp', 'sds-data.json'),
  '--repoRoot', ECC_DIR,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

If validation fails → show AJV errors → ask agent to fix → retry Step 3. Do not proceed.

---

### Step 3.1 — Validate designComponents[] (Bash — reads eccRoot from state.json)

Write agent's `designComponents` array to `.sdlc/tmp/design-components.json`, then:

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — re-run /sds from Step 0'); process.exit(1); }

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'validate-design-components.js'),
  '--file',     path.join(process.cwd(), '.sdlc', 'tmp', 'design-components.json'),
  '--repoRoot', ECC_DIR,
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

---

### Step 3.2 — Pre-flight field validation via technical-writer agent

Invoke `technical-writer` with `sdlc-templates` skill loaded.

Provide:

- The validated `sdsData` JSON from Step 3 (`.sdlc/tmp/sds-data.json`)
- Template path: `templates/sds-template.json`
- Output path: `.sdlc/artifacts/sds-v{nextVersion}.docx`

The technical-writer agent performs a **pre-flight validation** — it cross-checks the `sdsData` fields against the template's `dataContract.requiredFields` and returns a JSON report:

```json
{
  "validation": {
    "templatePath": "templates/sds-template.json",
    "templateId": "ecc-sdlc.sds.v5",
    "requiredFieldsSatisfied": ["projectName", "clientName", "..."],
    "missingRequiredFields": []
  }
}
```

**Important — render-script derived fields (never produced by agent):**
`architectureDiagramLines`, `databaseErDiagramLines`, and `dataFlowDiagramLines` appear in the template's `dataContract.requiredFields` but are computed internally by `sds-render-data.js` from the agent's Mermaid source fields. Instruct the technical-writer to **exclude these three fields from the missing-field check** — their presence in `sdsData` as `architectureDiagramMermaid`, `databaseErDiagramMermaid`, and `dataFlowDiagramMermaid` satisfies the requirement.

Additionally, `architectureDiagram`, `databaseErDiagram`, `dataFlowDiagram`, `networkDiagram`, `useCaseDiagrams`, and `flowchartDiagram` are **auto-derived** by `sds-render-data.js` from `designComponents[]`, `databaseTables[]`, and `apiEndpoints[]`. The agent does NOT need to produce these structured objects.

**No file is written by the agent.** The agent does not produce the `.docx` — that is handled in Step 4 by `generate-sds-doc.js`, which reads `sds-data.json` directly and is self-contained (it calls `buildSdsRenderData` → diagram generation → `generateFromTemplate`).

**If any other `missingRequiredFields` are reported:** ask the solution-architect agent to supply the missing fields, update `sds-data.json`, re-run Step 3 validation, and re-invoke the technical-writer pre-flight check.

---

### Step 4 — Generate sds.docx (Bash — reads eccRoot from state.json)

```bash
node -e "
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const state      = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR    = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing — re-run /sds from Step 0'); process.exit(1); }

fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'artifacts'), { recursive: true });

const outputPath = path.join(process.cwd(), '.sdlc', 'artifacts', 'sds-v<nextVersion>.docx');

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'generate-sds-doc.js'),
  '--data',     path.join(process.cwd(), '.sdlc', 'tmp', 'sds-data.json'),
  '--out',      outputPath,
  '--template', path.join(ECC_DIR, 'templates', 'sds-template.json'),
  '--version',  '<nextVersion>',
  '--state',    path.join(process.cwd(), '.sdlc', 'state.json'),
], { stdio: ['inherit', 'pipe', 'inherit'] });

if ((res.status ?? 1) !== 0) {
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(res.status ?? 1);
}

const hash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
console.log('OK:' + outputPath + ':' + hash);
// NOTE: sds-data.json and design-components.json are intentionally NOT deleted here.
// They are cleaned up in Step 5 (state registration) only after the artifact is
// confirmed written. This ensures the data file is available for debugging if
// diagram rendering failed (e.g. if diagrams appear as code blocks instead of images).
// Step 5 performs the cleanup after writing state.json successfully.
"
```

Replace `<nextVersion>` with the actual number from Step 1.

**Success:** one stdout line: `OK:<path>:sha256:<hex>`. Use path and hash in Step 5.

---

### Step 4.5 — Update traceability (Bash — reads eccRoot from state.json)

Run BEFORE updating state in Step 5. This script reads `state.json`, populates `requirements[].traceForward.designComponentIds` from `designComponents[].requirementIds`, rebuilds `traceabilityMatrix`, and writes the result back to `state.json`.

**Step 5 must read the state written by this step as its base** — do not re-read the pre-Step-4.5 state.

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');

const state   = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sdlc', 'state.json'), 'utf8'));
const ECC_DIR = state.eccRoot;
if (!ECC_DIR) { console.error('eccRoot missing'); process.exit(1); }

const res = spawnSync(process.execPath, [
  path.join(ECC_DIR, 'scripts', 'traceability-update.js'),
  '--state',                 path.join(process.cwd(), '.sdlc', 'state.json'),
  '--repoRoot',              ECC_DIR,
  '--enforceMustDcCoverage',
], { stdio: 'inherit' });

process.exit(res.status ?? 1);
"
```

If traceability fails → ask agent to revise DC mappings → retry from Step 2.

---

### Step 5 — Register artifact, save state, and clean up tmp (Write tool + Bash)

Write the complete updated state to `.sdlc/state.json`. **Preserve `projectId` and `eccRoot` exactly.**

**Critical — versionHistory accumulation rule:**
`artifacts.sds.versionHistory` is a **cumulative log** — never replace it with a single entry.
Read the existing `versionHistory` array from state.json (from Step 1), then **append** the new
entry for `{nextVersion}` to the end. The final array must contain all prior entries plus the new one.

```json
{
  "...all existing fields...": "...",
  "projectId": "<preserved — never change>",
  "eccRoot": "<preserved — never change>",
  "currentPhase": "test-planning",
  "phaseHistory": [
    { "phase": "design", "startedAt": "{existing}", "completedAt": "{ISO 8601 now}" },
    { "phase": "test-planning", "startedAt": "{ISO 8601 now}", "completedAt": null }
  ],
  "artifacts": {
    "...existing...": "...",
    "sds": {
      "path": ".sdlc/artifacts/sds-v{nextVersion}.docx",
      "version": "{nextVersion}",
      "hash": "{sha256 from Step 4}",
      "schemaId": "ecc-sdlc.sds.v1",
      "templateId": "ecc-sdlc.sds.v2",
      "createdAt": "{ISO 8601 — original createdAt if it exists, else now}",
      "updatedAt": "{ISO 8601 now}",
      "versionHistory": [
        "...ALL prior entries from existing state.json artifacts.sds.versionHistory (preserve every existing row)...",
        {
          "version": "{nextVersion}.0",
          "date": "{YYYY-MM-DD today}",
          "author": "{preparedBy from sdsData, or ECC-SDLC}",
          "changes": "{version 1: 'Initial SDS — design extracted from validated requirements', version N: describe what changed in this run}",
          "status": "Draft"
        }
      ]
    }
  }
}
```

**Example:** if state already has `versionHistory: [{ version: "1.0", ... }, { version: "2.0", ... }]`
and you are generating version 3, the written array must be:
`[{ version: "1.0", ... }, { version: "2.0", ... }, { version: "3.0", date: "today", ... }]`
Never discard the existing rows.

After writing state.json, clean up the tmp files:

```bash
node -e "
const path = require('path');
const fs   = require('fs');
const tmp  = path.join(process.cwd(), '.sdlc', 'tmp');
['sds-data.json', 'design-components.json'].forEach(f => {
  try { fs.unlinkSync(path.join(tmp, f)); } catch (_) {}
});
console.log('tmp cleaned');
"
```

---

### Step 6 — Report

```
SDLC:SDS:COMPLETE:[projectName]:[N] design components defined — ready for /sts
```

List any `openQuestions` from the agent output for the user to review.

---

## How ECC Root Caching Works

Same pattern as `/scope`:

```
First run:
  Step 0 → state.json has no eccRoot → scans → prints ECC_ROOT_RESOLVED
  Step 1 → writes eccRoot into state.json
  Steps 3, 3.1, 4, 4.5 → read eccRoot from state.json, no scanning

Every subsequent run:
  Step 0 → reads state.json → eccRoot valid → prints ECC_ROOT_CACHED → exits immediately
  Steps 3, 3.1, 4, 4.5 → read eccRoot from state.json, no scanning
```

---

## IEEE SDS Structure (IEEE Std 1016-2009)

The generated document follows this section mapping:

| Section                         | IEEE 1016 Clause         | Content                                                                      |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Cover                           | —                        | Project name, version, date, prepared by                                     |
| TOC                             | —                        | Auto-generated with page numbers and hyperlinks                              |
| Version History                 | —                        | Full revision history with dates                                             |
| 1. Architecture Overview        | 5.3 Design description   | System architecture paragraphs + key decisions                               |
| 1.1 Architecture Diagram        | 5.3.1                    | Rendered PNG image (if sharp/Chrome available) + Mermaid source code listing |
| 1.2 Key Architectural Decisions | 5.3.2                    | Numbered list                                                                |
| 2. Component Specifications     | 5.4 Design elements      | DC-\* table with responsibility and REQ traceability                         |
| 3. Database Schema              | 5.5 Design relationships | Intro paragraphs + ER diagram source + tables table                          |
| 4. API Contracts                | 5.6 Design constraints   | Endpoint table (method, path, request, response)                             |
| 5. Integration Points           | 5.7 Design rationale     | External system integration description                                      |
| 6. Security Architecture        | —                        | Auth, authorisation, data protection, audit logging                          |
| 7. Requirements Traceability    | 6                        | REQ-\* → DC-\* mapping with coverage                                         |

---

## Error Handling

| Error                                        | Action                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECC_ROOT_NOT_FOUND`                         | Set `CLAUDE_PLUGIN_ROOT` or run `npm install` in the ECC repo                                                                                                                                                                                                                                                                                                  |
| Precondition missing                         | Tell user to run the missing phase first                                                                                                                                                                                                                                                                                                                       |
| sdsData validation fails                     | Fix AJV-reported fields, retry Step 3                                                                                                                                                                                                                                                                                                                          |
| designComponents validation fails            | Fix component shapes, retry Step 3.1                                                                                                                                                                                                                                                                                                                           |
| technical-writer missing fields              | Ask architect to supply missing fields, retry Step 3 + 3.2                                                                                                                                                                                                                                                                                                     |
| traceability fails                           | Ask agent to revise DC mappings, retry from Step 2                                                                                                                                                                                                                                                                                                             |
| ERR: from generate-sds-doc.js                | Verify eccRoot in state.json, check node_modules/docx                                                                                                                                                                                                                                                                                                          |
| Architecture/ER diagrams show as code blocks | Diagram rendering requires `@dagrejs/dagre` and `sharp`. Fix: `cd <ecc-sdlc> && npm install @dagrejs/dagre sharp` then re-run `/sds`. No browser or Chrome needed. If packages are installed but diagrams still fail, run `ECC_MERMAID_DEBUG=1 node scripts/generate-sds-doc.js --data .sdlc/tmp/sds-data.json --out test.docx` for diagnostics. |

---

## Related Commands

- `/scope` — must run first
- `/srs` — must run before /sds
- `/sts` — next step after /sds
- `/sdlc-status` — current phase and artifact inventory

## Related Agents and Skills

- `agents/solution-architect.md` — design extraction (Step 2)
- `agents/technical-writer.md` — pre-flight field validation (Step 3.2)
- `skills/sdlc-design/SKILL.md` — IEEE 1016 methodology and DC rules (Step 2)
- `skills/sdlc-templates/SKILL.md` — template resolution, dataContract contracts, Mode B validation (Step 3.2)
