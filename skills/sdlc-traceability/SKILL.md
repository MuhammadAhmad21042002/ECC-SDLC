---
name: sdlc-traceability
description: >
  Traceability chain reference for ECC-SDLC. Load this skill when working with
  REQ-* forward links, interpreting /traceability output, or debugging coverage
  gaps. Covers the four-link chain (REQ→DC→TC→COST), coverage scoring formula,
  gap severity classification, and a worked end-to-end example with internally
  consistent IDs. Used by the /traceability command and traceability-guard hook.
---

# SDLC Traceability Skill

## Purpose

This skill is the reference guide for any agent or developer working with
traceability data in ECC-SDLC. It defines the full REQ-\* → DC-\* → TC-\* →
COST-\* chain, the coverage scoring formula, the three gap types and their
severity ordering, and a worked end-to-end example with internally consistent
IDs for use as a debugging reference when `/traceability` reports unexpected
gaps.

Traceability is the quality backbone of ECC-SDLC. A requirement with no design
component link represents unbounded scope. A requirement with no test case
represents untested functionality. A requirement with no cost line item
represents unpriced work delivered to the client. All three are preventable
through rigorous forward-link maintenance.

---

## When to Use

Load this skill when:

- Running `/traceability` to generate or interpret the coverage matrix
- Debugging a phase gate block caused by missing forward links
- Populating `traceForward` fields during `/sds`, `/sts`, or `/estimate`
- Reviewing `state.json` for orphaned REQ-\* IDs before advancing a phase
- Explaining a coverage gap to a developer or reviewer

---

## 1. The Four-Link Chain

ECC-SDLC traces every requirement forward through three artifact types and
back through one. Together they form the complete accountability chain.

### Link 1 — REQ → DC (Design Link)

**Field:** `requirement.traceForward.designComponentIds`
**Direction:** Forward — written by the solution-architect agent during `/sds`
**Meaning:** This requirement is implemented by these design components.

```json
"traceForward": {
  "designComponentIds": ["DC-001"]
}
```

A requirement with an empty `designComponentIds` array after the SDS phase is
complete has a **design gap** — the most severe gap type.

### Link 2 — DC → REQ (Back-Link)

**Field:** `designComponent.requirementIds`
**Direction:** Backward — written by the solution-architect agent alongside Link 1
**Meaning:** This design component implements these requirements.

```json
{
  "id": "DC-001",
  "requirementIds": ["REQ-FUNC-001"]
}
```

Every DC must have at least one entry in `requirementIds`. A DC with an empty
`requirementIds` array is an orphaned component — it has no requirement
justifying its existence and must not be created.

### Link 3 — REQ → TC (Test Link)

**Field:** `requirement.traceForward.testCaseIds`
**Direction:** Forward — written by the technical-writer agent during `/sts`
**Meaning:** This requirement is verified by these test cases.

```json
"traceForward": {
  "testCaseIds": ["TC-001"]
}
```

A requirement with an empty `testCaseIds` array after the STS phase is complete
has a **test gap** — the second most severe gap type.

### Link 4 — REQ → COST (Cost Link)

**Field:** `requirement.traceForward.costLineItemIds`
**Direction:** Forward — written by the estimator agent during `/estimate`
**Meaning:** This requirement is priced by these cost line items.

```json
"traceForward": {
  "costLineItemIds": ["COST-001"]
}
```

A requirement with an empty `costLineItemIds` array after the estimation phase
is complete has a **cost gap** — the third severity level.

### End-to-End Chain

The complete path for a fully traced requirement:

```text
REQ-FUNC-001
  │
  ├─[designComponentIds]──► DC-001
  │                           └─[requirementIds]──► REQ-FUNC-001 (back-link)
  │
  ├─[testCaseIds]─────────► TC-001
  │
  └─[costLineItemIds]─────► COST-001
```

All four links must be present before a `must` requirement reaches 100%
coverage and the handoff phase gate will open.

---

## 2. Coverage Scoring

### Per-Requirement Score

Each requirement earns a score from 0 to 100 based on how many of its three
forward-link categories are non-empty.

| Filled categories | Score |
| --- | --- |
| 0 of 3 | 0 |
| 1 of 3 | 33 |
| 2 of 3 | 67 |
| 3 of 3 | 100 |

Formula: `coverageScore = Math.round((filledCategories / 3) * 100)`

A category is filled when its array contains at least one valid ID. An array
with entries that reference non-existent artifacts does not count as filled —
broken references are treated as empty.

### Overall Project Score

```text
overallCoverage = sum(coverageScore for all requirements) / totalRequirements
```

The result is a percentage. The handoff phase gate requires `overallCoverage ≥ 80`.

### Phase Gate Thresholds

