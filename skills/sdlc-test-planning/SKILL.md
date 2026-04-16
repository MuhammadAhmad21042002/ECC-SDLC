---
name: sdlc-test-planning
description: >
  IEEE 829 test planning and specification methodology for ECC-SDLC. Load this skill
  when generating, writing, or validating test cases during /sts. Covers TC-NNN test
  case ID format, six test type classifications with decision tree, Given-When-Then
  patterns, compliance-driven test cases, traceability requirements, and coverage
  strategies. Used by the business-analyst agent during /sts.
---

# SDLC Test Planning Skill

## Purpose

This skill is the reference guide for the Business Analyst agent running during
the `/sts` command. It provides the IEEE 829 test plan structure, the `TC-NNN`
test case ID format, test type definitions, and the traceability rule that links
every test case to a `REQ-*` requirement.

Without this skill, the BA agent may generate test cases that omit the
`requirementId` field or use non-standard IDs. Both errors make the test case
invisible to the `traceability-guard.js` hook and create false coverage gaps in
the `/traceability` output.

State.json is the output destination — the STS document is a human-readable view
generated from `state.json.testCases`.

---

## When to Use

Load this skill when:

- Running `/sts` to generate the Software Test Specification
- Adding or editing test cases in `state.json`
- Debugging a test coverage gap reported by the `/traceability` command
- Reviewing a `TC-*` entry for schema compliance before advancing the phase gate

---

## 1. IEEE 829 Test Plan Structure

IEEE 829 is the international standard for Software Test Documentation. Every
Software Test Specification produced by `/sts` must include the following seven
elements in order.

### 1.1 Test Plan Identifier

A unique identifier for the test plan document. Format: `STS-[projectId]-v[N]`.
Include the project name, version number, and date in the document header.

### 1.2 Test Scope

A description of what is being tested and what is explicitly excluded. Reference
the SRS version from which the test cases are derived. List the `REQ-*` IDs in
scope and any requirements intentionally deferred to a later test cycle.

### 1.3 Test Items

The specific software components, APIs, or user flows under test. Each test item
must correspond to at least one design component (`DC-*`) from the SDS. Do not
test items that have no design component — file a design gap instead.

### 1.4 Features to Be Tested

A tabular list of features derived from approved requirements. Each row maps one
`REQ-FUNC-*` or `REQ-NFUNC-*` ID to the feature name and assigned test type.
`wont`-priority requirements are excluded from this table.

### 1.5 Test Approach

The strategy for executing each test type:

- **Unit** tests: driven by function-level acceptance criteria from the SRS
- **Integration** tests: driven by component interaction requirements
- **System** tests: driven by end-to-end functional requirements
- **Performance** tests: driven by SLA thresholds in `REQ-NFUNC-*` entries
- **Security** tests: driven by compliance controls in `complianceFrameworks`
- **UAT**: driven by client sign-off conditions stated in the proposal

State the entry criteria (what must be true before testing begins), the
execution order, and any environment or data prerequisites.

### 1.6 Pass/Fail Criteria

Explicit, binary conditions that determine whether a test case passes or fails.
Derive pass/fail criteria directly from the `acceptanceCriteria` array of the
linked requirement. A test case passes only when every criterion is met. Partial
passes are not permitted.

### 1.7 Test Deliverables

Documents and artifacts produced by the test phase:

- Software Test Specification (`.sdlc/artifacts/sts-v[N].docx`)
- Updated `state.json` with `testCases` array populated and `traceForward.testCaseIds` filled
- Traceability matrix showing `REQ-* → TC-*` links
- Test execution report (produced by the development team, not ECC-SDLC)

---

## 2. Test Case ID Format (TC-NNN)

### Format Rule

Every test case must have a unique ID following this exact pattern:

```text
TC-NNN
```

Where `NNN` is a zero-padded 3-digit integer starting at `001` and incrementing
sequentially with no gaps.

Full format: `^TC-[0-9]{3}$`

| Valid | Invalid |
| --- | --- |
| `TC-001` | `TC-1` |
| `TC-042` | `TC042` |
| `TC-100` | `tc-001` |
| `TC-115` | `TEST-001` |

Counter management rules:

- Single global counter for all test cases (not per requirement or type)
- IDs are permanent once assigned — never reused even if test is removed
- Gaps in sequence are acceptable — do not renumber to fill gaps
- When appending, continue from the highest existing number
- Maximum 999 test cases per project (TC-001 through TC-999)

### Required Field: requirementId

