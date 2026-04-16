---
name: sdlc-meeting-analysis
description: >
  Meeting analysis and Minutes of Meeting (MoM) extraction methodology for
  ECC-SDLC. Load this skill when the business-analyst agent is processing
  meeting transcripts, call notes, voice memos, or informal written notes
  for the /mom command. Covers structured extraction rules for attendees,
  agenda items, decisions, action items, requirement signals, and compliance
  flags. Includes output quality standards, formatting rules, and the
  requirement-signal-to-REQ-* promotion pipeline.
---

# SDLC Meeting Analysis Skill

## Purpose

This skill governs how the Business Analyst agent extracts structured
Minutes of Meeting (MoM) data from unstructured meeting inputs —
transcripts, call notes, voice-memo summaries, or informal written records.

The output of this skill feeds the `/mom` command, which validates the
extraction, generates a formatted `mom-vN.docx`, and optionally promotes
`requirementSignals` into `state.json.requirements[]` when the project is
at or past the discovery phase.

---

## 1. What counts as a meeting input

The agent must accept and process any of the following input types:

| Input type | Examples |
| --- | --- |
| Formal transcript | Zoom/Teams auto-transcript, Otter.ai export |
| Informal notes | Bullet-point notes taken during a call |
| Email summary | "Per our discussion today..." recap emails |
| Voice memo text | Dictated notes from a site visit or call |
| Chat export | WhatsApp / Slack thread covering a discussion |
| Partially structured | Pre-filled agenda template with added notes |

The agent must NOT refuse input because it is messy, colloquial, or
incomplete. Extract what exists; flag gaps as open questions.

---

## 2. Extraction targets — what to look for

### 2.1 Meeting metadata

Extract or infer:

- **`meetingTitle`** — if not stated, infer from topic or attendees
  (e.g. "Requirements Kickoff — FBR AI Platform")
- **`date`** — YYYY-MM-DD. If only "last Tuesday" or "yesterday" is
  mentioned, capture exactly as written and note it cannot be normalised.
  Never invent a date.
- **`time`** and **`duration`** — optional; include if mentioned
- **`meetingType`** — classify as one of:
  `kickoff | requirements | design | review | status | procurement | closure | other`
- **`platform`** — Zoom, Teams, in-person, phone, etc. (optional)
- **`location`** — physical location if mentioned (optional)
- **`projectName`** and **`clientName`** — read from state.json if
  available; otherwise extract from context

### 2.2 Attendees

For each person mentioned as present:

- **`name`** — full name if available, role/title if name not given
- **`role`** — their job title or function in the meeting
- **`organization`** — company or department
- **`present`** — `true` for attendees, `false` for noted absentees
- **`contactType`** — one of: `client` | `vendor` | `internal` | `regulator` | `other`

Treat "apologies received from X" or "X could not attend" as
`present: false`. Never invent attendees.

### 2.3 Agenda items

