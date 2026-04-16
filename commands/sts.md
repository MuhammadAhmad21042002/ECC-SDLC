---
name: sts
description: Generate Software Test Specification (IEEE 829) from SRS/SDS inputs. Extract test cases with business-analyst, hard-validate TC-NNN format, update traceability links, render sts-vN.docx, and register the artifact.
---

# /sts — Software Test Specification (IEEE 829)

## Purpose

`/sts` produces:

- `.sdlc/artifacts/sts-vN.docx` — a client-ready STS based on `templates/sts-template.json`
- `.sdlc/state.json` updates — validated `testCases[]`, bidirectional traceability (`traceForward.testCaseIds` on requirements), and registered `artifacts.sts`

This command runs after `/sds` and before `/estimate`.

---

## Preconditions

Read `.sdlc/state.json` and verify all checks before any extraction:

- `artifacts.srs` exists and is non-null
- `artifacts.sds` exists and is non-null
- `requirements[]` is non-empty
- `designComponents[]` is non-empty (from /sds)
- `projectName` and `clientName` are non-empty strings
- current project state is readable JSON

If any precondition fails, stop and ask user to complete `/srs` and `/sds` first.

---

## Orchestration Steps

### Step 0 — Resolve and cache ECC runtime root (Bash — one call)

Use the same root-resolution pattern as `/srs` and `/sds`. Runtime must include:

- `scripts/generate-sts-doc.js`
- `scripts/sdlc/validate-test-cases.js`
- `schemas/test-case.schema.json`
- `templates/sts-template.json`
- `lib/doc-generator/generic-doc.js`
- `node_modules/docx/package.json`

If not found, stop with `ECC_ROOT_NOT_FOUND`.

---

### Step 1 — Load and prepare state (Read/Write tools — no Bash)

Read `.sdlc/state.json` and capture:

- `projectId` (must be preserved exactly)
- `projectName`, `clientName`
- `eccRoot`
- existing `requirements[]` (with current `traceForward` state)
- existing `designComponents[]` (from /sds)
- existing `testCases[]` (may be empty on first run)
- `artifacts.sts.version` (default 0 if null)
- `phaseHistory`

If Step 0 resolved a new root, write back `eccRoot` now.

Compute `nextVersion = (artifacts.sts.version || 0) + 1`.

Keep an in-memory copy of raw `state.json` content for byte-compare if validation fails.

---

### Step 2 — Extract test cases (Agent: business-analyst + sdlc-test-planning skill)

Invoke `business-analyst` with:

- SRS context from state (requirements array)
- SDS context from state (design components array)
- project metadata
- any additional user notes

Require strict JSON output:

```json
{
  "testCases": [
    {
      "testCaseId": "TC-001",
      "linkedRequirements": ["REQ-FUNC-001", "REQ-NFUNC-003"],
      "linkedComponents": ["CMP-API-001"],
      "testType": "integration",
      "testLevel": "system",
      "priority": "high",
      "description": "Verify user authentication with MFA",
      "preconditions": ["User account exists", "MFA device enrolled"],
      "steps": [
        "Navigate to login page",
        "Enter valid credentials",
        "Submit MFA code"
      ],
      "testData": "Valid user credentials from test data set",
      "expectedResult": "User successfully authenticated and redirected to dashboard",
      "actualResult": null,
      "status": "not-run",
      "executionDate": null,
      "executedBy": null,
      "notes": null
    }
  ]
}
```

**CRITICAL REQUIREMENTS:**

1. Every test case MUST have `testCaseId` in format `TC-NNN` (zero-padded 3-digit starting at TC-001)
2. Every test case MUST have at least one REQ-* ID in `linkedRequirements[]`
3. Generate at least one test case for EVERY requirement in `state.json.requirements[]`
4. Test types: `unit`, `integration`, `system`, `uat`, `performance`, `security`
5. No markdown wrappers. No prose.

After extraction completes, write the test cases to a temporary file:

```bash
mkdir -p .sdlc/tmp
# write extracted testCases array to:
# .sdlc/tmp/test-cases.json
```

**Important:** `.sdlc/state.json` is NOT modified at this point.

---

### Step 3 — Validate test cases (Bash)

Validate the tmp test cases file — NOT state.json — using:

```bash
node "<ECC_DIR>/scripts/sdlc/validate-test-cases.js" \
  --file ".sdlc/tmp/test-cases.json" \
  --state ".sdlc/state.json"
```

Validation contract:

- `allErrors: true` — report all failing test cases in one pass
- Verify TC-NNN format on all `testCaseId` fields
- Verify every test case has at least one REQ-* in `linkedRequirements`
- Verify all REQ-* IDs exist in `state.json.requirements[]`
- Verify all CMP-* IDs (if present) exist in `state.json.designComponents[]`
- exit `1` on any validation failure (hard block)

If validation fails:

```bash
rm -f .sdlc/tmp/test-cases.json
```

- do not modify `.sdlc/state.json` — it remains byte-identical to pre-run state
- report all failures to the user and stop

---

### Step 4 — Compute traceability coverage (Read only — no state update yet)

Only after Step 3 passes.

Read `.sdlc/tmp/test-cases.json` and compute coverage metrics:

For each requirement in `state.json.requirements[]`:
- Find all test cases where `linkedRequirements` includes this REQ-ID
- Count total test cases covering this requirement
- Flag requirements with zero test coverage

Generate coverage summary:

```json
{
  "totalRequirements": 45,
  "coveredRequirements": 43,
  "uncoveredRequirements": ["REQ-FUNC-042", "REQ-NFUNC-015"],
  "coveragePercent": 95.6,
  "byCoverageLevel": {
    "0-tests": 2,
    "1-test": 15,
    "2-tests": 18,
    "3+-tests": 10
  },
  "byRequirementType": {
    "functional": { "total": 30, "covered": 29, "percent": 96.7 },
    "non-functional": { "total": 12, "covered": 11, "percent": 91.7 },
    "constraint": { "total": 3, "covered": 3, "percent": 100.0 }
  }
}
```

Write to `.sdlc/tmp/coverage-summary.json`.

**Important:** `.sdlc/state.json` is NOT modified at this point.

---

### Step 5 — Atomic state update (Write tool — no Bash)

Only after Steps 3 and 4 complete successfully.

1. Read `.sdlc/tmp/test-cases.json`
2. Read `.sdlc/tmp/coverage-summary.json`
3. Merge extracted test cases into state payload:
   - Replace `state.testCases[]` entirely with new test cases array
4. Update bidirectional traceability:
   - For EACH requirement in `state.requirements[]`:
     - Find all test cases where `linkedRequirements` includes this REQ-ID
     - Set `requirement.traceForward.testCaseIds = [matching TC-IDs]`
     - Merge-safe: preserve existing `designComponentIds` and `costLineItemIds`
5. Set `currentPhase` to `"test-planning"`
6. Update `phaseHistory`:
   - mark design as completed (if still open)
   - add/start test-planning phase entry
7. Store coverage summary in `state.testCoverageSummary`

Write the full updated object to `.sdlc/state.json` once (single atomic write).

After successful write, clean up tmp files:

```bash
rm -f .sdlc/tmp/test-cases.json
rm -f .sdlc/tmp/coverage-summary.json
```

---

### Step 6 — Build STS narrative data (Agent: technical-writer)

Invoke `technical-writer` to produce the narrative sections of the STS.

The technical writer reads:

- `state.json` — project name, client, phase, requirements summary, test cases summary
- `artifacts.srs.path` — SRS document for context
- `artifacts.sds.path` — SDS document for context

Expected output — narrative fields only. Test cases tables are sourced
directly from `state.json.testCases` by `sts-render-data.js`.

**STRICT KEY NAMES — use exactly these keys, no variations:**

```json
{
  "stsData": {
    "projectName": "...",
    "clientName": "...",
    "preparedBy": "...",
    "purposeParagraphs": ["..."],
    "testScopeParagraphs": ["..."],
    "definitionsTable": [
      { "term": "...", "definition": "...", "source": "..." }
    ],
    "referencesBullets": ["..."],
    "overviewParagraphs": ["..."],
    "itemsToBeTestedBullets": ["..."],
    "itemsNotToBeTestedBullets": ["..."],
    "testLevelsParagraphs": ["..."],
    "testingApproachParagraphs": ["..."],
    "testAutomationParagraphs": ["..."],
    "entryCriteriaBullets": ["..."],
    "exitCriteriaBullets": ["..."],
    "suspensionCriteriaParagraphs": ["..."],
    "hardwareRequirementsParagraphs": ["..."],
    "softwareRequirementsParagraphs": ["..."],
    "networkConfigParagraphs": ["..."],
    "testDataRequirementsParagraphs": ["..."],
    "environmentSetupParagraphs": ["..."],
    "coverageGapsParagraphs": ["..."],
    "testSchedule": [
      {
        "phase": "Unit Testing",
        "startDate": "2026-04-15",
        "endDate": "2026-04-22",
        "duration": "5 days",
        "owner": "Dev Team",
        "status": "Planned"
      }
    ],
    "resourceAllocation": [
      {
        "role": "QA Lead",
        "name": "TBD",
        "allocation": "100%",
        "startDate": "2026-04-15",
        "endDate": "2026-05-30",
        "responsibilities": "Test strategy, execution oversight"
      }
    ],
    "testDeliverablesBullets": ["..."],
    "defectReportingParagraphs": ["..."],
    "defectSeverityClassification": [
      {
        "severity": "Critical",
        "description": "System crash or data loss",
        "example": "Database corruption on save",
        "sla": "4 hours"
      }
    ],
    "defectTrackingParagraphs": ["..."],
    "testRisks": [
      {
        "riskId": "RISK-001",
        "description": "Insufficient test environment availability",
        "probability": "Medium",
        "impact": "High",
        "severity": "High",
        "mitigation": "Reserve dedicated test environment early"
      }
    ],
    "mitigationStrategiesParagraphs": ["..."],
    "testDataSpecificationsParagraphs": ["..."],
    "testToolsParagraphs": ["..."]
  }
}
```