Every test case object in `state.json` must include the `requirementId` field
pointing to exactly one `REQ-*` ID. This field is the forward-link that the
traceability matrix reads to compute coverage scores.

```json
{
  "id": "TC-001",
  "requirementId": "REQ-FUNC-001",
  "title": "Search returns ranked results within 2 seconds",
  "type": "performance",
  "precondition": "FBR officer is authenticated; index contains at least 1,000 documents.",
  "steps": [
    "Submit POST /api/v1/search with Urdu query string",
    "Record time from request sent to first byte received"
  ],
  "expectedResult": "HTTP 200 with at least 1 result; response time ≤ 2000 ms at p95.",
  "priority": "must"
}
```

One test case covers one requirement. If a single scenario verifies two
requirements, split it into two test cases with separate `TC-*` IDs — one per
`requirementId`.

### Requirement-Side Back-Link

When a `TC-*` ID is created, also add it to the corresponding requirement's
`traceForward.testCaseIds` array in `state.json`:

```json
"traceForward": {
  "designComponentIds": ["DC-001"],
  "testCaseIds": ["TC-001"],
  "costLineItemIds": []
}
```

Both sides must be written in the same operation. A test case that exists in the
`testCases` array but is not listed in `traceForward.testCaseIds` is an orphan
and will not contribute to the coverage score.

---

## 3. Test Type Classification

Every test case must declare a `type` field using one of the six values below.
Choose the **lowest level** that fully validates the requirement.

### 3.1 Test Type Decision Tree

```
Is this testing a single function/method in isolation?
  YES → unit
  NO  ↓

Is this testing interaction between 2-3 components?
  YES → integration
  NO  ↓

Is this testing the complete system end-to-end?
  YES → system
  NO  ↓

Is this testing from the user's perspective with real scenarios?
  YES → uat
  NO  ↓

Is this testing speed, throughput, or load handling?
  YES → performance
  NO  ↓

Is this testing security controls, encryption, or access restrictions?
  YES → security
```

### 3.2 Test Type Definitions

| Type | Value | One-sentence description | Typical Steps |
| --- | --- | --- | --- |
| Unit | `unit` | Verifies a single function or method in isolation. | 1–3 |
| Integration | `integration` | Verifies 2–3 components working together. | 3–5 |
| System | `system` | Verifies a complete end-to-end flow. | 5–10 |
| UAT | `uat` | Verifies the system satisfies client acceptance criteria with representative users. | 8–15 |
| Performance | `performance` | Verifies the system meets SLA thresholds under specified load. | 3–7 |
| Security | `security` | Verifies access control, encryption, and compliance controls function and cannot be bypassed. | 3–6 |

### 3.3 Type-to-Requirement Mapping

Choose the test type based on the requirement it covers:

- `REQ-FUNC-*` → `unit`, `integration`, `system`, or `uat`
- `REQ-NFUNC-*` with category `performance` or `scalability` → `performance`
- `REQ-NFUNC-*` with category `security` or `compliance` → `security`
- `REQ-CON-*` → `unit` or `integration` (constraints are verified through behaviour)

A single requirement may have test cases of multiple types. Each test case
carries exactly one `type` value — do not combine types in one entry.

### 3.4 Test Type Distribution Guidelines

For a typical project with N requirements:

- `unit`: 40–50% of test cases
- `integration`: 25–30% of test cases
- `system`: 15–20% of test cases
- `uat`: 10–15% of test cases
- `performance`: 5–10% of test cases
- `security`: 5–10% of test cases

---

## 4. Traceability Rule

**A test case with no `requirementId` is invalid and will be flagged by the
`traceability-guard.js` hook.**

The `traceability-guard.js` hook fires after every `Write` and `Edit` tool call
on STS artifact files (`.sdlc/artifacts/sts-*`). It scans every H2 and H3
section heading in the file and checks whether the section body contains at
least one `REQ-(FUNC|NFUNC|CON)-[0-9]{3}` pattern. Any section with no `REQ-*`
reference triggers this warning:

```text
[TRACEABILITY] Section '<heading>' in '<file>' has no REQ-* reference — traceability gap
```

This warning does not block the write (exit code 0), but it will appear as a
coverage gap in the `/traceability` output and may block the phase gate from
advancing from Test Planning to Estimation for `must`-priority requirements.

### What this means for the BA agent

When generating STS content:

1. Every test case section must include the `requirementId` value inline so the
   hook's pattern scanner detects the `REQ-*` reference in the section body.
