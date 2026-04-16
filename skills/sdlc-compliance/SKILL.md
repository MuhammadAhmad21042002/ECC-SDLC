---
name: sdlc-compliance
description: >
  Regulatory compliance assessment methodology for ECC-SDLC. Load this skill
  when running the compliance-checker agent during /srs (Step 4 — flag
  requirement intersections) or the standalone /compliance command (full gap
  analysis). Covers the 7-step compliance assessment flow, severity
  classification, keyword matching rules, false positive prevention, and
  output contract. Used exclusively by the compliance-checker agent.
---

# SDLC Compliance Skill

## Purpose

This skill defines the regulatory compliance assessment methodology used by
the Compliance Checker agent during `/srs` Step 4 and the standalone
`/compliance` command.

It provides:

- The 7-step compliance assessment flow (Section 9.2 of the Technical Proposal)
- Severity level definitions with impact-based descriptions
- Gap classification rules
- Keyword matching methodology and false-positive prevention
- Status values, output contract, and self-check rules

Every compliance output must conform to the rules in this skill. The output
feeds into `state.json complianceFlags[]` and the `/compliance` client report.

---

## When This Skill Is Active

Load this skill when invoked by:

- **`/srs` Step 4** — scan `requirements[]` from `state.json` against all
  framework keyword lists. Return `complianceFlags[]` and
  `requirementUpdates[]`. All flags carry `status: "pending-review"` because
  no SDS exists yet to check evidence against.
- **`/compliance` command** — run the full 7-step assessment. Scan
  requirements AND design components. Check evidence against SRS/SDS content.
  Produce `complianceMatrix[]`, `gapAnalysis`, `criticalGaps[]`, and
  `summary`.

---

## 7-Step Compliance Assessment Flow

This flow mirrors Section 9.2 of the ECC-SDLC Technical Proposal.
Run these steps in order during every `/compliance` invocation.

### Step 1 — Tokenise content

Concatenate the text fields of each artifact:

- Requirements: `title + description + acceptanceCriteria.join(" ")`
- Design components: `title + description + responsibilities.join(" ")`

### Step 2 — Scan against framework keyword lists

For each framework file in `frameworks/*.json`, scan every tokenised artifact
string against the `keywords[]` array of every control. Use case-insensitive
substring search. A keyword matches if it appears anywhere in the target text.

### Step 3 — Identify matching controls

For each keyword match, record:

- The framework code and control ID that was triggered
- The artifact ID (`REQ-*` or `DC-*`)
- The exact keyword that matched
- The severity from the framework definition

### Step 4 — Check for required evidence fields in SDS/SRS

For each triggered control, check `requiredEvidence[]` against:

- `.sdlc/artifacts/srs-vN.docx` — use the Read tool
- `.sdlc/artifacts/sds-vN.docx` — use the Read tool if it exists
- `state.json requirements[]` field values directly

Match by finding substantive content in the named section, not just its heading.

### Step 5 — Classify gaps

A **gap** exists when a regulatory control's keywords appear in requirements
or design artifacts but the control's required evidence fields are absent from
the SDS or SRS.

For each control populate:

- `evidenceFound[]` — specific text or component found
- `gaps[]` — exactly what is missing, with enough detail to write a fix
- `status` — `compliant`, `partial`, `non-compliant`, or `not-applicable`

### Step 6 — Score severity

Severity is read directly from the framework definition — never override or
reclassify it. See the Severity Definitions section below.

### Step 7 — Generate remediation suggestions

For every gap, produce a specific and actionable remediation suggestion per
the Remediation Suggestions section below.

Output: compliance matrix mapping controls to requirements to evidence to
status, as specified in the Output Contract section.

---

## Severity Definitions

Severity is set by the framework file and must never be changed by the agent.

**critical** — Hard regulatory requirement. Non-compliance blocks phase
gate approval and creates risk of regulatory penalty or legal violation.
Resolve before advancing to the next pipeline phase.

**high** — Significant regulatory obligation. Non-compliance creates
material contractual risk and may disqualify the vendor during procurement
evaluation. Resolve before proposal submission.