List agenda items in the order they were discussed. If no formal agenda
existed, reconstruct topic flow from the discussion content. Use short
noun phrases (e.g. "Portal architecture overview", "Data residency
requirement").

### 2.4 Decisions

A decision is something that was **agreed, approved, or resolved** during
the meeting — a commitment that changes the project record.

Decision extraction rules:

- Assign sequential IDs: `DEC-001`, `DEC-002`, etc.
- **`decision`** — state what was decided in one declarative sentence
- **`owner`** — the person responsible for enforcing or acting on the
  decision (may differ from who raised it)
- **`dueDate`** — YYYY-MM-DD if mentioned; `null` if not
- **`rationale`** — brief reason if given (optional field)
- **`references`** — list any REQ-* IDs this decision relates to
  (empty array if none yet exist)

Signals that something is a decision:

- "We agreed that..."
- "It was decided..."
- "X confirmed that..."
- "Going forward, we will..."
- "Approved: ..."
- "The client has signed off on..."

Do NOT classify open questions, wishlist items, or unresolved debates as
decisions. If something was discussed but not resolved, it belongs in
`openQuestions`.

### 2.5 Action items

An action item is a **specific task assigned to a named person** with an
expected output.

Action item rules:

- Assign sequential IDs: `ACT-001`, `ACT-002`, etc.
- **`action`** — what must be done (imperative sentence)
- **`owner`** — name of the person responsible
- **`dueDate`** — YYYY-MM-DD if stated; `null` if not given
- **`status`** — always `"open"` at extraction time
- **`priority`** — `high | medium | low` — infer from urgency language
  or leave `medium` if unclear
- **`context`** — optional one-sentence background for the task

Signals that something is an action item:

- "X will..."
- "X to send / prepare / review / confirm..."
- "ACTION: ..."
- "Follow up by..."
- "X is responsible for..."

Distinguish action items from decisions: a decision is a resolved
outcome; an action item is pending work.

### 2.6 Requirement signals

A requirement signal is an **implicit need, constraint, or capability
request** raised in discussion that has not yet been formalised as a
`REQ-*` entry in state.json.

Extraction rules:

- Capture as a plain string describing the need
- Do NOT assign `REQ-*` IDs here — that happens during `/srs` or when
  the orchestrator explicitly promotes signals
- Include the stakeholder who raised it if identifiable
  (e.g. "Client requested: system must support Urdu language interface")
- Flag potential compliance intersections when regulatory keywords appear
  (SBP, PPRA, SBP, GDPR, ISO 27001, PCI-DSS, SAMA, CBUAE, AAOIFI)

Signals to look for:

- Feature requests: "We need...", "The system should..."
- Performance needs: "It must respond within...", "We expect 99.9% uptime"
- Compliance mentions: "SBP requires...", "We need PPRA approval..."
- Security requirements: "Access should be role-based...", "Data must stay in Pakistan"
- Integration needs: "It should connect to...", "We use X for billing"

### 2.7 Open questions

Capture unresolved questions, blockers, and items deferred for later
decision. Each open question should state what needs to be resolved and
who should resolve it.

### 2.8 Next meeting

If a follow-up meeting was scheduled or proposed:

- **`date`** — YYYY-MM-DD or `null`
- **`platform`** — if mentioned
- **`proposedAgenda`** — array of topics for the next meeting

---

## 3. Output quality standards

### 3.1 Completeness

- Never leave `decisions[]` or `actionItems[]` empty if the transcript
  contains evidence of agreements or assigned tasks
- Never merge two distinct decisions into one
- Each action item must have exactly one `owner` — if shared, split into
  separate items per person
- Attendance must reflect only people explicitly mentioned as present

### 3.2 Faithfulness

- Do not invent information not present in the input
- Do not reinterpret a decision as something different from what was said
- Quote the exact phrase from the transcript in `verbatimQuote` (optional
  field on decisions and action items) if the original wording matters
- If a stakeholder name is ambiguous (only first name given), use what
  is available — do not guess surnames

### 3.3 Neutrality

- Record decisions as stated — do not editorialize
- If the meeting shows disagreement that was not resolved, document both
  positions in `openQuestions`, not as a decision
- Do not suppress uncomfortable decisions or action items

### 3.4 Traceability

- Link decisions and requirement signals to agenda items where possible
- Link action items to the decision that generated them if traceable
- When a requirement signal maps to an existing REQ-* in state.json,
  note it in `references`

---

## 4. Compliance keyword scanning

After extraction is complete, scan the full meeting content for
regulatory keywords. Append identified frameworks to `complianceFlags[]`.

| Framework | Trigger keywords |
| --- | --- |
| SBP-2024 | SBP, State Bank, data residency, AML, KYC, encryption, audit log, banking regulation |
| PPRA-2024 | PPRA, procurement, tender, bid, RFP, single-source, evaluation committee |
| PCI-DSS-4 | PCI, cardholder, card data, payment processing, tokenisation |
| GDPR | GDPR, EU, personal data, right to erasure, data subject, consent |
| ISO-27001 | ISO 27001, information security, ISMS, risk register, asset inventory |
| SAMA-2024 | SAMA, Saudi Arabia, cybersecurity framework, financial institution KSA |
| CBUAE-2024 | CBUAE, Central Bank UAE, UAE bank, Emirates, data protection UAE |
| AAOIFI | AAOIFI, Sharia, Islamic finance, riba, mudarabah, halal, SSB |

---

## 5. Multi-meeting accumulation

When `/mom` is run multiple times on the same project:

- Each run produces a separate `mom-vN.json` and `mom-vN.docx`
- Action items from earlier meetings carry their original IDs
- The orchestrator maintains `state.json.meetings[]` as a cumulative log
- The `/sdlc-status` dashboard reads `meetings[]` to show pending action
  items across all meetings

---

## 6. Requirement signal promotion rules

When the orchestrator calls `/mom --promote-signals`:

1. For each `requirementSignals[]` entry, the business-analyst is
   re-invoked to produce a full `REQ-*` record
2. The REQ-* record is added to `state.json.requirements[]`
3. The signal is marked `promoted: true` in the meeting record
4. The new REQ-* IDs are written back to the signal's `references` field

This pipeline is the bridge between informal meeting discussion and the
formal requirements register.

---

## 7. Common mistakes to avoid

| Mistake | Correct approach |
| --- | --- |
| Treating every discussion point as a decision | Only resolved commitments are decisions |
| Missing implicit action items ("X will follow up") | Scan all verbs for task-assignment patterns |
| Assigning a group as action item owner | Split into individual owners |
| Inventing dates when only relative time is given | Use `null` for dueDate; note the relative phrase in context |
| Omitting requirementSignals from casual remarks | Casual mentions of features/constraints are high-value signals |
| Confusing "agenda item" with "decision" | Agenda = topic discussed; Decision = outcome of discussion |
| Creating REQ-* IDs in the MoM output | Signals only; REQ-* promotion happens separately |
| One MoM entry for multiple meetings | Each meeting gets its own extraction run and document |

---

## 8. Output contract

Return exactly **one** JSON object — no markdown fences, no prose:

```json
{
  "meetingTitle": "string — inferred or stated title",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM (24h) or null",
  "duration": "e.g. '90 minutes' or null",
  "meetingType": "kickoff | requirements | design | review | status | procurement | closure | other",
  "platform": "Zoom | Teams | in-person | phone | other | null",
  "location": "string or null",
  "projectName": "from state.json or extracted",
  "clientName": "from state.json or extracted",
  "attendees": [
    {
      "name": "Full Name or Role",
      "role": "Job title / function",
      "organization": "Company or department",
      "present": true,
      "contactType": "client | vendor | internal | regulator | other"
    }
  ],
  "agendaItems": ["Topic 1", "Topic 2"],
  "decisions": [
    {
      "id": "DEC-001",
      "decision": "Declarative sentence of what was resolved",
      "owner": "Name",
      "dueDate": "YYYY-MM-DD or null",
      "rationale": "Brief reason or null",
      "references": [],
      "verbatimQuote": "Exact quote from transcript or null"
    }
  ],
  "actionItems": [
    {
      "id": "ACT-001",
      "action": "Imperative — what must be done",
      "owner": "Name",
      "dueDate": "YYYY-MM-DD or null",
      "status": "open",
      "priority": "high | medium | low",
      "context": "One-sentence background or null"
    }
  ],
  "requirementSignals": [
    "Stakeholder X raised: the system must support Urdu interface"
  ],
  "openQuestions": [
    "Who owns the data residency decision — client or vendor?"
  ],
  "complianceFlags": ["SBP-2024", "PPRA-2024"],
  "nextMeeting": {
    "date": "YYYY-MM-DD or null",
    "platform": "string or null",
    "proposedAgenda": ["Topic A", "Topic B"]
  },
  "summary": "2-3 sentence plain-language summary of what was accomplished in this meeting"
}
```

`nextMeeting` may be `null` if no follow-up was scheduled.

---

## 9. Self-check before returning

- [ ] Single JSON object — no markdown fence wrapping
- [ ] No file writes or Bash calls
- [ ] `decisions[]` only contains resolved outcomes, not discussion points
- [ ] Each `actionItem` has exactly one named `owner`
- [ ] `requirementSignals[]` has no `REQ-*` IDs — signals only
- [ ] `date` is YYYY-MM-DD or `null` — never a relative string
- [ ] `complianceFlags[]` reflects keyword scan of full transcript
- [ ] `summary` is 2-3 sentences — no bullet points