2. Do not group test cases under a heading that contains no requirement reference.
3. If a section introduces context (e.g., a test environment description) with
   no requirement reference, add a note listing the requirements the section supports.

### Coverage Impact

The `/traceability` command computes a `coverageScore` for each requirement:

```text
coverageScore = Math.round((filledCategories / 3) * 100)
```

A `testCaseIds` array that remains empty after STS is complete scores 0 for the
test category, reducing the requirement's coverage score from 100 to 67 at best.
For `must` requirements, an empty `testCaseIds` array blocks the
Test Planning → Estimation phase gate entirely.

---

## 5. Test Case Schema Fields

The following fields are required on every test case object written to
`state.json`. These field names are the canonical names used by the
traceability matrix and the `/traceability` command.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Unique ID: `TC-NNN` (zero-padded, sequential) |
| `requirementId` | string | Yes | Exactly one `REQ-FUNC-*`, `REQ-NFUNC-*`, or `REQ-CON-*` ID |
| `title` | string | Yes | Short description of what the test verifies (max 120 characters) |
| `type` | enum | Yes | `unit` \| `integration` \| `system` \| `uat` \| `performance` \| `security` |
| `precondition` | string | Yes | State that must be true before the test executes |
| `steps` | string[] | Yes | Ordered list of actions to perform |
| `expectedResult` | string | Yes | Binary pass/fail condition derived from acceptance criteria |
| `priority` | enum | Yes | `must` \| `should` \| `could` — mirrors the linked requirement's priority |
| `status` | enum | Yes | `draft` \| `reviewed` \| `approved` \| `executed` \| `passed` \| `failed` |

Do not invent field names. The traceability matrix reads `requirementId`
specifically. A field named `linkedRequirements`, `reqId`, or `requirement` will
not be recognised and the test case will appear as an orphan.

---

## 6. Minimum Test Case Count by MoSCoW Priority

The number of test cases required per requirement is determined by its MoSCoW
priority. Never generate fewer test cases than this table specifies.

| Priority | Minimum test cases | Required coverage |
| --- | --- | --- |
| `must` | 3 | Positive + Negative + Edge/Boundary case |
| `should` | 2 | Positive + Negative |
| `could` | 1 | Positive case only |
| `wont` | 0 | Explicitly out of scope — no test cases generated |

### One Test Case Per Acceptance Criterion

The mapping rule is: **one test case per acceptance criterion**. If
`REQ-FUNC-005` has 3 acceptance criteria, generate 3 test cases —
`TC-010`, `TC-011`, `TC-012` — each with `requirementId: "REQ-FUNC-005"` and
`expectedResult` derived from one criterion.

Do not merge multiple acceptance criteria into one test case. A test case that
checks two conditions simultaneously cannot be classified as binary pass/fail —
if one condition fails and the other passes, the result is ambiguous.

### Test Case Patterns Per Requirement Type

#### Functional Requirements (REQ-FUNC-*)

Generate at least 3 test cases:

1. **Positive case** — valid input, expected success
2. **Negative case** — invalid input, expected error handling
3. **Edge/Boundary case** — boundary conditions, max/min values

#### Non-Functional Requirements (REQ-NFUNC-*)

Generate at least 2 test cases:

1. **Performance/security test** — measure against SLA or verify control
2. **Stress/boundary test** — validate behaviour at the limit

#### Constraints (REQ-CON-*)

Generate at least 1 test case:

1. **Validation test** — confirm the constraint is enforced

---

## 7. Deriving Test Cases from Acceptance Criteria — Given-When-Then

All test case steps MUST follow the Given-When-Then pattern.

### 7.1 The Pattern

```
GIVEN [precondition] — the state before the test
WHEN  [action]       — what the user/system does
THEN  [result]       — what should happen (binary pass/fail)
```

### 7.2 Step-by-Step Process

**Step 1 — Read the acceptance criterion**

```text
"Given an authenticated FBR officer, when they submit a search query in Urdu
or English, then the system returns ranked results within 2 seconds at p95."
```

**Step 2 — Extract Given / When / Then**

| Part | Extracted value |
| --- | --- |
| Given (precondition) | FBR officer is authenticated; index contains ≥ 1,000 documents |
| When (steps) | Submit POST /api/v1/search with a query string in Urdu or English |
| Then (expected result) | HTTP 200 with ≥ 1 ranked result; response time ≤ 2000 ms at p95 |

**Step 3 — Assign a test type**

The criterion measures response time under load → `type: "performance"`.

**Step 4 — Write the test case object**

