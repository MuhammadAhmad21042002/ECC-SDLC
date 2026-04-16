---
name: srs
description: Generate Software Requirements Specification (IEEE 830) from scope/state inputs. Extract requirements with business-analyst, hard-validate via AJV, run compliance checks, atomically update state.json, render srs-vN.docx, and register the artifact.
---

# /srs — Software Requirements Specification (IEEE 830)

## Purpose

`/srs` produces:

- `.sdlc/artifacts/srs-vN.docx` — a client-ready SRS based on `templates/srs-template.json`
- `.sdlc/state.json` updates — validated `requirements[]`, compliance flags, initialized `traceForward`, and registered `artifacts.srs`

This command runs after `/scope` and before `/sds`.

---

## Preconditions

Read `.sdlc/state.json` and verify all checks before any extraction:

- `artifacts.scope` exists and is non-null
- `projectName` and `clientName` are non-empty strings
- current project state is readable JSON

If any precondition fails, stop and ask user to complete `/scope` first.

---

## Orchestration Steps

### Step 0 — Resolve and cache ECC runtime root (Bash — one call)

Use the same root-resolution pattern as `/scope`. Runtime must include:

- `scripts/generate-srs-doc.js`
- `scripts/sdlc/validate-requirements.js`
- `schemas/requirement.schema.json`
- `templates/srs-template.json`
- `lib/doc-generator/generic-doc.js`
- `node_modules/docx/package.json`

If not found, stop with `ECC_ROOT_NOT_FOUND`.

---

### Step 1 — Load and prepare state (Read/Write tools — no Bash)

Read `.sdlc/state.json` and capture:

- `projectId` (must be preserved exactly)
- `projectName`, `clientName`
- `eccRoot`
- existing `requirements[]`
- `artifacts.srs.version` (default 0 if null)
- `phaseHistory`

If Step 0 resolved a new root, write back `eccRoot` now.

Compute `nextVersion = (artifacts.srs.version || 0) + 1`.

Keep an in-memory copy of raw `state.json` content for byte-compare if validation fails.

---

### Step 2 — Extract requirements (Agent: business-analyst + sdlc-requirements skill)

Invoke `business-analyst` with:

- scope context from state/artifacts
- project metadata
- any additional user notes

Require strict JSON output:

```json
{
  "requirements": [
    {
      "id": "REQ-FUNC-001",
      "type": "functional",
      "title": "Requirement title",
      "description": "The system shall ...",
      "priority": "must",
      "source": "RFP Section 2.1",
      "status": "draft",
      "acceptanceCriteria": ["Given/When/Then criterion"],
      "dependencies": [],
      "complianceFrameworks": [],
      "assumptions": [],
      "deferralReason": null,
      "traceForward": {
        "designComponentIds": [],
        "testCaseIds": [],
        "costLineItemIds": []
      }
    }
  ]
}
```

No markdown wrappers. No prose.

After extraction completes, write the requirements to a temporary file:

```bash
mkdir -p .sdlc/tmp
# write extracted requirements array to:
# .sdlc/tmp/requirements.json
```

**Important:** `.sdlc/state.json` is NOT modified at this point.

---

### Step 3 — AJV hard block validation (Bash)

Validate the tmp requirements file — NOT state.json — using:

```bash
node "<ECC_DIR>/scripts/sdlc/validate-requirements.js" \
  --file ".sdlc/tmp/requirements.json"
```

Validation contract:

- `allErrors: true` — report all failing requirements in one pass
- exit `1` on any validation failure (hard block)

If validation fails:

- do not modify `.sdlc/state.json` — it remains byte-identical to pre-run state
- report all failures to the user and stop
- **Do NOT clean up tmp files here** — the final cleanup step handles all tmp files

---

### Step 4 — Compliance flagging (Agent: compliance-checker)

Only after Step 3 passes.

Invoke `compliance-checker` in `/srs` mode with:

- `requirements[]` — the validated requirements from `.sdlc/tmp/requirements.json`
- Framework files available at `<ECC_DIR>/frameworks/*.json`

The compliance-checker returns:

```json
{
  "mode": "requirements",
  "complianceFlags": [...],
  "requirementUpdates": [
    { "id": "REQ-NFUNC-003", "complianceFrameworks": ["SBP-2024", "ISO-27001"] }
  ],
  "summary": { "totalScanned": 0, "flagged": 0, "bySeverity": {}, "byFramework": {} }
}
```