| Phase transition | Minimum coverage required |
| --- | --- |
| Discovery → Requirements | None |
| Requirements → Design | None |
| Design → Test Planning | All `must` requirements: `designComponentIds` non-empty |
| Test Planning → Estimation | All `must` requirements: `testCaseIds` non-empty |
| Estimation → Proposal | All `must` requirements: `costLineItemIds` non-empty |
| Proposal → Handoff | `overallCoverage ≥ 80` AND every `must` requirement at score 100 |

A single `must` requirement at score 0 blocks the handoff gate regardless of
the overall percentage.

---

## 3. Gap Classification

### Design Gap — Most Severe

**Condition:** `traceForward.designComponentIds` is empty after SDS is complete.

**Why most severe:** The requirement has no design component — it is unbounded
scope. There is no specification of what will be built, and the estimator agent
cannot cost it. A design gap is the only gap type that cascades: it forces both
a test gap and a cost gap simultaneously.

**Phase gate impact:** Blocks the Design → Test Planning gate for `must`
requirements.

**Remediation:** Re-run `/sds` or manually add a DC-\* entry via the solution-
architect agent. Then populate `designComponent.requirementIds` with the
matching REQ-\* ID.

### Test Gap — Second Severity

**Condition:** `traceForward.testCaseIds` is empty after STS is complete.

**Why second:** The requirement will be delivered without any agreed pass/fail
conditions. The client cannot verify acceptance, and the team cannot confirm
the feature works. A test gap does not cascade to cost — the requirement can
still be priced.

**Phase gate impact:** Blocks the Test Planning → Estimation gate for `must`
requirements.

**Remediation:** Re-run `/sts` or add a TC-\* entry via the technical-writer
agent referencing the requirement's acceptance criteria.

### Cost Gap — Third Severity

**Condition:** `traceForward.costLineItemIds` is empty after estimation is
complete.

**Why third:** The requirement is specified and testable but unpriced.
Unpriced work will be delivered without compensation or be dropped from scope
when budgets are challenged. A cost gap does not affect functionality but
directly affects commercial viability.

**Phase gate impact:** Blocks the Estimation → Proposal gate for `must`
requirements.

**Remediation:** Re-run `/estimate` or add a COST-\* entry via the estimator
agent that covers the design component implementing this requirement.

---

## 4. Worked End-to-End Example

This example uses the FBR AI Knowledge Platform as context. All IDs are
internally consistent — every reference resolves to an entry shown in this
section.

### The Requirement

```json
{
  "id": "REQ-FUNC-001",
  "type": "functional",
  "title": "AI-Powered Knowledge Base Search",
  "description": "The system shall provide natural language search across the FBR knowledge base returning results in under 2 seconds.",
  "priority": "must",
  "source": "RFP Section 3.2.1, Page 12",
  "status": "approved",
  "acceptanceCriteria": [
    "Given an authenticated FBR officer, when they submit a search query in Urdu or English, then the system returns ranked results within 2 seconds at p95.",
    "Given 500 concurrent search requests, when all are submitted simultaneously, then no response exceeds 5 seconds."
  ],
  "complianceFrameworks": ["PPRA-2024"],
  "traceForward": {
    "designComponentIds": ["DC-001"],
    "testCaseIds": ["TC-001"],
    "costLineItemIds": ["COST-001"]
  }
}
```

### The Design Component (Link 1 + Link 2)

```json
{
  "id": "DC-001",
  "title": "Search Service API",
  "description": "REST API that accepts natural language queries, calls the vector embedding model, performs semantic search over the FBR document index, and returns ranked results.",
  "type": "api",
  "status": "approved",
  "requirementIds": ["REQ-FUNC-001"],
  "responsibilities": [
    "Accept query string and session token",
    "Invoke embedding model to vectorise query",
    "Execute ANN search over document index",
    "Return top-10 ranked results with relevance scores"
  ],
  "interfaces": [
    { "name": "SearchEndpoint", "kind": "api", "description": "POST /api/v1/search" },
    { "name": "DocumentIndex", "kind": "db", "description": "pgvector table storing document embeddings" }
  ],
  "dataStores": ["DocumentIndex"],
  "complexity": "average",
  "assignedRole": "seniorDev"
}
```

Back-link confirmed: `DC-001.requirementIds` contains `REQ-FUNC-001`. ✓

### The Test Case (Link 3)

```json
{
  "id": "TC-001",
  "requirementId": "REQ-FUNC-001",
  "title": "Search returns ranked results within 2 seconds",
  "precondition": "FBR officer is authenticated; document index contains at least 1,000 documents.",
  "steps": [
    "Submit POST /api/v1/search with query 'ٹیکس ریٹرن' (Urdu: tax return)",
    "Record response time from request sent to first byte received"
  ],
  "expectedResult": "HTTP 200 with array of at least 1 result; response time ≤ 2000 ms.",
  "priority": "must"
}
```