```json
{
  "id": "TC-001",
  "requirementId": "REQ-FUNC-001",
  "title": "Search returns ranked results within 2 seconds at p95",
  "type": "performance",
  "precondition": "FBR officer is authenticated; index contains at least 1,000 documents.",
  "steps": [
    "Submit POST /api/v1/search with Urdu query string 'ٹیکس ریٹرن'",
    "Record elapsed time from request sent to first byte received"
  ],
  "expectedResult": "HTTP 200 with at least 1 ranked result; response time ≤ 2000 ms at p95.",
  "priority": "must",
  "status": "draft"
}
```

**Step 5 — Update both sides of the traceability link**

```json
// In state.json requirements array — add TC-001 to testCaseIds
"traceForward": {
  "designComponentIds": ["DC-001"],
  "testCaseIds": ["TC-001"],
  "costLineItemIds": []
}

// In state.json testCases array — add the new object
```

Both writes happen in the same operation. Never write one without the other.

### 7.3 Pakistani Banking Example (KYC Verification)

```json
{
  "id": "TC-010",
  "requirementId": "REQ-FUNC-005",
  "title": "Verify successful KYC verification for valid CNIC",
  "type": "system",
  "precondition": "Bank officer is authenticated with role 'KYC_OFFICER'; test CNIC 12345-6789012-3 exists in test database.",
  "steps": [
    "Navigate to KYC verification screen",
    "Enter CNIC: 12345-6789012-3",
    "Click 'Verify' button"
  ],
  "expectedResult": "System displays 'Verified' status within 5 seconds and logs the verification event to SBP audit trail with officer ID and timestamp.",
  "priority": "must",
  "status": "draft"
}
```

### 7.4 Pakistani Government Example (PPRA Tender)

```json
{
  "id": "TC-011",
  "requirementId": "REQ-CON-002",
  "title": "Tender submission portal locks after deadline",
  "type": "system",
  "precondition": "Tender TDR-2026-001 exists with deadline 2026-04-15 17:00 PKT; current system time is 2026-04-15 17:01 PKT.",
  "steps": [
    "Attempt to access tender submission form for TDR-2026-001",
    "Attempt to submit a bid document"
  ],
  "expectedResult": "System displays 'Submission period closed' message and prevents any bid submission. System generates PPRA-compliant deadline closure log entry with tamper-evident SHA-256 hash.",
  "priority": "must",
  "status": "draft"
}
```

### 7.5 Step Granularity

Steps should be at the user-action level, not code-level:

| Too granular (code-level) | Correct (user-action level) |
| --- | --- |
| "Call `authenticate()` method" | "Enter username and password and click Login" |
| "Query database for user record" | "Click 'Search' button" |
| "Return HTTP 200 status" | "System displays success message" |

---

## 8. Test Data Specification

The `testData` field describes what data the test needs. Be specific enough
that a QA engineer can prepare the data without asking questions.

| Vague (bad) | Specific (good) |
| --- | --- |
| "Valid user credentials" | `Username: test.officer@hbl.com, Password: Test@1234, Role: KYC_OFFICER` |
| "Test CNIC" | `CNIC: 12345-6789012-3, Status: Active, Bank: HBL` |
| "Sample transaction" | `PKR 50,000, From: 03001234567, To: 03009876543, Type: Bill Payment` |
| "Database records" | `10 active users, 50 pending transactions, 5 locked accounts` |

---

## 9. Compliance-Driven Test Cases

Requirements tagged with a `complianceFrameworks` value always require at least
one `security` test case in addition to their functional test cases.

| Framework | Required security test focus |
| --- | --- |
| `SBP-2024` | Encryption at rest, MFA enforcement, audit log completeness |
| `PPRA-2024` | Access control on procurement records, role separation |
| `GDPR` | Data subject erasure, consent withdrawal, data export |
| `ISO-27001` | Access control matrix, session timeout, privilege escalation prevention |
| `PCI-DSS` | Cardholder data masking, PAN storage prohibition, transaction logging |
| `SAMA-2024` | MFA for admin access, data residency verification |
| `CBUAE` | Audit log retention, data localisation |
| `AAOIFI` | Shariah compliance audit trail |

### How to generate a compliance-driven test case

1. Read `requirement.complianceFrameworks` — note all framework codes.
2. For each framework, look up the required security test focus in the table above.
3. Create one `security` test case per framework control relevant to the requirement.
4. Set `expectedResult` to the specific control outcome.