**medium** — Recommended control. Non-compliance creates operational risk
but does not block delivery. Flag for client awareness, document the gap,
and monitor. Resolve before go-live.

**low** — Best-practice recommendation. No immediate regulatory
consequence. Log and remediate opportunistically. No client escalation.

**Summary risk level** (for `/compliance` full mode):

- `critical` — any `critical`-severity gap exists
- `high` — any `high`-severity gap, no critical gaps
- `medium` — only `medium` or `low` gaps
- `low` — all controls are `compliant` or `not-applicable`

---

## Gap Classification

A **gap** is defined as:

> A regulatory control whose keywords appear in requirements or design
> artifacts but whose required evidence fields are absent from the SDS or SRS.

| Status           | Meaning                                          |
| ---------------- | ------------------------------------------------ |
| `non-compliant`  | No evidence found for any required evidence item |
| `partial`        | Some evidence found; at least one item missing   |
| `compliant`      | All required evidence items found in SRS/SDS     |
| `not-applicable` | Control does not apply to this project type      |

---

## Keyword Matching and False Positive Prevention

### Match keywords as written in the framework file

The `keywords[]` array in each framework file is authoritative. Match each
keyword as a case-insensitive substring of the tokenised artifact text.

```text
keyword:   "encryption"
matches:   "The system shall implement data encryption using AES-256"  ✓

keyword:   "data at rest"
matches:   "The system shall encrypt data at rest using AES-256"  ✓
no match:  "The system shall store data"  ✗ — phrase not present
```

### Prefer specificity to reduce false positives

When a framework provides both single-word and multi-word keywords for the
same control, a multi-word match is stronger evidence of a true positive.

**Example 1 — SBP encryption control:**

```text
keyword "data at rest" → strong match (banking-specific phrase)
keyword "encryption"   → weaker match (may appear in non-banking requirements)
```

Both are valid matches. Report the flag. But note in `gaps[]` which keyword
triggered it so reviewers can assess context.

**Example 2 — PPRA procurement control:**

```text
keyword "competitive bidding requirement" → strong match (procurement-specific)
keyword "bidding"                        → weaker match (may appear in auction systems)
```

Both are valid. The multi-word phrase gives the compliance reviewer more
confidence the flag is a true positive.

### Do not supplement keyword lists

Never add, infer, or generalise keywords beyond what is written in the
framework file. If no keyword matches, produce zero flags — this is the
correct result for a non-applicable project.

### One flag per tuple

Do not produce duplicate flags for the same `(frameworkCode, controlId,
triggeredBy)` combination. If multiple requirements trigger the same control,
produce one flag per requirement.

---

## Framework Files

Read every file in `frameworks/*.json` before scanning. Each file follows:

```json
{
  "frameworkId": "SBP-2024",
  "frameworkName": "...",
  "controls": [
    {
      "controlId": "SBP-SEC-001",
      "title": "...",
      "keywords": ["encryption", "data at rest", "AES", "customer data"],
      "requiredEvidence": ["Encryption standard in SDS", "Key management procedure"],
      "severity": "critical"
    }
  ]
}
```

If a framework file does not exist on disk, log it in `summary` and skip it.
Never fabricate controls for a missing framework.

**Supported frameworks:**

| Code           | Domain                                          |
| -------------- | ----------------------------------------------- |
| `SBP-2024`     | Pakistani banking — SBP IT Governance Framework |
| `PPRA-2024`    | Pakistani government procurement — PPRA Rules   |
| `P3A-Act-2017` | Pakistani public-private partnerships           |
| `GDPR`         | EU data protection                              |
| `ISO-27001`    | Information security management                 |
| `PCI-DSS`      | Payment card industry                           |
| `SAMA-2024`    | Saudi Arabian banking                           |
| `CBUAE`        | UAE central bank                                |
| `AAOIFI`       | Islamic finance accounting                      |

---

## Evidence Checking

Each `requiredEvidence[]` item names a specific artifact and section.
Match it by finding substantive content there, not just the heading.

**Found (compliant):**

```text
requiredEvidence: "Encryption standard in SDS"
evidenceFound: ["AES-256 specified in securityDataProtectionParagraphs"]
gaps: []
status: compliant
```

