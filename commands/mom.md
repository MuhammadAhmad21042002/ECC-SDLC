---
name: mom
description: Extract structured Minutes of Meeting from a meeting transcript, call notes, voice-memo text, or informal written notes. Produces a formatted mom-vN.docx with attendees, decisions, action items, requirement signals, and compliance flags. Can run at any phase — no SDLC prerequisites. Use --promote-signals to convert requirement signals into REQ-* entries in state.json.
---

# /mom — Minutes of Meeting

## Purpose

`/mom` produces:

- **`.sdlc/artifacts/mom-vN.docx`** — a formatted Minutes of Meeting document with all sections populated
- **`.sdlc/state.json` updates** — `meetings[]` entry appended, `artifacts.mom` registered, compliance flags merged into `complianceFlags[]`

`/mom` can run **at any phase** — there are no pipeline prerequisites. It is independent of `/scope`, `/srs`, or any other command.

Use **`/mom --promote-signals`** after the meeting document is generated to convert `requirementSignals[]` into formal `REQ-*` entries in `state.json.requirements[]`.

---

## Inputs to gather

Ask the user for:

1. **Meeting transcript or notes** — pasted text, or a file path to read. Accept any format: formal transcript, bullet notes, email summary, chat export, voice-memo text.
2. **Project name and client name** — if `.sdlc/state.json` exists, read these from state. If not, ask the user.

If the user gives a file path, use the `Read` tool. If multiple files (e.g. transcript + attendee list), read all before proceeding.

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
  return fs.existsSync(path.join(r, 'scripts', 'generate-mom-doc.js'))
    && fs.existsSync(path.join(r, 'templates', 'mom-template.json'))
    && fs.existsSync(path.join(r, 'lib', 'doc-generator', 'generic-doc.js'))
    && fs.existsSync(path.join(r, 'lib', 'schema-validator.js'))
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

Read the output line and store the path as `ECC_DIR` for this entire run:

- `ECC_ROOT_CACHED:<path>` — valid cache hit; Step 1 will still write it to state.json.
- `ECC_ROOT_RESOLVED:<path>` — freshly scanned. Step 1 writes this into state.json.
- Exit code 1 / `ECC_ROOT_NOT_FOUND` — stop and tell the user to set `CLAUDE_PLUGIN_ROOT` or run `npm install`.

Steps 3 and 4 read `eccRoot` directly from `state.json` — they never scan.

---

### Step 1 — Load state and write eccRoot (Read/Write tools — no Bash)

**`/mom` never creates state.json.** `/scope` is the sole owner of state.json creation. If state.json does not exist, `/mom` generates the docx standalone and skips all state writes.

**Two cases:**

#### Case A — state.json does NOT exist (standalone run)

- Tell the user: _"No project found in this directory. MoM document will be generated standalone and saved to `.sdlc/artifacts/mom-v1.docx`. Run `/scope` first to link meetings to the project pipeline."_
- Ask the user for `projectName` and `clientName` (needed for the document cover page only)
- Store `ECC_DIR` from Step 0 in memory — do NOT write it to any file
- Set `nextVersion = 1`
- **Skip Step 5** (no state to update)

#### Case B — state.json EXISTS

Read `.sdlc/state.json` with the Read tool. Extract into memory:

- `projectName`, `clientName` → use in Step 2 agent prompt
- `eccRoot` → already set; if Step 0 printed `ECC_ROOT_RESOLVED` (new path), write it back now using the Write tool, preserving all other fields exactly
- `meetings[]` → existing accumulated log (may be absent or empty)
- `artifacts.mom.version` (default `0` if null) → compute `nextVersion = version + 1`
- `artifacts.mom.versionHistory` → preserve accumulated array for Step 5
- `requirements[]` → needed only if `--promote-signals` flag is active

---

### Step 2 — Extract meeting data (Agent: business-analyst + sdlc-meeting-analysis skill)

Invoke `business-analyst` with `sdlc-meeting-analysis` skill loaded.

Provide:

- Full meeting transcript or notes content
- `projectName` and `clientName` from state (or user input)
- Instruction to produce **strict JSON only** — no markdown, no prose:

```json
{
  "meetingTitle": "string",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null",
  "duration": "e.g. 90 minutes or null",
  "meetingType": "kickoff | requirements | design | review | status | procurement | closure | other",
  "platform": "Zoom | Teams | in-person | phone | other | null",
  "location": "string or null",
  "projectName": "from state or extracted",
  "clientName": "from state or extracted",
  "preparedBy": "ECC-SDLC",
  "attendees": [
    {
      "name": "Full Name or Role",
      "role": "Job title",
      "organization": "Company or department",
      "present": true,
      "contactType": "client | vendor | internal | regulator | other"
    }
  ],
  "agendaItems": ["Topic 1", "Topic 2"],
  "decisions": [
    {
      "id": "DEC-001",
      "decision": "What was resolved",
      "owner": "Name",
      "dueDate": "YYYY-MM-DD or null",
      "rationale": "Brief reason or null",
      "references": [],
      "verbatimQuote": "Exact phrase from transcript or null"
    }
  ],
  "actionItems": [
    {
      "id": "ACT-001",
      "action": "What must be done",
      "owner": "Name",
      "dueDate": "YYYY-MM-DD or null",
      "status": "open",
      "priority": "high | medium | low",
      "context": "One-sentence background or null"
    }
  ],
  "requirementSignals": ["Stakeholder X raised: system must support Urdu interface"],
  "openQuestions": ["Who owns the data residency decision?"],
  "complianceFlags": ["SBP-2024", "PPRA-2024"],
  "nextMeeting": {
    "date": "YYYY-MM-DD or null",
    "platform": "string or null",
    "proposedAgenda": ["Topic A", "Topic B"]
  },
  "summary": "2-3 sentence plain-language summary of what was accomplished"
}
```

**Agent rules:**

- `decisions[]` must contain only resolved commitments — not discussion points
- Each `actionItem` must have exactly one named `owner`
- `requirementSignals[]` contains plain-language descriptions only — no `REQ-*` IDs
- `date` must be `YYYY-MM-DD` or `null` — never a relative string
- `complianceFlags[]` must reflect keyword scan of the full transcript
- `summary` is 2-3 sentences — no bullet points

**If the agent reports that the input is too short or lacks discernible decisions/actions:** accept the partial output and note gaps in `openQuestions`. Do not retry with the same input.

---

### Step 3 — Write mom-data.json and generate docx (Bash — reads eccRoot from state.json)

Write the agent's JSON output to `.sdlc/tmp/mom-data.json`, then generate the docx.

**`ECC_DIR` comes from Step 0 memory — not from state.json.** This means Step 3 works correctly in both cases: standalone (no state.json) and linked (state.json exists).

```bash
node -e "
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ECC_DIR is passed directly from Step 0 — no state.json read needed here.
// This means Step 3 works even when /mom is running standalone (no state.json).
const ECC_DIR    = '<ECC_DIR from Step 0>';
const nextVersion = <nextVersion from Step 1>;

fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'artifacts'), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), '.sdlc', 'tmp'),       { recursive: true });

const outputPath = path.join(process.cwd(), '.sdlc', 'artifacts', 'mom-v' + nextVersion + '.docx');
const statePath  = path.join(process.cwd(), '.sdlc', 'state.json');

const args = [
  path.join(ECC_DIR, 'scripts', 'generate-mom-doc.js'),
  '--data',     path.join(process.cwd(), '.sdlc', 'tmp', 'mom-data.json'),
  '--out',      outputPath,
  '--template', path.join(ECC_DIR, 'templates', 'mom-template.json'),
  '--version',  String(nextVersion),
];
// Only pass --state if state.json exists — generate-mom-doc.js uses it for version history
if (fs.existsSync(statePath)) args.push('--state', statePath);

const res = spawnSync(process.execPath, args, { stdio: ['inherit', 'pipe', 'inherit'] });

if ((res.status ?? 1) !== 0) {
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(res.status ?? 1);
}

const hash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
console.log('OK:' + outputPath + ':' + hash + ':v' + nextVersion);
try { fs.unlinkSync(path.join(process.cwd(), '.sdlc', 'tmp', 'mom-data.json')); } catch (_) {}
"
```

Replace `<ECC_DIR from Step 0>` and `<nextVersion from Step 1>` with the actual values.