```json
{
  "id": "TC-003",
  "requirementId": "REQ-FUNC-005",
  "title": "Customer PII is encrypted at rest per SBP-SEC-001",
  "type": "security",
  "precondition": "Database contains at least one customer record with PII fields populated.",
  "steps": [
    "Query the database storage layer directly without application decryption",
    "Inspect raw bytes of PII columns"
  ],
  "expectedResult": "Raw PII bytes are unreadable ciphertext; AES-256 algorithm confirmed via key management documentation.",
  "priority": "must",
  "status": "draft"
}
```

---

## 10. Implicit Test Cases — Always Generate These

When you see certain requirements, always generate these companion test cases:

### Authentication mentioned

- Valid credentials → successful login
- Invalid password → error message, account not locked
- Account lockout after N failed attempts → locked, admin notified
- Session timeout after inactivity → redirect to login
- Password reset flow end-to-end

### Authorization / Roles mentioned

- User with permission → access granted
- User without permission → access denied (HTTP 403)
- Role escalation attempt → blocked and logged

### API mentioned

- Valid request → HTTP 200 OK
- Invalid request → HTTP 400 Bad Request
- Unauthorized request → HTTP 401 Unauthorized
- Rate limit exceeded → HTTP 429 Too Many Requests
- Server error handling → HTTP 500 Internal Server Error

### Database operations mentioned

- Create record → record persisted and retrievable
- Read record → correct data returned
- Update record → changes saved, prior value gone
- Delete record → record removed, referential integrity maintained
- Concurrent updates → last-write-wins or conflict detected

### Payment / Transaction mentioned

- Successful transaction → funds transferred, receipt generated
- Insufficient funds → transaction rejected, balance unchanged
- Network failure mid-transaction → rollback, no partial state
- Duplicate transaction prevention → idempotency verified

### Reporting mentioned

- Generate report → correct data, correct format
- Export to PDF → PDF downloads
- Export to Excel → Excel file downloads
- Empty dataset → "No data" message displayed
- Large dataset (1,000+ records) → completes within SLA

---

## 11. Negative and Boundary Test Cases

For every positive test case on a `must` requirement, generate at least one
negative and one boundary variant.

### Negative Test Cases

Verify the system correctly rejects invalid input or unauthorised access.

```json
{
  "id": "TC-002",
  "requirementId": "REQ-FUNC-001",
  "title": "Search rejects unauthenticated requests",
  "type": "security",
  "precondition": "No valid session token is present in the request.",
  "steps": [
    "Submit POST /api/v1/search without an Authorization header"
  ],
  "expectedResult": "HTTP 401 Unauthorized; no search results returned.",
  "priority": "must",
  "status": "draft"
}
```

### Boundary Test Cases

Verify behaviour at the exact limits of an SLA or constraint.

| Boundary type | Example |
| --- | --- |
| At threshold | Query returns results in exactly 2000 ms |
| Just over threshold | Query under load produces a 2001 ms response |
| Empty input | Submit a blank query string |
| Maximum input | Submit a query string at the character limit |

### Common negative variations by input type

| Positive case | Negative cases to generate |
| --- | --- |
| Login with valid credentials | Invalid password, locked account, expired account, wrong CNIC format |
| Search with valid query | Empty query, special characters, SQL injection attempt, excessively long query |
| File upload | File too large, unsupported format, empty file |
| Date range | End before start, future date when not allowed, invalid format |
| Numeric input | Negative when not allowed, zero when not allowed, exceeds maximum, non-numeric |

---

## 12. Test Case Status Lifecycle

Test cases move through a defined status lifecycle. Status may only advance
forward — never backward.

```
draft → reviewed → approved → executed → passed | failed
```

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `draft` | Generated by the BA agent; not yet peer-reviewed | BA agent during `/sts` |
| `reviewed` | Checked by a human reviewer for accuracy and coverage | Project reviewer |
| `approved` | Signed off; included in the final STS document | Project lead |
| `executed` | Run against the actual system | Development team |
| `passed` | All steps completed; expected result observed | Development team |
| `failed` | At least one step did not produce the expected result | Development team |

The `/sts` command generates all test cases at `status: "draft"`.
A `failed` test case is never reset to `draft` — create a new test case with
a new `TC-*` ID to capture the retest.

---

## 13. state.json Update Checklist

Use this checklist every time a test case is created or modified during `/sts`.
Complete all steps in a single Write operation — partial updates create
inconsistent state.