Write the compliance output to `.sdlc/tmp/compliance.json`.

**Important:** `.sdlc/state.json` is NOT modified at this point.

---

### Step 5 — Atomic state update (Write tool — no Bash)

Only after Steps 3 and 4 complete successfully.

1. Read `.sdlc/tmp/requirements.json`
2. Read `.sdlc/tmp/compliance.json`
3. Merge extracted requirements into state payload
4. Apply `requirementUpdates` — merge `complianceFrameworks` arrays onto matching requirements
5. Merge `complianceFlags` into `state.complianceFlags[]` — append, never replace
6. Ensure every requirement has `traceForward` with three empty arrays:
   - `designComponentIds: []`
   - `testCaseIds: []`
   - `costLineItemIds: []`
   - Merge-safe: if arrays exist and are non-empty, preserve existing values
7. Set `currentPhase` to `"requirements"`
8. Update `phaseHistory`:
   - mark discovery as completed (if still open)
   - add/start requirements phase entry

Write the full updated object to `.sdlc/state.json` once (single atomic write).

**Do NOT clean up tmp files here** — all tmp cleanup happens in Step 9b at the end.

---

### Step 5b — Initialise traceForward arrays (Bash — idempotent safety check)

After the atomic write in Step 5 completes, call the merge-safe initialiser to guarantee every requirement has a `traceForward` object regardless of what the business-analyst produced:

```bash
node -e "
const path  = require('path');
const fs    = require('fs');
const { initialiseTraceForward } = require('<ECC_DIR>/scripts/sdlc/utils/initialise-traceforward');
const { writeJsonAtomic }        = require('<ECC_DIR>/scripts/sdlc/utils/state-writer');

const statePath = path.resolve('.sdlc/state.json');
const state     = JSON.parse(fs.readFileSync(statePath, 'utf8'));

state.requirements = initialiseTraceForward(state.requirements);
writeJsonAtomic(statePath, state);

console.log('traceForward initialised on ' + state.requirements.length + ' requirement(s)');
"
```

Merge-safe rules applied by the initialiser:

- If `traceForward` is absent on a requirement: create `{ designComponentIds: [], testCaseIds: [], costLineItemIds: [] }`.
- If `traceForward` exists: for each of the three array keys, only set to `[]` if that key is absent — never overwrite an existing array (even if already empty).
- Idempotent: safe to call multiple times — state.json is identical after repeated runs.

Do not call before Step 5 completes — if `/srs` aborts due to a validation or compliance failure, `traceForward` must not be initialised on invalid data.

---

### Step 6 — Build SRS narrative data (3-part parallel split)

For enterprise-scale products (100–150 page SRS), the full narrative exceeds a single agent's
context window. Step 6 therefore runs **three technical-writer sub-agents in parallel**,
each responsible for one third of the output, then merges the parts with a Bash script.

---

#### Step 6a — Launch three parallel agents (single parallel Task dispatch)

Dispatch all three technical-writer agents in **one parallel batch** using the Task tool.
This means issuing all three Task calls together so they execute concurrently —
not one after the other. Each Task call blocks until its agent finishes and the
output file is written. When all three return, proceed to Step 6b (validate), then Step 6c (merge).

**The only correct invocation pattern:**

```
Dispatch in parallel (single batch — all three at once):
  Task 1: [Part 1 instructions below] → writes .sdlc/tmp/srs-part1.json
  Task 2: [Part 2 instructions below] → writes .sdlc/tmp/srs-part2.json
  Task 3: [Part 3 instructions below] → writes .sdlc/tmp/srs-part3.json
When all three Tasks complete → proceed to Step 6b (validate), then Step 6c (merge)
```

**Hard rules — violations cause the polling loop:**

- **MUST dispatch all three Tasks in the same parallel batch** — sequential dispatch defeats parallelism
- **NEVER check for file existence** between or after dispatching — no `ls`, `test -f`, Read tool loops
- **NEVER add a "wait" or "check" step** between 6a and 6b — the batch dispatch IS the wait
- **NEVER re-read or re-check the output files** before merging — trust that each Task wrote its file
- Once all three Tasks return control to the orchestrator, move directly to Step 6b (the merge Bash command)