Replace `<nextVersion>` with the actual `nextVersion` number computed in Step 1b.

**Success:** one stdout line: `OK:<path>:sha256:<hex>:v<N>`. Use path, hash, and version in Step 5.

---

### Step 4 — Promote requirement signals (conditional — only if `--promote-signals` flag)

**Skip this step unless the user explicitly ran `/mom --promote-signals`.**

For each signal in `requirementSignals[]`, re-invoke `business-analyst` to produce a full `REQ-*` record and append it to `state.json.requirements[]`.

The agent must:

1. Receive each signal string as input
2. Return a requirement object matching `schemas/requirement.schema.json`
3. Continue REQ numbering from the highest existing ID in state.json

Write each promoted requirement to state.json immediately after extraction. Mark the signal as `promoted: true` in the meeting record's `requirementSignals` entry.

After all signals are promoted, print:

```
SDLC:MOM:SIGNALS:PROMOTED:[N] signals converted to REQ-* entries
```

---

### Step 5 — Register artifact and save state (Write tool — no Bash)

**Skip entirely if Step 1 was Case A (no state.json).** `/mom` never creates state.json — that is `/scope`'s responsibility. In Case A, the docx is the only output.

**Only runs in Case B (state.json existed before this run).**

Write the complete updated state to `.sdlc/state.json`. **Preserve `projectId` and `eccRoot` exactly.**

**Critical — meetings[] accumulation rule:**
`state.meetings[]` is a **cumulative log** — never replace it. Append the new meeting record to the end.

**Critical — versionHistory accumulation rule:**
`artifacts.mom.versionHistory` is a **cumulative log** — never replace it with a single entry. Append the new entry.

```json
{
  "...all existing fields...": "...",
  "projectId": "<preserved — never change>",
  "eccRoot": "<preserved — never change>",
  "meetings": [
    "...ALL prior meeting entries (preserve every existing entry)...",
    {
      "meetingId": "MOM-<nextVersion>",
      "meetingTitle": "<meetingTitle from agent output>",
      "date": "<date from agent output>",
      "meetingType": "<meetingType from agent output>",
      "artifactPath": ".sdlc/artifacts/mom-v<nextVersion>.docx",
      "attendeeCount": "<count of attendees with present: true>",
      "decisionCount": "<count of decisions>",
      "actionItemCount": "<count of actionItems>",
      "signalCount": "<count of requirementSignals>",
      "complianceFlags": ["<flags from agent output>"],
      "createdAt": "<ISO 8601 now>"
    }
  ],
  "complianceFlags": ["...ALL existing complianceFlags entries (merge, no duplicates)...", "...new flags from this meeting not already present..."],
  "artifacts": {
    "...existing scope, srs, sds, sts, estimate, proposal entries preserved...": "...",
    "mom": {
      "path": ".sdlc/artifacts/mom-v<nextVersion>.docx",
      "version": "<nextVersion>",
      "hash": "<sha256 from Step 3>",
      "createdAt": "<ISO 8601 — original createdAt if exists, else now>",
      "updatedAt": "<ISO 8601 now>",
      "versionHistory": [
        "...ALL prior entries from existing artifacts.mom.versionHistory (preserve every existing row)...",
        {
          "version": "<nextVersion>.0",
          "date": "<YYYY-MM-DD today>",
          "author": "ECC-SDLC",
          "changes": "<version 1: 'Initial Minutes of Meeting', version N: 'MoM revised'>"
        }
      ]
    }
  }
}
```

---

### Step 6 — Confirm completion

Output the handoff signal:

```
SDLC:MOM:COMPLETE:[projectName]:[meetingTitle] — [N] decisions, [N] action items, [N] requirement signals
```

Then display a summary:

```
Minutes of Meeting generated
  File:              .sdlc/artifacts/mom-v{N}.docx
  Meeting:           {meetingTitle}
  Date:              {date}
  Attendees:         {N} present
  Decisions:         {N}
  Action items:      {N} (all open)
  Requirement signals: {N}
  Compliance flags:  {flags or "none detected"}

Action items requiring follow-up:
  ACT-001  {owner}  {dueDate}  {action (truncated to 60 chars)}
  ACT-002  ...

{if requirementSignals > 0}
Requirement signals captured — run /mom --promote-signals to convert to REQ-* entries,
or they will be picked up during the next /srs run.
{end if}
```