**Missing (non-compliant):**

```text
requiredEvidence: "Key management procedure"
evidenceFound: []
gaps: ["Key management absent — no rotation schedule or HSM/KMS in SDS"]
status: non-compliant
```

---

## Status Values

| Status           | When to Use                                      |
| ---------------- | ------------------------------------------------ |
| `pending-review` | `/srs` mode only — SDS does not exist yet        |
| `compliant`      | All required evidence items found in SRS/SDS     |
| `partial`        | Some evidence found; at least one item missing   |
| `non-compliant`  | No evidence found for any required evidence item |
| `not-applicable` | Control does not apply to this project type      |

---

## Remediation Suggestions

For every gap, write a **specific and actionable** suggestion.

**Good:**

> Add a Key Management component (DC-NNN) in SDS Component Specifications
> specifying AES-256 key rotation every 90 days, keys stored in AWS KMS or
> on-premises HSM, access restricted to security-admin role. Satisfies
> SBP-SEC-001 required evidence item 2.

**Bad:**

> Document key management.

Every suggestion must name the exact section to update, specify the required
content, and reference the control ID.

---

## Output Contracts

### /srs mode

```json
{
  "mode": "requirements",
  "complianceFlags": [
    {
      "frameworkCode": "SBP-2024",
      "controlId": "SBP-SEC-001",
      "controlTitle": "Data Encryption at Rest",
      "triggeredBy": "REQ-NFUNC-003",
      "keyword": "data at rest",
      "severity": "critical",
      "requiredEvidence": ["...from framework file..."],
      "status": "pending-review",
      "detectedAt": "ISO 8601 timestamp"
    }
  ],
  "requirementUpdates": [{ "id": "REQ-NFUNC-003", "complianceFrameworks": ["SBP-2024"] }],
  "summary": {
    "totalScanned": 0,
    "flagged": 0,
    "bySeverity": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
    "byFramework": {}
  }
}
```

### /compliance mode

```json
{
  "mode": "full",
  "complianceMatrix": [
    {
      "frameworkCode": "SBP-2024",
      "controlId": "SBP-SEC-001",
      "controlTitle": "Data Encryption at Rest",
      "triggeredBy": ["REQ-NFUNC-003", "DC-004"],
      "keyword": "data at rest",
      "severity": "critical",
      "requiredEvidence": ["...from framework file..."],
      "evidenceFound": ["...what was found..."],
      "gaps": ["...what is missing..."],
      "status": "compliant | partial | non-compliant",
      "comment": "or not-applicable",
      "remediationSuggestions": ["...specific and actionable..."]
    }
  ],
  "complianceFlags": [],
  "gapAnalysis": {
    "totalControls": 0,
    "compliant": 0,
    "partial": 0,
    "nonCompliant": 0,
    "notApplicable": 0
  },
  "criticalGaps": [],
  "summary": {
    "totalScanned": 0,
    "flagged": 0,
    "frameworksCovered": [],
    "overallRiskLevel": "critical | high | medium | low",
    "recommendation": "..."
  }
}
```

---

## Self-Check Before Returning Output

- [ ] Read all `frameworks/*.json` before starting — never fabricate controls
- [ ] Match keywords as case-insensitive substrings of tokenised artifact text
- [ ] All `complianceFlags[].status` = `"pending-review"` in `/srs` mode
- [ ] All `status` values in `/compliance` mode are from the allowed set
- [ ] `requirementUpdates[]` populated for every flagged requirement (`/srs`)
- [ ] `summary.bySeverity` counts match actual flag severity distribution
- [ ] `summary.flagged` equals `complianceFlags.length`
- [ ] `gapAnalysis` counts sum to `totalControls` in `/compliance` mode
- [ ] `criticalGaps[]` only contains `severity: "critical"` entries
      with non-empty `gaps[]`
- [ ] `compliant` controls have empty `gaps[]`
- [ ] `non-compliant` controls have empty `evidenceFound[]`
- [ ] Every remediation suggestion names a specific section and required content
- [ ] No duplicate `(frameworkCode, controlId, triggeredBy)` tuples in output