Back-link confirmed: `TC-001.requirementId` is `REQ-FUNC-001`. ✓

### The Cost Line Item (Link 4)

```json
{
  "id": "COST-001",
  "requirementId": "REQ-FUNC-001",
  "designComponentId": "DC-001",
  "title": "Search Service API — Development",
  "role": "seniorDev",
  "functionPointType": "EO",
  "complexity": "average",
  "functionPoints": 5,
  "effortHours": 40,
  "storyPoints": 5
}
```

Back-link confirmed: `COST-001.requirementId` is `REQ-FUNC-001`. ✓

### The Traceability Matrix Entry

```json
"traceabilityMatrix": {
  "REQ-FUNC-001": {
    "title": "AI-Powered Knowledge Base Search",
    "designComponents": ["DC-001"],
    "testCases": ["TC-001"],
    "costLineItems": ["COST-001"],
    "coverageScore": 100
  }
}
```

### Coverage Score Calculation

```text
Filled categories for REQ-FUNC-001:
  designComponentIds  — ["DC-001"]   → filled ✓
  testCaseIds         — ["TC-001"]   → filled ✓
  costLineItemIds     — ["COST-001"] → filled ✓

filledCategories = 3
coverageScore = Math.round((3 / 3) * 100) = 100

Overall project score (1 requirement):
  overallCoverage = 100 / 1 = 100%
```

REQ-FUNC-001 passes all four phase gate checks. ✓

---

## 5. Partial Coverage Example

This example shows a second requirement with a test gap, demonstrating how the
overall score is calculated when coverage is mixed.

```json
{
  "id": "REQ-FUNC-002",
  "title": "Bilingual Search Support",
  "priority": "should",
  "traceForward": {
    "designComponentIds": ["DC-002"],
    "testCaseIds": [],
    "costLineItemIds": ["COST-002"]
  }
}
```

```json
"traceabilityMatrix": {
  "REQ-FUNC-001": { "coverageScore": 100 },
  "REQ-FUNC-002": { "coverageScore": 67 }
}
```

```text
REQ-FUNC-002:
  designComponentIds  — ["DC-002"]   → filled ✓
  testCaseIds         — []           → empty  ✗  ← test gap
  costLineItemIds     — ["COST-002"] → filled ✓

filledCategories = 2
coverageScore = Math.round((2 / 3) * 100) = 67

Overall project score (2 requirements):
  overallCoverage = (100 + 67) / 2 = 83.5%  → passes the ≥ 80% gate ✓

Gate status:
  REQ-FUNC-001 (must)   — score 100 → all phase gates clear ✓
  REQ-FUNC-002 (should) — score 67  → test gap present, but 'should'
                                       does not individually block any gate ✓
```

The project can advance to handoff. However, the test gap on REQ-FUNC-002
must be remediated before the `/sts` artifact is final — `should` requirements
require at least one test case per the traceability rules.

---

## 6. Interpreting /traceability Output

The `/traceability` command reads `state.json.traceabilityMatrix` and renders
a gap report. Each row represents one requirement.

| Column | What it means |
| --- | --- |
| REQ-ID | Requirement identifier |
| DC | Design component IDs, or `—` if empty |
| TC | Test case IDs, or `—` if empty |
| COST | Cost line item IDs, or `—` if empty |
| Score | 0 / 33 / 67 / 100 |
| Gap | `design` / `test` / `cost` / `none` |

Reading the report:

- Any row with `Score: 0` is a complete gap — all three links are missing.
  This is the highest priority remediation target.
- Any `must` row with `Score < 100` blocks the handoff gate.
- Rows with `Gap: design` also imply `Gap: test` and `Gap: cost` because no
  DC means no TC was linked and no cost was attributed.
- The summary line shows `overallCoverage` and a pass/fail against the 80%
  threshold.

---

## 7. Common Mistakes

| Mistake | Effect | Fix |
| --- | --- | --- |
| `designComponentIds` populated but `DC.requirementIds` not updated | Back-link broken; DC appears orphaned | Always update both sides simultaneously |
| TC added to `testCaseIds` but `TC.requirementId` points to different REQ | Inconsistent matrix; `/traceability` may flag a ghost gap | Match `TC.requirementId` to the same REQ-\* ID in the forward link |
| COST-\* entry created without `requirementId` field | Cost gap remains open even though COST exists | Every COST entry must carry `requirementId` pointing to the REQ it covers |
| Phase gate blocks on a `should` requirement | Not a block — `should` never individually blocks gates | Check the gate message; it is blocking on a `must` requirement, not the `should` |
| `coverageScore` manually set to 100 when arrays are still empty | Phase gate hook reads arrays, not the score field | The score is computed from arrays; populating the arrays is the fix |
| Two requirements sharing one TC-\* ID | Each TC must reference exactly one `requirementId` | Create separate test cases — one per requirement |
