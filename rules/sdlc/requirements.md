# SDLC Requirements Rules

These rules govern every requirement produced by the Business Analyst agent and
validated by the /srs command. They are non-negotiable and enforced by AJV schema
validation before any requirement is saved to state.json.

---

## 1. Requirement ID Format

Every requirement MUST have a unique ID following this exact pattern:

| Type | Format | Example |
|---|---|---|
| Functional | `REQ-FUNC-NNN` | `REQ-FUNC-001` |
| Non-Functional | `REQ-NFUNC-NNN` | `REQ-NFUNC-003` |
| Constraint | `REQ-CON-NNN` | `REQ-CON-002` |

- NNN is a zero-padded 3-digit integer, starting at 001 and incrementing
  sequentially per type.
- IDs are permanent once assigned. They are NEVER reused, even if a requirement
  is rejected or deferred.
- Gaps in the sequence (e.g. 001, 002, 004) are acceptable if a requirement was
  removed — do not renumber to fill gaps.
- Each type (FUNC, NFUNC, CON) has its own independent counter. REQ-FUNC-001
  and REQ-NFUNC-001 are different requirements.
- If appending to existing requirements, always continue from the highest
  existing number per type — never restart from 001.

---

## 2. MoSCoW Priority

Every requirement MUST have a priority assigned using the MoSCoW method. No
requirement may have a null or missing priority field.

| Priority | Value | Meaning |
|---|---|---|
| Must | `must` | Non-negotiable. System fails without this. |
| Should | `should` | High value. Include unless strong reason to defer. |
| Could | `could` | Nice to have. Include only if time and budget allow. |
| Won't | `wont` | Explicitly out of scope for this version. Document why. |

**Rules:**
- A `wont` requirement MUST include a `deferralReason` field explaining why it
  is out of scope.
- At least 60% of functional requirements must be `must` or `should` — this is
  a minimum floor, not a target. If fewer than 60% are must/should, flag this
  to the user as a sign of scope creep or incomplete analysis.
- Non-functional requirements (REQ-NFUNC-*) are almost always `must` for
  regulated industries (banking, government). Default to `must` unless the client
  explicitly says otherwise.
- Never assign `must` to a requirement the client has not confirmed.
- If priority is unclear from input, default to `should` and add an assumption
  noting the prioritization was inferred.

---

## 3. Mandatory Fields

Every requirement object saved to state.json MUST contain all of the following
fields. AJV validation will hard-block the write if any are missing.

```json
{
  "id": "REQ-FUNC-001",
  "type": "functional",
  "category": null,
  "title": "Short descriptive title (max 120 characters)",
  "description": "The system shall [action] [object] [condition].",
  "priority": "must",
  "source": "RFP Section 3.2.1, Page 12",
  "status": "draft",
  "acceptanceCriteria": [
    "Specific, testable condition 1",
    "Specific, testable condition 2"
  ],
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
```

Note: `deferralReason` is required and must be non-null when `priority` is `wont`.
Note: `category` is required and must be non-null when `type` is `non-functional`.
  Use one of: `performance` | `security` | `scalability` | `availability` |
  `usability` | `compliance`.
  `category` may be null for `functional` and `constraint` requirements.

---

## 4. Requirement Writing Style

All requirement descriptions MUST follow this convention:

**Use:** `"The system shall [action] [object] [condition]"`
**Not:** `"The system should be able to [vague verb]"`

| Wrong | Correct |
|---|---|
| "The system should handle user login." | "The system shall authenticate users via username and password with MFA." |
| "Reports must load quickly." | "The system shall render dashboard reports in under 3 seconds at p95." |
| "Data must be secure." | "The system shall encrypt all customer PII at rest using AES-256." |
| "The API should be RESTful." | "The system shall expose a REST API conforming to OpenAPI 3.0 spec." |

---

## 5. Acceptance Criteria Rules

Acceptance criteria are the contract between the client and the development team.
They MUST be:

- **Testable**: A QA engineer must be able to write a test case from the criterion
  alone, without reading the requirement description.
