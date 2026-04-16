---
name: sdlc-requirements
description: >
  IEEE 830 requirements engineering methodology for ECC-SDLC. Load this skill
  when extracting, writing, or validating requirements. Covers REQ-FUNC/NFUNC/CON
  format, MoSCoW prioritization, acceptance criteria rules, compliance tagging,
  and SRS structure. Used by business-analyst agent during /scope and /srs.
---

# SDLC Requirements Skill

## Purpose

This skill defines the IEEE 830 requirements engineering methodology used by
the Business Analyst agent during `/scope` and `/srs` commands. It covers
requirement classification, ID format rules, MoSCoW prioritization, acceptance
criteria standards, compliance tagging, and source attribution.

Every requirement produced by the BA agent must conform to the rules in this
skill and in `rules/sdlc/requirements.md`. State.json is the output destination
— the scope document and SRS are human-readable views generated from state.json.

---

## 1. IEEE 830 Overview

IEEE 830 is the international standard for Software Requirements Specifications.
Its core principle: a requirement must be verifiable. If you cannot write a test
for it, it is not a requirement — it is a wish.

Every requirement must answer three questions:

- What shall the system do? (functional)
- How well shall it do it? (non-functional)
- Within what boundaries must it operate? (constraint)

---

## 2. Requirement Classification

### 2.1 Functional Requirements — REQ-FUNC-NNN

Describe what the system DOES — actions, behaviors, outputs.

Decision test: Can you draw a flowchart of this? If yes, it is functional.

Examples:

- The system shall authenticate users via CNIC and password
- The system shall generate a monthly usage report per bank
- The system shall send an SMS notification when a bill is generated

### 2.2 Non-Functional Requirements — REQ-NFUNC-NNN

Describe HOW WELL the system does it — quality attributes.

Decision test: Is this about speed, security, availability, or usability?
If yes, it is non-functional.

| Category | Question to ask | Example |
| --- | --- | --- |
| `performance` | How fast? How many? | Response under 2 seconds at p95 |
| `security` | How secure? What encryption? | AES-256 at rest, TLS 1.2 in transit |
| `scalability` | How many concurrent users? | 10,000 concurrent requests |
| `availability` | What uptime? What failover? | 99.9% uptime SLA |
| `usability` | What languages? What accessibility? | Urdu + English, WCAG 2.1 AA |
| `compliance` | What regulations? | SBP audit log 7-year retention |

Category is required and must be non-null for all non-functional requirements.

### 2.3 Constraints — REQ-CON-NNN

Describe BOUNDARIES the system must operate within — non-negotiable limits.

Decision test: Is this a restriction imposed from outside? If yes, it is
a constraint.

Examples:

- Budget: PKR 75 million maximum
- Timeline: 8 months delivery
- Hosting: On-premise NADRA servers only, no cloud
- Technology: Must use existing NADRA API

---

## 3. Requirement ID Format

Every requirement MUST use one of these three ID formats:

| Type | Format | Example | Counter |
| --- | --- | --- | --- |
| Functional | `REQ-FUNC-NNN` | `REQ-FUNC-001` | Independent |
| Non-Functional | `REQ-NFUNC-NNN` | `REQ-NFUNC-001` | Independent |
| Constraint | `REQ-CON-NNN` | `REQ-CON-001` | Independent |

Counter management rules:

- NNN is a zero-padded 3-digit integer starting at 001
- Each type (FUNC, NFUNC, CON) has its own independent counter
- REQ-FUNC-001 and REQ-NFUNC-001 are different requirements
- IDs are permanent once assigned — never reused even if rejected
- Gaps in sequence are acceptable — do not renumber to fill gaps
- When appending, continue from the highest existing number per type

---

## 4. MoSCoW Prioritization

Every requirement MUST have a priority. No requirement may have a null or
missing priority field.

| Priority | Value | Definition | Apply when |
| --- | --- | --- | --- |
| Must | `must` | Non-negotiable. System fails without this. | Client confirmed mandatory |
| Should | `should` | High value. Include unless strong reason to defer. | Expected but workaround exists |
| Could | `could` | Nice to have. Include only if time and budget allow. | Mentioned as desirable |
| Won't | `wont` | Explicitly out of scope for this version. | Deferred to phase 2 |

Decision rules:

- If priority is unclear, default to `should` and add an assumption
- Never assign `must` to a requirement the client has not confirmed
- At least 60% of functional requirements must be `must` or `should`
- Non-functional requirements default to `must` for banking/government
- Every `wont` requirement MUST include a `deferralReason` field

