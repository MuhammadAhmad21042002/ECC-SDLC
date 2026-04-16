# Traceability Rules
**Scope:** ECC-SDLC — enforced from SDS phase onward
**Applies to:** solution-architect agent, technical-writer agent, /sds command, /sts command, /traceability command

---

## 1. The Traceability Principle

Every requirement must have a forward trace to at least:
- One design component (in SDS)
- One test case (in STS)
- One cost line item (in estimate)

A requirement with no forward trace is a coverage gap. Coverage gaps block
the phase gate from advancing. The traceability-guard hook.js enforces this
automatically on every Write/Edit operation.

---

## 2. ID Reference Format

When referencing requirement IDs in any document or code, always use the
exact ID format:

| Artifact | ID Format | Example |
|---|---|---|
| Requirement | `REQ-FUNC-NNN` / `REQ-NFUNC-NNN` / `REQ-CON-NNN` | `REQ-FUNC-001` |
| Design Component | `DC-NNN` | `DC-001` |
| Test Case | `TC-NNN` | `TC-001` |
| Cost Line Item | `COST-NNN` | `COST-001` |

- IDs must appear verbatim — no paraphrasing, no shorthand
- Every section in the SDS and STS must reference at least one `REQ-*` ID
- The traceability-guard hook scans for these patterns and warns if missing

---

## 3. traceForward Object

Every requirement in state.json carries a `traceForward` object:

```json
"traceForward": {
  "designComponentIds": ["DC-001", "DC-002"],
  "testCaseIds": ["TC-001", "TC-002"],
  "costLineItemIds": ["COST-001"]
}
```

- `designComponentIds` — populated during SDS phase by solution-architect agent
- `testCaseIds` — populated during STS phase by business-analyst + technical-writer
- `costLineItemIds` — populated during estimation phase by estimator agent
- Empty arrays are allowed only in the discovery and requirements phases
- After SDS is complete, every `must` requirement must have at least one `designComponentIds` entry

---

## 4. Traceability Matrix

The traceability matrix in state.json maps every requirement to its forward traces:

```json
"traceabilityMatrix": {
  "REQ-FUNC-001": {
    "title": "AI-Powered Knowledge Base Search",
    "designComponents": ["DC-001"],
    "testCases": ["TC-001", "TC-002"],
    "costLineItems": ["COST-001"],
    "coverageScore": 100
  },
  "REQ-FUNC-002": {
    "title": "Bilingual Search Support",
    "designComponents": [],
    "testCases": [],
    "costLineItems": [],
    "coverageScore": 0
  }
}
```

- `coverageScore` is calculated as: (number of filled trace categories / 3) × 100
- Score of 100 = fully traced
- Score of 0 = not traced at all (gap)
- The /traceability command generates a full matrix report with all gaps highlighted

**Overall coverage score rollup:**
- Each requirement scores 0, 33, 67, or 100 based on how many trace categories are filled
- Overall score = sum of all requirement scores ÷ total number of requirements
- Example: 10 requirements with scores [100,100,67,100,0,100,100,100,100,100]
  = 867 ÷ 10 = 86.7% overall — passes the 80% gate
- A single `must` requirement scoring 0 blocks the handoff gate entirely,
  regardless of how high the overall score is
- `should` and `could` requirements contribute to the overall score but
  do not individually block any gate

---

## 5. Coverage Requirements by Phase Gate

| Phase Gate | Minimum Coverage Required |
|---|---|
| Discovery → Requirements | No traceability required |
| Requirements → Design | No traceability required |
| Design → Test Planning | All `must` requirements must have at least one DC |
| Test Planning → Estimation | All `must` requirements must have at least one TC |
| Estimation → Proposal | All `must` requirements must have at least one COST |
| Proposal → Handoff | Overall coverage score ≥ 80% AND `must` requirements at 100% coverage |

**Handoff gate detail:**
- Overall traceability coverage score across ALL requirements must be ≥ 80%
- `must` priority requirements specifically must have 100% coverage — all three
  trace categories (DC, TC, COST) must be filled
- A single uncovered `must` requirement blocks the handoff gate entirely
- `should` and `could` requirements contribute to the overall 80% score

---

## 6. SDS Traceability Rules

Every section in the SDS document must:
- Reference at least one `REQ-*` ID in its opening paragraph
- Add the corresponding `DC-*` ID to `traceForward.designComponentIds` in state.json
- Never introduce a design component that has no corresponding requirement

If a design decision is made that has no requirement:
1. Create a new constraint requirement (`REQ-CON-NNN`) to capture it
2. Add it to state.json requirements array
3. Then trace the design component to it

---

## 7. STS Traceability Rules

Every test case in the STS document must:
- Reference exactly one `REQ-*` ID it is testing
- Use the acceptance criteria from that requirement as the basis for pass/fail conditions
- Add its `TC-*` ID to `traceForward.testCaseIds` in state.json

Test cases must achieve full coverage of all `must` and `should` requirements.
`could` requirements need at least one test case.
`wont` requirements need no test cases.

---

## 8. What is Forbidden

-  Writing an SDS section with no `REQ-*` reference
-  Writing a test case with no `REQ-*` reference
-  Introducing a design component with no corresponding requirement
-  Advancing past the Design phase gate with uncovered `must` requirements
-  Advancing to Handoff with any `must` requirement below 100% coverage
-  Modifying a requirement ID after it has been traced — coordinate with team first
-  Deleting a traced requirement without updating all forward links