- **Specific**: No vague language. "Fast" is not acceptable. "Response time under
  2 seconds at p95 under 500 concurrent users" is acceptable.
- **Binary**: The system either passes or fails each criterion. No partial credit.
- **Minimum count**: Every requirement must have at least 1 acceptance criterion.
  `must`-priority requirements must have at least 2.

**Banned phrases in acceptance criteria** (flag these and ask for clarification):
- "should be able to" — replace with "shall"
- "as fast as possible" — replace with a specific metric
- "easy to use" — replace with a usability metric or task completion benchmark
- "industry standard" — name the specific standard
- "appropriate" — define what appropriate means in this context

---

## 6. Source Attribution

Every requirement MUST trace back to a source document, stakeholder statement,
or regulatory obligation. The `source` field must be specific enough that another
analyst can locate the original text.

**Acceptable source formats:**
- `"RFP Section 3.2.1, Page 12"` — document reference with section and page
- `"Stakeholder: Ahmed Khan, Meeting 2026-03-15"` — stakeholder attribution
- `"SBP IT Governance Framework, Control SBP-SEC-001"` — regulatory origin
- `"Implicit: industry standard for banking systems"` — inferred requirement
  (must be flagged for client validation)

Requirements with `source` starting with `"Implicit"` MUST be marked
`status: "draft"` and presented to the client for confirmation before status
can be changed to `"validated"` or `"approved"`.

---

## 7. Compliance Tagging

If a requirement intersects with any of the following regulatory frameworks, the
`complianceFrameworks` array MUST be populated. Under-tagging is worse than
over-tagging — when in doubt, tag it.

| Framework | Trigger Keywords | Severity |
|---|---|---|
| `SBP-2024` | State Bank, SBP, BPRD, prudential, encryption, MFA, audit log, customer data, PII | critical |
| `PPRA-2024` | PPRA, tender, bid, procurement, single-source, evaluation committee, public procurement | high |
| `GDPR` | GDPR, personal data, consent, data subject, right to erasure, EU | high |
| `ISO-27001` | ISO 27001, information security, access control, risk assessment, ISMS | high |
| `PCI-DSS` | PCI, payment card, cardholder data, CVV, PAN, transaction | critical |
| `SAMA-2024` | SAMA, Saudi, Saudi Arabian Monetary | critical |
| `CBUAE` | CBUAE, UAE central bank, Central Bank of UAE | critical |
| `AAOIFI` | AAOIFI, Islamic finance, Shariah, murabaha, sukuk | high |

**How to tag:**
```json
"complianceFrameworks": ["SBP-2024", "ISO-27001"]
```

When a compliance flag is detected, also add an entry to `.sdlc/state.json`
complianceFlags array:

```json
{
  "frameworkCode": "SBP-2024",
  "triggeredBy": "REQ-FUNC-005",
  "keyword": "State Bank",
  "detectedAt": "2026-03-27T00:00:00Z",
  "status": "pending-review"
}
```

---

## 8. Implicit Requirement Expansion

When extracting requirements, always expand these patterns — never extract only
what is explicitly stated:

| Input mentions | Always also extract |
|---|---|
| Login / sign in / authentication | Session timeout (NFUNC), password policy (CON), MFA if regulated (FUNC), account lockout (FUNC) |
| User roles / permissions | Role-based access control (FUNC), audit log of access (FUNC), privilege escalation prevention (NFUNC) |
| Reports / exports | Data export formats (FUNC), report scheduling (FUNC), export size limits (NFUNC) |
| Payment / transactions | Transaction logging (FUNC), reconciliation (FUNC), rollback (FUNC), PCI-DSS flag (CON) |
| Personal data / PII | Data retention policy (CON), right to erasure (FUNC), data residency (CON), GDPR flag |
| API / integration | Rate limiting (NFUNC), versioning (CON), authentication (FUNC), error handling (NFUNC) |
| Cloud / hosting | Data residency (CON), uptime SLA (NFUNC), disaster recovery (FUNC), backup policy (CON) |