`testCases`, `traceabilityMatrix`, `coverageSummary`, `signOffRows`, and
`indexEntries` are NOT produced by the technical writer — they are sourced
directly from `state.json` by `sts-render-data.js`.

Write output to `.sdlc/tmp/sts-data.json`.

If output is partial, `sts-render-data.js` fills missing fields with
deterministic defaults before doc generation.

---

### Step 7 — Generate `sts-vN.docx` (Bash)

`generate-sts-doc.js` internally calls `sts-render-data.js` which:

1. Unwraps the `stsData` wrapper if present
2. Reads narrative fields from the unwrapped data
3. Sources `testCases` directly from `state.json.testCases` — sorted by TC-ID
4. Builds `traceabilityMatrix` from `state.json.requirements[]` with bidirectional links
5. Sources `coverageSummary` from `state.json.testCoverageSummary`
6. Merges everything into the final render data object

```bash
node "<ECC_DIR>/scripts/generate-sts-doc.js" \
  --data ".sdlc/tmp/sts-data.json" \
  --out ".sdlc/artifacts/sts-v<nextVersion>.docx" \
  --template "<ECC_DIR>/templates/sts-template.json" \
  --version "<nextVersion>" \
  --state ".sdlc/state.json"
```

On success, compute file hash: `sha256:<hex>`

Clean up after generation:

```bash
rm -f .sdlc/tmp/sts-data.json
```

---

### Step 8 — Register artifact and persist final state (Write tool — no Bash)

Update `artifacts.sts`:

```json
{
  "path": ".sdlc/artifacts/sts-v{nextVersion}.docx",
  "version": "{nextVersion}",
  "hash": "sha256:<hex>",
  "templateId": "ecc-sdlc.sts.v1",
  "createdAt": "<original createdAt or now on first run>",
  "updatedAt": "<now>",
  "versionHistory": [
    {
      "version": "{nextVersion}.0",
      "date": "YYYY-MM-DD",
      "author": "ECC-SDLC",
      "changes": "Initial STS with {N} test cases covering {M} requirements",
      "status": "Draft"
    }
  ]
}
```

Append to existing `versionHistory` — never replace prior entries.

---

### Step 9 — Report completion

Return:

`SDLC:STS:COMPLETE:[projectName]:[N] test cases generated — {coverage}% requirement coverage — ready for /estimate`

Include coverage summary:
- Total test cases generated
- Total requirements covered
- Coverage percentage
- Any uncovered requirements (if coverage < 100%)

---

## Error Handling

| Error | Action |
| --- | --- |
| `ECC_ROOT_NOT_FOUND` | set `CLAUDE_PLUGIN_ROOT` or run `npm install` in ECC repo |
| Missing `artifacts.srs` or `artifacts.sds` | stop — ask user to run `/srs` and `/sds` first |
| Empty `requirements[]` | stop — ask user to run `/srs` first |
| Empty `designComponents[]` | stop — ask user to run `/sds` first |
| Test case validation failure | hard stop, delete tmp files, state unchanged |
| Missing TC-NNN format | hard stop, report malformed test case IDs |
| Missing linkedRequirements | hard stop, report test cases with no REQ-* links |
| Invalid REQ-* or CMP-* references | hard stop, report non-existent IDs |
| Doc generation failure | report `ERR:*` from generator and stop |
| State write failure | stop, do not continue to artifact registration |

---

## Traceability Requirements

**CRITICAL:** Every test case MUST satisfy:

1. `testCaseId` matches pattern `TC-\d{3}` (e.g., TC-001, TC-042, TC-115)
2. `linkedRequirements[]` is non-empty array of valid REQ-* IDs
3. All REQ-* IDs exist in `state.json.requirements[]`

**CRITICAL:** After state update, every requirement MUST have:

- `traceForward.testCaseIds` populated with all TC-IDs that reference it
- This enables the traceability matrix in STS.docx to show full coverage

**Coverage Goal:** At least one test case for every requirement (100% coverage target)

---

## Related Files

- `agents/business-analyst.md`
- `agents/technical-writer.md`
- `skills/sdlc-test-planning/SKILL.md`
- `scripts/sdlc/validate-test-cases.js`
- `scripts/generate-sts-doc.js`
- `lib/doc-generator/sts-render-data.js`
- `lib/doc-generator/sts-doc.js`
- `templates/sts-template.json`
- `schemas/test-case.schema.json`