Concrete examples:

- `must` — User authentication — system cannot launch without login
- `should` — Report scheduling — manual export is a workaround
- `could` — Analytics dashboard — nice to have, not expected
- `wont` — Biometric verification — deferred to Phase 2

---

## 5. Requirement Writing Style

All requirement descriptions MUST follow this convention:

Format: `"The system shall [action] [object] [condition]"`

Never use: passive voice, "must", "will", or "should be able to".

| Word | IEEE 830 Meaning |
| --- | --- |
| `shall` | Mandatory — use this always |
| `should` | Recommendation — never use in descriptions |
| `may` | Optional — never use in descriptions |
| `will` | Statement of fact — not a requirement |
| `must` | Ambiguous — forbidden |

Examples:

| Wrong | Correct |
| --- | --- |
| "The system should handle login." | "The system shall authenticate users via CNIC." |
| "Reports must load quickly." | "The system shall render reports in under 3 seconds at p95." |
| "Data must be secure." | "The system shall encrypt PII at rest using AES-256." |
| "The API should be RESTful." | "The system shall expose a REST API per OpenAPI 3.0." |

---

## 6. Acceptance Criteria Rules

Acceptance criteria are the contract between client and development team.
Every criterion must be testable, specific, and binary.

Minimum count:

- `must` requirements: minimum 2 acceptance criteria
- `should` requirements: minimum 1 acceptance criterion
- `could` requirements: minimum 1 acceptance criterion
- `wont` requirements: no acceptance criteria needed

### 6.1 The Given-When-Then Pattern

```text
Given [precondition]
When [action]
Then [expected outcome]
```

Pakistani banking example:

```text
Given a bank officer is authenticated and their bank is active
When they submit a valid 13-digit CNIC number for KYC verification
Then the system shall return a verified/not-verified status within
     5 seconds and log the request to the SBP audit trail
```

Pakistani government example:

```text
Given a procurement officer has uploaded a complete tender document
When the tender submission deadline passes
Then the system shall lock the submission portal and generate a
     PPRA-compliant bid receipt with a tamper-evident hash
```

### 6.2 Banned Phrases

These 5 phrases are forbidden in acceptance criteria. Each must be rewritten
with a specific, measurable alternative.

#### "should be able to"

- Wrong: "Users should be able to log in quickly."
- Correct: "The system shall authenticate a user within 3 seconds of
  submitting valid credentials."

#### "as fast as possible"

- Wrong: "The system shall process payments as fast as possible."
- Correct: "The system shall process payment transactions within 10 seconds
  at p95 under normal load."

#### "easy to use"

- Wrong: "The interface shall be easy to use."
- Correct: "A new bank officer shall complete their first CNIC verification
  in under 3 minutes without training."

#### "industry standard"

- Wrong: "The system shall use industry standard encryption."
- Correct: "The system shall encrypt all data at rest using AES-256 and
  in transit using TLS 1.2 or higher."

#### "appropriate"

- Wrong: "The system shall display appropriate error messages."
- Correct: "The system shall display an error message specifying the failure
  reason within 2 seconds when a transaction fails."

---

## 7. Source Attribution

Every requirement MUST trace back to a source. The `source` field must be
specific enough that another analyst can locate the original text.

Acceptable formats:

- `"RFP Section 3.2.1, Page 12"` — document reference
- `"Stakeholder: Ahmed Khan, Meeting 2026-03-15"` — stakeholder attribution
- `"SBP IT Governance Framework, Control SBP-SEC-001"` — regulatory origin
- `"Implicit: industry standard for banking systems"` — inferred requirement

Requirements with `source` starting with `"Implicit"` must be marked
`status: "draft"` and flagged for client validation before advancing to
`"validated"` or `"approved"`.

---

## 8. Status Lifecycle

Requirements move through a defined status lifecycle. Status may only advance
forward — it cannot go backward.

```text
draft → validated → approved
             ↓
          deferred  (can re-enter as draft in next version)
             ↓
          rejected  (permanent — ID is retired, never reused)
```

- `draft` — extracted but not yet reviewed by client
- `validated` — client confirmed the requirement is correct
- `approved` — formally approved, included in the final SRS .docx
- `deferred` — postponed to a future version, must include `deferralReason`
- `rejected` — removed permanently, ID is retired

Only `approved` requirements are included in the final SRS .docx.

---

## 9. Compliance Tagging

Scan all input for these keywords and tag requirements immediately.