---

## 9. Non-Functional Requirement Categories

REQ-NFUNC-* requirements MUST specify a `category` field from this list:

| Category | Description |
|---|---|
| `performance` | Response time, throughput, latency, capacity |
| `security` | Authentication, encryption, audit, access control |
| `scalability` | Horizontal/vertical scaling, load capacity |
| `availability` | Uptime SLA, failover, disaster recovery |
| `usability` | Accessibility, UX standards, language support |
| `compliance` | Regulatory adherence, audit requirements |


**Pakistani banking and government project defaults** — these NFRs are assumed
mandatory unless explicitly waived by the client:
- Availability: 99.9% uptime SLA minimum
- Security: MFA for admin access, AES-256 encryption at rest
- Compliance: SBP audit log retention minimum 7 years
- Performance: Sub-3-second response time for all user-facing operations

---

## 10. Status Lifecycle

Requirements move through a defined status lifecycle. Status may only advance
forward — it cannot go backward.

```
draft → validated → approved
             ↓
          deferred (can re-enter as draft in next version)
             ↓
          rejected (permanent — ID is retired, never reused)
```

- Only `approved` requirements are included in the final SRS .docx
- `draft` and `validated` requirements are held in state.json but excluded from
  the final document until approved
- The /srs command MUST display a count of draft/validated requirements and ask
  for confirmation before generating the document with only the approved subset

---

## 11. What the BA Agent Must NEVER Do

- Invent requirements not traceable to a source document or stakeholder statement
- Assign `priority: "must"` to a requirement the client has not confirmed
- Write acceptance criteria using banned phrases
- Write descriptions in passive voice — always use "The system shall..."
- Omit the `traceForward` object — it must always be present, even if all arrays are empty
- Merge two distinct requirements into one — if a description contains " and "
  connecting two separate actions, split it into two requirements with separate IDs
- Skip REQ-CON-* constraints — constraints from the RFP are requirements and must be captured
- Leave `deferralReason` null on a `wont` requirement
- Reuse a retired requirement ID
- Silently resolve ambiguity — always add to Open Questions

---

## 12. Atomicity Rule

Every requirement must describe exactly ONE action, behavior, or constraint.

**The test:** Can you write a single test case that fully verifies this requirement?
If no — it needs to be split.

**Bad — not atomic :**
```
REQ-FUNC-010: "The system shall authenticate users via CNIC and send an email
notification on failed login and lock the account after 5 attempts."
```

**Good — atomic :**
```
REQ-FUNC-010: "The system shall authenticate users via CNIC and password."
REQ-FUNC-011: "The system shall send an email notification after each failed login attempt."
REQ-FUNC-012: "The system shall lock a user account after 5 consecutive failed login attempts."
```

**Detection rule:** If a requirement description contains " and " connecting two
separate system actions — split it. " and " connecting a single action to its
condition is acceptable:
- Acceptable: "The system shall encrypt data at rest and in transit." (one action, two conditions)
- Not acceptable: "The system shall encrypt data and send an audit log." (two separate actions)

---

## 13. Conflict Resolution Rule

When two requirements contradict each other, follow this exact process:

1. **Document both** — extract both as separate requirements with their own IDs
2. **Mark both `status: "draft"`** — neither can advance to validated until resolved
3. **Add an Open Question** — flag the conflict with both REQ IDs referenced
4. **Note ownership** — record which stakeholder owns each conflicting requirement
5. **Create a TodoWrite** — "Resolve conflict between REQ-FUNC-X and REQ-FUNC-Y with [stakeholder]"
6. **Never pick one and discard the other** — that decision belongs to the client

**Example conflict entry in Open Questions:**

| # | Question | Asked To | Status |
|---|---|---|---|
| 3 | REQ-FUNC-005 requires on-premise hosting but REQ-CON-002 references AWS deployment. Which takes precedence? | Dr. Tariq (Project Sponsor) | Open |

Both conflicting requirements remain in state.json with `status: "draft"` until
the client resolves the conflict in writing.
