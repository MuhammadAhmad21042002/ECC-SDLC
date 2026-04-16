# Documentation Rules

All documents produced by ECC-SDLC agents must follow these standards.
Claude must apply these rules when generating any artifact — scope, SRS,
SDS, STS, estimate, or proposal.

---

## 1. Document Header (Required on All Artifacts)

Every generated document must begin with this header block:

```text
Document Title
Project:      [Project Name]
Client:       [Client Name]
Version:      [N.N]
Date:         [YYYY-MM-DD]
Prepared by:  ECC-SDLC [Agent Name] Agent
Status:       Draft | Under Review | Approved
```

No document may be delivered without a complete header.

---

## 2. Version Numbering

| Version | Meaning |
|---|---|
| v1.0 | First complete draft |
| v1.1, v1.2 | Minor revisions (content changes, no structure change) |
| v2.0 | Major revision (structural change, phase re-run) |

- Version is tracked in `state.artifacts.[name].version`
- document-version.js hook auto-increments on every session where an artifact is modified
- Never manually set version to a lower number than the current value

---

## 3. Document Structure Standards

### Scope Document (`scope-v1.docx`)

Required sections in order:

1. Cover Page
2. Table of Contents
3. Version History
4. Project Overview
5. Objectives
6. In Scope
7. Out of Scope
8. Stakeholders
9. Assumptions
10. Constraints
11. Risks and Mitigations
12. Deliverables
13. Timeline (if applicable)

### SRS Document (`srs-v1.docx`)

Required sections in order:

1. Introduction (purpose, scope, definitions)
2. Overall Description (product perspective, user classes)
3. Functional Requirements (REQ-FUNC-\* table)
4. Non-Functional Requirements (REQ-NFUNC-\* table)
5. Constraints (REQ-CON-\* table)
6. Compliance Requirements
7. Glossary
8. Appendix (open questions, assumptions)

### SDS Document (`sds-v1.docx`)

Required sections in order:

1. Architecture Overview (Mermaid diagram)
2. Component Specifications (DC-\* table)
3. Database Schema (ER diagram)
4. API Contracts (endpoint specifications)
5. Integration Points
6. Security Architecture
7. Traceability Matrix (REQ-\* → DC-\*)

### STS Document (`sts-v1.docx`)

Required sections in order:

1. Test Strategy
2. Test Scope
3. Test Cases (TC-\* table with REQ-\* links)
4. Traceability Matrix (REQ-\* → TC-\*)
5. Test Environment Requirements
6. Entry and Exit Criteria

### Estimate Document (`estimate-v1.xlsx`)

Required sections in order:

1. Resource Plan (roles, rates, allocation)
2. Effort Breakdown by Phase (discovery, requirements, design, development, testing, deployment)
3. Timeline (Gantt or milestone table)
4. Cost Summary (total, per phase, per resource)
5. Assumptions and Exclusions

### Proposal Document (`proposal-v1.docx`)

Required sections in order:

1. Cover Page
2. Executive Summary
3. Understanding of Requirements
4. Technical Approach
5. Project Team
6. Timeline and Milestones
7. Cost Summary
8. Compliance Statement
9. Appendices

---

## 4. Folder Structure

```text
project-folder/
├── .sdlc/                      ← hidden — all machine state and artifacts
│   ├── state.json              ← project state
│   ├── sessions.log            ← session history
│   ├── glossary.json           ← domain terms
│   └── artifacts/              ← all generated documents go here
│       ├── scope-v1.docx
│       ├── srs-v1.docx
│       ├── sds-v1.docx
│       ├── sts-v1.docx
│       ├── estimate-v1.xlsx
│       └── proposal-v1.docx
└── CLAUDE.md                   ← auto-generated at handoff
```

- ALL generated artifacts go in `.sdlc/artifacts/` — never in `.sdlc/` root
- `.sdlc/` root contains only state.json, sessions.log, and glossary.json
- `CLAUDE.md` is generated at the project root level for the dev team

---

## 5. File Naming Convention

| Artifact | File Name Pattern | Example | Location |
|---|---|---|---|
| Scope | `scope-v{N}.docx` | `scope-v1.docx` | `.sdlc/artifacts/` |
| SRS | `srs-v{N}.docx` | `SRS-v1.docx` | `.sdlc/artifacts/` |
| SDS | `sds-v{N}.docx` | `SDS-v1.docx` | `.sdlc/artifacts/` |
| STS | `sts-v{N}.docx` | `sts-v1.docx` | `.sdlc/artifacts/` |
| Estimate | `estimate-v{N}.xlsx` | `estimate-v1.xlsx` | `.sdlc/artifacts/` |
| Proposal | `proposal-v{N}.docx` | `proposal-v1.docx` | `.sdlc/artifacts/` |

---

## 6. Artifact Registration in state.json

Every generated artifact must be registered in state.json immediately after
creation with a SHA-256 hash for change detection:

```json
"artifacts": {
  "srs": {
    "path": ".sdlc/artifacts/srs-v1.docx",
    "version": 1,
    "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "createdAt": "2026-03-27T00:00:00Z"
  }
}
```

Generate the SHA-256 hash using Node.js after writing the file:

```bash
node -e "
const crypto = require('crypto');
const fs = require('fs');
const hash = crypto.createHash('sha256')
  .update(fs.readFileSync('.sdlc/artifacts/srs-v1.docx'))
  .digest('hex');
console.log('sha256:' + hash);
"
```

- `hash` is used by document-version.js to detect if a file was modified
- Never leave `path` pointing to a file that does not exist

**Superseded artifact rule:**

An artifact becomes `superseded` when a newer version of the same document
is generated and registered. When this happens:

1. Keep the old file on disk — never delete superseded artifacts
2. The new artifact becomes the active version with version incremented
3. Only one artifact per type can be active at a time

Example — when srs-v2.docx is generated:

- Old: `.sdlc/artifacts/srs-v1.docx` — kept on disk, no longer active
- New: `.sdlc/artifacts/srs-v2.docx` — registered with `version: 2`

---

## 7. Formatting Rules

- All requirement tables must have columns: ID | Title | Priority | Description | Acceptance Criteria
- All traceability tables must have columns: REQ-ID | Design Component | Test Case | Cost Line Item | Coverage
- Mermaid diagrams must be in fenced code blocks with the `mermaid` language tag
- Tables must not be used as visual dividers or decorative elements
- Section numbers must be included in all documents (1., 1.1, 1.1.1)

---

## 8. Language and Tone

- Use precise, unambiguous language — avoid "should be fast", "easy to use"
- Use "shall" for mandatory requirements, "should" for recommendations
- Use active voice: "The system shall..." not "It is required that..."
- Define all acronyms on first use
- Maintain a glossary in `.sdlc/glossary.json` — add every new term

---

## 9. What Claude Must Never Do

- Deliver a document without a complete header block
- Use vague acceptance criteria ("user-friendly", "fast", "secure")
- Leave a required section empty — write "To Be Determined" with a todo
- Use a version number lower than the current artifact version
- Save artifacts outside `.sdlc/artifacts/` — all documents go in `.sdlc/artifacts/`
- Register an artifact in state.json without a SHA-256 hash
- Leave `path` in state.json pointing to a file that does not exist
- Use informal language, contractions, or first-person in documents