---

**Part 1 — Narrative intro + NFRs + constraints**

Invoke `technical-writer` with the instruction:

> "Produce Part 1 of the SRS narrative. Write ONLY these keys and nothing else.
> Output strict JSON with no markdown wrapper.
> definitionsTable: every entry MUST have a 'source' field (e.g. 'IEEE 830', 'SBP IT Governance', 'Internal'). Never leave source as an empty string.
> userClasses: every entry MUST have all four fields with real values: role, description, accessLevel (the actual permission level), frequency (how often they use the system).
> All paragraph arrays must have at least 2 substantive sentences each."

Keys for Part 1:

```
projectName, clientName, preparedBy,
purposeParagraphs, documentConventionsParagraphs, intendedAudienceParagraphs,
scopeParagraphs, definitionsTable, referencesBullets, overviewParagraphs,
productPerspective, productFunctionsBullets,
userClasses,
operatingEnvironmentParagraphs, constraintsNumbered,
userDocumentationParagraphs, assumptionsNumbered,
userInterfacesParagraphs, hardwareInterfacesParagraphs,
softwareInterfacesParagraphs, communicationsInterfacesParagraphs,
systemFeaturesIntroParagraphs,
nonFunctionalRequirementsIntroParagraphs,
performanceParagraphs, safetyParagraphs, securityParagraphs,
reliabilityParagraphs, availabilityParagraphs, maintainabilityParagraphs,
portabilityParagraphs, usabilityParagraphs, interoperabilityParagraphs,
designConstraintsParagraphs, logicalDatabaseParagraphs,
otherRequirementsParagraphs,
glossaryParagraphs, analysisModelsIntroParagraphs
```

Write output to `.sdlc/tmp/srs-part1.json`.

---

**Part 2 — System features (FEAT-01 to FEAT-NN) + Use Cases UC-01 to UC-25**

Invoke `technical-writer` with:

> "Produce Part 2 of the SRS narrative. Write ONLY these keys and nothing else.
> Output strict JSON with no markdown wrapper.
> systemFeatures: produce ALL features (8–14 entries). Every feature MUST have:
>
> - functionalRequirementIds: array of REQ-FUNC-NNN strings (from the requirements list)
> - useCaseIds: array of UC-NN strings
> - primaryActors: array of real actor names (e.g. ['Branch Teller', 'Branch Manager'])
> - notes: descriptive string (never 'N/A')
>   useCases: produce UC-01 through UC-25. Every use case MUST have ALL these fields populated:
> - primaryActor: the name of the main actor (NEVER 'N/A' — use the real actor name)
> - secondaryActors: array of other involved actors (use [] if truly none)
> - stakeholders: array of stakeholder roles (never 'N/A')
> - trigger: the event that initiates this use case (NEVER 'N/A')
> - requirementIds: array of REQ-FUNC-NNN that this use case satisfies (NEVER 'N/A')
> - featureId: REQUIRED — must be one of FEAT-01 through FEAT-14 (the same IDs in systemFeatures above)
> - mainFlow: at least 5 steps written WITHOUT a leading number prefix
> - alternateFlows: array of strings (use [] if none)
> - exceptionFlows: array of strings (use [] if none)"

Keys for Part 2:

```
systemFeatures,
useCases  (UC-01 through UC-25 only)
```

Write output to `.sdlc/tmp/srs-part2.json`.

---

**Part 3 — Use Cases UC-26 to end + business rules + diagrams + TBD list**

Invoke `technical-writer` with:

> "Produce Part 3 of the SRS narrative. Write ONLY these keys and nothing else.
> Output strict JSON with no markdown wrapper.
> useCases: produce UC-26 through the end. Every use case MUST have ALL these fields:
>
> - primaryActor: the name of the main actor (NEVER 'N/A')
> - secondaryActors: array of other actors (use [] if none)
> - stakeholders: array of stakeholder roles
> - trigger: the event that initiates this use case (NEVER 'N/A')
> - requirementIds: array of REQ-FUNC-NNN strings (NEVER 'N/A')
> - featureId: REQUIRED — must be one of FEAT-01 through FEAT-14 ONLY.
>   Do NOT invent new feature IDs like FEAT-26, FEAT-27 etc. Every UC must
>   map to one of the 14 features defined in Part 2.
> - mainFlow: at least 5 steps WITHOUT a leading number prefix
> - alternateFlows: array (use [] if none)
> - exceptionFlows: array (use [] if none)
>   businessRules: 10–25 rules. Every rule MUST have:
> - references: array of REQ-NNN or BR-document strings (use [] if none, NOT empty string)
>   tbdList: Every TBD item MUST have:
> - owner: real owner name or team (never 'TBD')
> - deadline: real date YYYY-MM-DD based on project timeline (never 'TBD')
> - references: array of relevant REQ-NNN IDs"