| Keywords | Framework | Severity |
| --- | --- | --- |
| State Bank, SBP, BPRD, KYC, AML, audit log, PII | `SBP-2024` | critical |
| PPRA, tender, bid, public procurement | `PPRA-2024` | high |
| GDPR, personal data, EU, data subject | `GDPR` | high |
| ISO 27001, ISMS, information security | `ISO-27001` | high |
| PCI, cardholder, payment card, PAN, CVV | `PCI-DSS` | critical |
| SAMA, Saudi Arabian Monetary | `SAMA-2024` | critical |
| CBUAE, UAE central bank | `CBUAE` | critical |
| AAOIFI, Islamic finance, Shariah, murabaha | `AAOIFI` | high |

When a keyword is detected:

1. Add the framework code to `complianceFrameworks` array on the requirement
2. Add a compliance flag entry to `complianceFlags` array in state.json
3. Under-tagging is worse than over-tagging — when in doubt, tag it

---

## 10. Implicit Requirements Checklist

Never extract only what is explicitly stated. Always expand these patterns:

Authentication mentioned:

- REQ-FUNC: User login with credentials
- REQ-FUNC: Account lockout after N failed attempts
- REQ-FUNC: Password reset flow
- REQ-NFUNC: Session timeout after inactivity
- REQ-CON: Password complexity policy

User roles/permissions mentioned:

- REQ-FUNC: Role-based access control (RBAC)
- REQ-FUNC: Audit log of all access events
- REQ-FUNC: Privilege escalation prevention
- REQ-CON: Minimum role separation

Reporting mentioned:

- REQ-FUNC: Report generation
- REQ-FUNC: Report export (PDF/Excel)
- REQ-FUNC: Report scheduling
- REQ-NFUNC: Report generation time limit

Payment/transactions mentioned:

- REQ-FUNC: Transaction logging with full audit trail
- REQ-FUNC: Payment reconciliation process
- REQ-FUNC: Transaction rollback on failure
- REQ-CON: PCI-DSS compliance flag

API/integration mentioned:

- REQ-FUNC: API authentication
- REQ-FUNC: Error handling and retry logic
- REQ-NFUNC: API response time SLA
- REQ-NFUNC: Rate limiting

Data storage mentioned:

- REQ-NFUNC: Data retention period
- REQ-CON: Data residency
- REQ-CON: Encryption at rest standard

---

## 11. traceForward — Pipeline Dependency

Every requirement in state.json must include a `traceForward` object:

```json
{
  "traceForward": {
    "designComponentIds": [],
    "testCaseIds": [],
    "costLineItemIds": []
  }
}
```

What each array is for:

- `designComponentIds` — populated by solution-architect agent during /sds.
  Uses DC-NNN format.
- `testCaseIds` — populated by technical-writer agent during /sts.
- `costLineItemIds` — populated by estimator agent during /estimate.

Always initialize with empty arrays at extraction time. Never omit this object.
Leaving it out breaks the traceability-guard hook and every downstream agent.

---

## 12. Atomicity Rule

Each requirement must describe ONE action, behavior, or constraint.

Test: Can you write a single test case that fully verifies this requirement?
If no — split it.

Bad example:

```text
"The system shall authenticate users via CNIC and send an email on failed
login and lock the account after 5 attempts."
```

Good example:

```text
REQ-FUNC-010: "The system shall authenticate users via CNIC and password."
REQ-FUNC-011: "The system shall send an email after each failed login."
REQ-FUNC-012: "The system shall lock an account after 5 failed attempts."
```

---

## 13. Conflict Resolution

When two requirements contradict each other:

1. Assign permanent REQ-* IDs to both immediately
2. Document both with their sources
3. Mark both `status: "draft"`
4. Add an Open Question referencing both REQ-* IDs
5. Note which stakeholder owns each requirement
6. Create a TodoWrite to resolve the conflict with the client
7. Never pick one and discard the other — that is the client's decision

---

## 14. Common Mistakes

| Mistake | Fix |
| --- | --- |
| "The system must allow login" | "The system shall authenticate users via CNIC" |
| "System should be fast" | "The system shall respond within 3 seconds at p95" |
| One requirement covering multiple features | Split into one requirement per feature |
| Acceptance criteria with "user-friendly" | Define a specific usability benchmark |
| Missing source attribution | Add stakeholder name and meeting date |
| REQ-FUNC for a constraint | Reclassify as REQ-CON |
| No traceForward object | Always initialize with empty arrays |
| Requirements only in the document | Always write to state.json first |
| Picking one conflicting requirement | Assign IDs to both, mark draft, raise question |
| Missing compliance tag | Scan all input for framework keywords |