---

## `--promote-signals` flag behaviour

When the user runs `/mom --promote-signals`:

1. Steps 1–3 run as normal (extract + generate docx)
2. Step 4 runs immediately after Step 3
3. Each `requirementSignal` is converted into a full `REQ-*` entry
4. State is updated with both the meeting record AND the new requirements
5. The completion message shows how many signals were promoted

When the user runs `/mom` without `--promote-signals`:

- Signals are captured in the docx and in `state.meetings[].signalCount`
- They are NOT added to `state.json.requirements[]`
- The user is reminded at Step 6 to run `--promote-signals` or `/srs`

---

## Running /mom without an active project

If `.sdlc/state.json` does not exist:

1. Ask user for project name and client name
2. Run Steps 0–3 (extract + generate docx)
3. Skip Steps 4 and 5 (no state to update)
4. Tell the user: "MoM document generated at `.sdlc/artifacts/mom-v1.docx`. Run `/scope` to initialise a project and link this meeting to the pipeline."

The docx is still fully generated and useful even without a project state.

---

## Idempotency contract

| Run    | `mom.version` | Output        |
| ------ | ------------- | ------------- |
| First  | 1             | `mom-v1.docx` |
| Second | 2             | `mom-v2.docx` |

Each `/mom` run appends a new entry to `meetings[]` — it does not overwrite previous meeting records.

---

## How ECC Root Caching Works

Same pattern as `/scope`, `/srs`, `/sds`, `/sts`, `/estimate`:

```
Standalone run (state.json does not exist — /scope not yet run):
  Step 0 → no state.json → scans → prints ECC_ROOT_RESOLVED:<path>
  Step 1 → Case A: no state.json → store ECC_DIR in memory only, skip all state writes
  Step 3 → ECC_DIR passed directly from memory, no state.json read
  Step 5 → skipped entirely
  Output: mom-v1.docx in .sdlc/artifacts/ — state.json untouched

Linked run (state.json exists — /scope has been run):
  Step 0 → reads state.json → eccRoot valid → prints ECC_ROOT_CACHED:<path>
  Step 1 → Case B: reads state.json → eccRoot already set → no write needed
  Step 3 → ECC_DIR from memory, --state passed to generate-mom-doc.js for version history
  Step 5 → appends to meetings[], updates artifacts.mom, merges complianceFlags

Linked run with stale eccRoot (ECC moved):
  Step 0 → reads state.json → eccRoot invalid → scans → prints ECC_ROOT_RESOLVED:<path>
  Step 1 → Case B: writes new eccRoot back to state.json, all other fields preserved
  Step 3 → ECC_DIR from memory
  Step 5 → runs normally
```

`eccRoot` is re-resolved (directory scanning) only when:

- `state.json` does not exist yet
- `eccRoot` is absent from state.json
- The stored path no longer passes `hasEccRuntime()` (ECC was moved or `node_modules` deleted)

---

## Error handling

| Error                                 | Action                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| `ECC_ROOT_NOT_FOUND`                  | Set `CLAUDE_PLUGIN_ROOT` or run `npm install` in the ECC repo         |
| `eccRoot missing from state.json`     | Step 1 Case B did not write eccRoot back — re-run from Step 0         |
| Agent returns empty decisions/actions | Accept output; note in openQuestions that transcript may be too brief |
| `generate-mom-doc.js` not found       | Verify eccRoot points to ECC repo with `node_modules/docx` installed  |
| File path not found                   | Ask user to paste content directly                                    |
| `--promote-signals` but no signals    | Print "No requirement signals to promote" and exit cleanly            |

---

## Related commands

- `/scope` — initialises the project pipeline; /mom can run before or after
- `/srs` — picks up `requirementSignals` from meetings[] during requirements extraction
- `/sdlc-status` — shows pending action items count from all meetings
- `/traceability` — shows if signals have been promoted and traced

## Related agents and skills

- `agents/business-analyst.md` — meeting extraction (Step 2)
- `skills/sdlc-meeting-analysis/SKILL.md` — extraction methodology, decision vs action rules, signal promotion pipeline