```text
[ ] 1.  Assign the next sequential TC-NNN ID (check highest existing ID first)
[ ] 2.  Set requirementId to exactly one REQ-* ID
[ ] 3.  Set type to one of: unit | integration | system | uat | performance | security
[ ] 4.  Set status to "draft"
[ ] 5.  Write the complete test case object to state.json testCases array
[ ] 6.  Add the TC-* ID to requirement.traceForward.testCaseIds in state.json
[ ] 7.  Verify the REQ-* ID in requirementId matches the requirement being traced
[ ] 8.  Verify the TC-* ID appears in the STS document body so traceability-guard.js detects it
[ ] 9.  Update state.json traceabilityMatrix entry for the requirement
[ ] 10. If requirement.priority is "must", verify testCaseIds now contains ≥ 3 entries
```

Skipping step 6 is the most common cause of orphaned test cases. Skipping
step 8 is the most common cause of traceability-guard.js warnings on STS files.

---

## 14. Coverage Gaps — Flag Untested Requirements

After generating all test cases, scan `state.json.requirements[]` and identify
any requirement with zero test cases.

For each gap, either:

1. Generate a test case for it, OR
2. Document in `coverageGapsParagraphs` why it cannot be tested

Reasons a requirement might be untestable:

- Deferred to a later phase (`priority: "wont"`)
- Superseded by another requirement
- Constraint verified by infrastructure team, not via test case
- Third-party component with vendor certification

---

## 15. Common Mistakes

| Mistake | Effect | Fix |
| --- | --- | --- |
| `id: "TC-1"` | Fails schema validation and pattern matching | Zero-pad to `TC-001` |
| Using `linkedRequirements` instead of `requirementId` | Test case invisible to traceability matrix; coverage stays at 0 | Rename to `requirementId` |
| Using `testCaseId` instead of `id` | Field not read by traceability matrix | Rename to `id` |
| Creating TC without updating `traceForward.testCaseIds` | Coverage score stays at 0; phase gate blocks | Always write both sides in one operation |
| Merging two acceptance criteria into one test case | Non-binary pass/fail; ambiguous results | Split into separate TCs with distinct `expectedResult` |
| `type: "functional"` for a performance criterion | SLA not enforced by performance test tools | Use `type: "performance"` when criterion contains an SLA metric |
| Only positive test cases for `must` requirements | No robustness or security coverage | Add negative + boundary test cases |
| Generating test cases for `wont` requirements | Wasted effort; out of scope | Skip `wont` requirements; document exclusion in test scope |
| Setting `priority` on TC differently from linked requirement | Inconsistent coverage scoring | Mirror the linked requirement's MoSCoW priority exactly |
| Reusing a retired TC-* ID for a retest | ID collision; history of original test is lost | Create a new TC with the next sequential ID for every retest |
| Writing STS sections with no inline REQ-* ID | traceability-guard.js emits a warning for every affected section | Include the `requirementId` value inline in every section body |

---

## 16. What the BA Agent Must Never Do

- Generate a test case without a `requirementId` field
- Use `linkedRequirements` or any non-standard field name for the requirement link
- Use `testCaseId` instead of `id`
- Assign a `TC-*` ID that has already been used — IDs are permanent
- Write a test case to `state.json` without also updating `traceForward.testCaseIds`
- Merge two acceptance criteria into a single test case
- Generate test cases for `wont`-priority requirements
- Set `status` to anything other than `draft` when first creating a test case
- Write a `must` requirement's test cases without including at least one negative test case
- Create a compliance-tagged requirement with only `functional` test cases — at least one `security` test case is always required
- Advance the `testCaseIds` count to the minimum without verifying each TC has a distinct `expectedResult` derived from a distinct acceptance criterion

---

## 17. Output Format

The BA agent MUST output test cases as a JSON array with this exact structure:

```json
{
  "testCases": [
    {
      "id": "TC-001",
      "requirementId": "REQ-FUNC-001",
      "title": "Verify user authentication with valid CNIC and password",
      "type": "integration",
      "precondition": "User account with CNIC 12345-6789012-3 exists and is active; database is accessible.",
      "steps": [
        "Navigate to login page",
        "Enter CNIC: 12345-6789012-3",
        "Enter password: Test@1234",
        "Click 'Login' button"
      ],
      "testData": "CNIC: 12345-6789012-3, Password: Test@1234",
      "expectedResult": "User successfully authenticated and redirected to dashboard within 3 seconds.",
      "priority": "must",
      "status": "draft"
    }
  ]
}
```

No markdown wrappers. No prose. No explanations. Just the JSON array.