Keys for Part 3:

```
useCases  (UC-26 through end),
businessRules,
useCaseDiagramMermaid, erDiagramMermaid, stateDiagramMermaid,
dataFlowDiagramMermaid, sequenceDiagramsMermaid,
tbdList,
dataModelsParagraphs, apiContractsParagraphs,
complianceConsiderationsParagraphs,
ganttTasks
```

`ganttTasks` is an array of task objects for the project Gantt chart:

```json
[
  { "name": "PHASE NAME", "isPhase": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  { "name": "Task name", "done": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  { "name": "Task name", "active": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  { "name": "Task name", "done": false, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
]
```

Use real dates derived from the project timeline or scope document.
`done:true` = completed, `active:true` = in progress, `done:false` = planned.

Write output to `.sdlc/tmp/srs-part3.json`.

---

#### Step 6b — Validate part files exist (Bash — one-time check, NOT a loop)

After all three Task calls return, run this **single** verification before merging.
This is **not polling** — it executes once. If a file is missing it means that
agent failed silently and the merge must be aborted.

```bash
for f in .sdlc/tmp/srs-part1.json .sdlc/tmp/srs-part2.json .sdlc/tmp/srs-part3.json; do
  if [ ! -f "$f" ]; then
    echo "ERR:SRS_PART_MISSING:$f — agent did not write its output. Re-run /srs."
    exit 1
  fi
  # Quick sanity: file must be valid JSON and non-empty
  node -e "const d=require('fs').readFileSync('$f','utf8'); JSON.parse(d); if(!d.trim()){throw new Error('empty')}" 2>/dev/null || {
    echo "ERR:SRS_PART_INVALID:$f — file is empty or not valid JSON. Re-run /srs."
    exit 1
  }
done
echo "All 3 part files present and valid — proceeding to merge"
```

If any check fails: stop, report which part failed, and do not proceed to the merge.
**Do not retry the agents automatically** — report the error and let the user re-run `/srs`.

---

#### Step 6c — Merge parts (Bash)

```bash
node "<ECC_DIR>/scripts/merge-srs-parts.js" \
  --part1 ".sdlc/tmp/srs-part1.json" \
  --part2 ".sdlc/tmp/srs-part2.json" \
  --part3 ".sdlc/tmp/srs-part3.json" \
  --out   ".sdlc/tmp/srs-data.json"
```

The merger:

- Concatenates `useCases`, `systemFeatures`, `businessRules`, `tbdList`, `definitionsTable`
  from all parts (deduplicates by `id` field)
- First non-empty array wins for all other array fields
- Last non-empty string wins for scalar fields
- Does **not** modify `state.json`

**CRITICAL authoring rules that apply to ALL parts:**

- Every `*Paragraphs` key: **2–5 substantive paragraphs**, each 4–8 sentences, "The system shall…" style
- `systemFeatures`: **8–14 features** with full `stimulusResponse`, actor lists, pre/postconditions
- `useCases` combined total: **40–60 use cases** for enterprise scale; `featureId` REQUIRED on every entry
- `mainFlow` items: write step text **WITHOUT a leading number** — write `"User enters credentials"` not `"1. User enters credentials"` — the renderer numbers them automatically
- `businessRules`: **10–25 rules** with `enforcedBy` attribution
- `userClasses` key names are strict: `role`, `description`, `accessLevel`, `frequency`
- `ganttTasks` must use real dates from the project timeline

`functionalRequirements`, `nonFunctionalRequirements`, `signOffRows`, and `indexEntries`
are NOT produced by the technical writer — sourced from `state.json` by `srs-render-data.js`.

The following fields are also **auto-populated by the pipeline** and must NOT be produced
by any technical-writer agent — they are computed at generation time:

- `documentVersion` — set by `--version` flag on `generate-srs-doc.js`
- `generatedDate` — set to today's date by `srs-render-data.js`
- `versionHistory` — built from `state.json.artifacts.srs.versionHistory`
- `ganttMermaid` — auto-derived from `ganttTasks[]` by `srs-render-data.js` as a fallback;
  only `ganttTasks[]` needs to be produced by the technical writer (Part 3)

---

### Step 7 — Generate `srs-vN.docx` (Bash)

`generate-srs-doc.js` internally calls `srs-render-data.js` which:

1. Unwraps the `srsData` wrapper if present
2. Reads narrative fields from the unwrapped data
3. Sources `functionalRequirements` and `nonFunctionalRequirements` directly
   from `state.json.requirements` — sorted by REQ-ID
4. Normalizes `userClasses` key names to match the template
5. Merges everything into the final render data object

```bash
node "<ECC_DIR>/scripts/generate-srs-doc.js" \
  --data ".sdlc/tmp/srs-data.json" \
  --out ".sdlc/artifacts/srs-v<nextVersion>.docx" \
  --template "<ECC_DIR>/templates/srs-template.json" \
  --version "<nextVersion>" \
  --state ".sdlc/state.json"
```

On success, compute file hash: `sha256:<hex>`

---

### Step 8 — Register artifact and persist final state (Write tool — no Bash)

Update `artifacts.srs`:

```json
{
  "path": ".sdlc/artifacts/srs-v{nextVersion}.docx",
  "version": "{nextVersion}",
  "hash": "sha256:<hex>",
  "templateId": "ecc-sdlc.srs.v1",
  "createdAt": "<original createdAt or now on first run>",
  "updatedAt": "<now>",
  "versionHistory": [
    {
      "version": "{nextVersion}.0",
      "date": "YYYY-MM-DD",
      "author": "ECC-SDLC",
      "changes": "Initial SRS extracted from scope and validated requirements",
      "status": "Draft"
    }
  ]
}
```

Append to existing `versionHistory` — never replace prior entries.

---

### Step 9 — Report completion

Return:

`SDLC:SRS:COMPLETE:[projectName]:[N] requirements extracted and validated — ready for /sds`

---

### Step 9b — Consolidated tmp cleanup (Bash — always runs last)

Run this single cleanup command **after Step 9** regardless of which steps succeeded or failed.
This is the **only** place where tmp files are deleted — never delete them mid-command.

```bash
rm -f \
  .sdlc/tmp/requirements.json \
  .sdlc/tmp/compliance.json \
  .sdlc/tmp/srs-part1.json \
  .sdlc/tmp/srs-part2.json \
  .sdlc/tmp/srs-part3.json \
  .sdlc/tmp/srs-data.json
```

If the command aborted mid-run (validation failure, compliance failure, doc generation error),
this step still runs to leave the workspace clean for the next invocation.
`state.json` is never touched by cleanup — only files under `.sdlc/tmp/`.

---

## Error Handling

| Error                      | Action                                                    |
| -------------------------- | --------------------------------------------------------- |
| `ECC_ROOT_NOT_FOUND`       | set `CLAUDE_PLUGIN_ROOT` or run `npm install` in ECC repo |
| Missing `artifacts.scope`  | stop — ask user to run `/scope` first                     |
| AJV validation failure     | hard stop, state unchanged — tmp cleanup runs in Step 9b  |
| Compliance-checker failure | hard stop, state unchanged — tmp cleanup runs in Step 9b  |
| Doc generation failure     | report `ERR:*` from generator and stop                    |
| `ERR:SRS_PART_MISSING`     | a technical-writer agent failed silently — re-run `/srs`  |
| `ERR:SRS_PART_INVALID`     | a part file is empty or corrupt — re-run `/srs`           |
| State write failure        | stop, do not continue to artifact registration            |

---

## Related Files

- `agents/business-analyst.md`
- `agents/compliance-checker.md`
- `agents/technical-writer.md`
- `scripts/sdlc/validate-requirements.js`
- `scripts/sdlc/utils/initialise-traceforward.js`
- `scripts/sdlc/utils/state-writer.js`
- `scripts/generate-srs-doc.js`
- `lib/doc-generator/srs-render-data.js`
- `lib/doc-generator/srs-doc.js`
- `templates/srs-template.json`
- `frameworks/*.json`
