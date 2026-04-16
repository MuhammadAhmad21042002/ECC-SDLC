---
name: sdlc-design
description: >
  SDS (Software Design Specification) design methodology for ECC-SDLC. Use when
  generating SDS data, defining DC-* components, producing diagrams, and
  constructing REQ-* → DC-* traceability artifacts.
---

# SDLC Design Skill (SDS)

## When to Use

Use this skill during `/sds` to:

- Convert validated requirements (REQ-_) into implementable design components (DC-_)
- Produce SDS document data matching `schemas/sds.schema.json` (v2)
- Maintain strict traceability rules from `rules/sdlc/traceability.md`

## Inputs

- Requirements from `.sdlc/state.json` (REQ-FUNC / REQ-NFUNC / REQ-CON)
- Any existing SRS constraints, assumptions, external interfaces
- Compliance flags (if present)

## Outputs

You should produce:

- `designComponents[]` for state.json that validate against `schemas/design-component.schema.json`
- `sdsData` that validates against `schemas/sds.schema.json` and fills `templates/sds-template.json`

---

## 1) DC-\* Design Component Rules

- **ID format**: `DC-NNN` (e.g., `DC-001`)
- **Trace-back required**: every DC must list 1+ `requirementIds` (REQ-\* IDs)
- **Status**: start as `draft` unless explicitly approved
- **Right sizing**: prefer fewer cohesive components over dozens of micro-components

---

## 2) Mapping: state `designComponents` vs template `sdsData.designComponents`

The SDS template table uses a simplified view:

- `sdsData.designComponents[*]` keys: `id`, `name`, `responsibility`, `interfaces`, `tracesToReq`

The state schema uses a canonical component contract:

- `designComponents[*]` keys: `id`, `title`, `description`, `requirementIds`, `status`

Keep both consistent:

- `sdsData.designComponents[*].id` == `designComponents[*].id`
- `sdsData.designComponents[*].tracesToReq` should match `designComponents[*].requirementIds`

---

## 3) SDS Required Sections (high-level)

Per `rules/sdlc/documentation.md`, SDS must include:

1. Architecture Overview + System Architecture Diagram
2. Data Flow Diagram
3. Network Architecture Diagram
4. Component Specifications (DC-\* table)
5. Use Case Diagram
6. Process Flow Diagram
7. Database Schema + ER Diagram
8. API Contracts
9. Integration Points
10. Security Architecture
11. Traceability Matrix (REQ-_ → DC-_)

---

## 4) Diagram Types — What the Agent Must Produce

The pipeline expects **both** a Mermaid source string **and** a structured object for each
diagram. They serve different rendering tiers:

| Field                                   | Used for                                                             |
| --------------------------------------- | -------------------------------------------------------------------- |
| `architectureDiagramMermaid` (string[]) | Tier 1 PNG render (flowchart syntax)                                 |
| `architectureDiagram` (object)          | Tier 2 fallback if Mermaid PNG fails                                 |
| `databaseErDiagramMermaid` (string[])   | Tier 1 PNG render (erDiagram syntax — MUST include attribute blocks) |
| `databaseErDiagram` (object)            | Tier 2 fallback if Mermaid PNG fails                                 |
| `dataFlowDiagramMermaid` (string[])     | Tier 1 PNG render (sequenceDiagram syntax)                           |
| `dataFlowDiagram` (object)              | Tier 2 fallback if Mermaid render fails                              |
| `networkDiagram` (object)               | Tier 2 only — no Mermaid equivalent                                  |
| `useCaseDiagram` (object)               | Tier 2 only — no Mermaid equivalent                                  |
| `flowchartDiagram` (object)             | Tier 2 only — no Mermaid equivalent                                  |

### ⚠ CRITICAL — erDiagram attribute blocks are REQUIRED

The ER diagram renderer reads field definitions from attribute blocks inside `{}`.
**You MUST include attribute blocks for every entity.** Relationship-only erDiagram
(no `{ }` blocks) produces a table with no fields in the output document.

**WRONG — relationship lines only (produces empty tables):**

```
erDiagram
  USERS ||--o{ SESSIONS : creates
```

**CORRECT — attribute blocks required for every entity:**

```
erDiagram
  USERS {
    string  id        PK
    string  email
    string  password
    boolean is_active
    date    created_at
  }
  SESSIONS {
    string id         PK
    string user_id    FK
    string token
    date   expires_at
  }
  USERS ||--o{ SESSIONS : creates
```

### ⚠ CRITICAL — all 6 diagram types must be populated

The template has sections for: architectureDiagram, dataFlowDiagram, networkDiagram,
componentSpecifications, useCaseDiagram, flowchartDiagram, erDiagram.
**You must provide input data for every one of them.** Missing inputs produce
placeholder text ("[Diagram not available]") in the document.

### 4.1 System Architecture Diagram (`architectureDiagram`)

```json
{
  "title": "System Architecture — Project Name",
  "layers": [
    { "name": "Presentation Tier", "services": ["Web Portal", "Mobile App", "Admin Dashboard"] },
    { "name": "Application Tier", "services": ["API Gateway", "Auth Service", "Core Business Logic", "Notification Service"] },
    { "name": "Integration Tier", "services": ["SBP Adapter", "SMTP Gateway", "SMS Gateway"] },
    { "name": "Data Tier", "services": ["PostgreSQL Primary", "Redis Cache", "File Storage"] }
  ]
}
```

### 4.2 ER Diagram (`databaseErDiagram`)

Produce entities with full field lists. Mark PK and FK fields explicitly.

```json
{
  "title": "Entity-Relationship Diagram",
  "entities": [
    {
      "name": "users",
      "fields": [
        { "name": "id", "type": "ObjectID", "pk": true },
        { "name": "email", "type": "String" },
        { "name": "password", "type": "String" },
        { "name": "role", "type": "String" },
        { "name": "is_active", "type": "Boolean" },
        { "name": "created_at", "type": "Date" }
      ]
    },
    {
      "name": "sessions",
      "fields": [
        { "name": "id", "type": "ObjectID", "pk": true },
        { "name": "user_id", "type": "ObjectID", "fk": true },
        { "name": "token", "type": "String" },
        { "name": "expires_at", "type": "Date" }
      ]
    }
  ],
  "relations": [{ "from": "sessions", "to": "users", "label": "belongs to", "cardinality": "N:1" }]
}
```

**ERD rules:**

- Always include `pk: true` on primary key fields
- Always include `fk: true` on foreign key fields
- Include `cardinality` on all relations: `"1:1"`, `"1:N"`, `"N:M"`
- List all significant fields — the renderer shows a full table with PK/FK badges and types

### 4.3 Data Flow Diagram (`dataFlowDiagram`)

Actors are column headings in a swimlane sequence diagram. Steps are numbered messages.

```json
{
  "title": "Login Request Data Flow",
  "actors": ["Browser", "API Gateway", "Auth Service", "User DB"],
  "steps": [
    { "from": "Browser", "to": "API Gateway", "message": "POST /auth/login", "sequence": 1 },
    { "from": "API Gateway", "to": "Auth Service", "message": "Validate credentials", "sequence": 2 },
    { "from": "Auth Service", "to": "User DB", "message": "SELECT user", "sequence": 3 },
    { "from": "User DB", "to": "Auth Service", "message": "User record", "sequence": 4, "type": "return" },
    { "from": "Auth Service", "to": "API Gateway", "message": "JWT token", "sequence": 5, "type": "return" },
    { "from": "API Gateway", "to": "Browser", "message": "200 OK + token", "sequence": 6, "type": "return" }
  ]
}
```

Step types: `"sync"` (default, solid arrow), `"async"` (dashed arrow), `"return"` (dashed grey).

### 4.4 Network Architecture Diagram (`networkDiagram`)

Zones are rendered as labelled horizontal bands. Connections link nodes by id.

```json
{
  "title": "Network Architecture",
  "zones": [
    {
      "name": "Internet",
      "nodes": [{ "id": "client", "label": "End User / Browser", "type": "client" }]
    },
    {
      "name": "DMZ",
      "nodes": [
        { "id": "fw", "label": "WAF / Firewall", "type": "firewall" },
        { "id": "lb", "label": "Load Balancer", "type": "loadbalancer" }
      ]
    },
    {
      "name": "Application Zone (Private)",
      "nodes": [
        { "id": "app1", "label": "App Server 1", "type": "server" },
        { "id": "app2", "label": "App Server 2", "type": "server" }
      ]
    },
    {
      "name": "Data Zone (Isolated)",
      "nodes": [
        { "id": "db", "label": "PostgreSQL Primary", "type": "db" },
        { "id": "cache", "label": "Redis Cache", "type": "db" }
      ]
    }
  ],
  "connections": [
    { "from": "client", "to": "fw", "protocol": "HTTPS/443" },
    { "from": "fw", "to": "lb", "protocol": "HTTPS" },
    { "from": "lb", "to": "app1", "protocol": "HTTP" },
    { "from": "lb", "to": "app2", "protocol": "HTTP" },
    { "from": "app1", "to": "db", "protocol": "TCP/5432" },
    { "from": "app1", "to": "cache", "protocol": "TCP/6379" }
  ]
}
```

Node types: `"server"`, `"db"`, `"firewall"`, `"client"`, `"cloud"`, `"loadbalancer"`.

### 4.5 Use Case Diagram (`useCaseDiagram`)

```json
{
  "title": "Candidate Portal — Use Cases",
  "actors": [
    { "id": "candidate", "name": "Candidate" },
    { "id": "hr", "name": "HR Manager" }
  ],
  "useCases": [
    { "id": "uc1", "name": "Submit Application" },
    { "id": "uc2", "name": "Upload Resume" },
    { "id": "uc3", "name": "Review Applications" },
    { "id": "uc4", "name": "Schedule Interview" }
  ],
  "associations": [
    { "actorId": "candidate", "useCaseId": "uc1" },
    { "actorId": "candidate", "useCaseId": "uc2" },
    { "actorId": "hr", "useCaseId": "uc3" },
    { "actorId": "hr", "useCaseId": "uc4" }
  ],
  "includes": [{ "from": "uc1", "to": "uc2" }]
}
```

### 4.6 Flowchart / Process Flow (`flowchartDiagram`)

```json
{
  "title": "Application Submission Flow",
  "nodes": [
    { "id": "start", "label": "Start", "type": "start" },
    { "id": "fillForm", "label": "Fill Application Form", "type": "process" },
    { "id": "validate", "label": "Form Valid?", "type": "decision" },
    { "id": "showErrors", "label": "Show Validation Errors", "type": "process" },
    { "id": "submit", "label": "Submit to API", "type": "process" },
    { "id": "notify", "label": "Send Confirmation Email", "type": "io" },
    { "id": "end", "label": "End", "type": "end" }
  ],
  "edges": [
    { "from": "start", "to": "fillForm" },
    { "from": "fillForm", "to": "validate" },
    { "from": "validate", "to": "showErrors", "label": "No" },
    { "from": "validate", "to": "submit", "label": "Yes" },
    { "from": "showErrors", "to": "fillForm" },
    { "from": "submit", "to": "notify" },
    { "from": "notify", "to": "end" }
  ]
}
```

Node types: `"start"`, `"end"` (pills), `"process"` (rectangle), `"decision"` (diamond), `"io"` (parallelogram), `"connector"` (circle).

---

## 5) Traceability (CRITICAL)

Follow `rules/sdlc/traceability.md`:

- Every major SDS section must reference at least one REQ-\* ID in its opening paragraph.
- By end of SDS, every `must` requirement must have at least one DC mapping.
- Do not introduce a DC with no corresponding requirement.
- If a design decision has no requirement, create a `REQ-CON-*` constraint and trace to it.

---

## 6) Traceability Matrix Construction

Build `traceabilityMatrixRows` as:

- `reqId`
- `requirementTitle`
- `designComponentIds` (array of DC IDs)
- `coverage` (e.g., 33/67/100 or "Design traced")

Minimum expectation for SDS gate: all `must` requirements have at least one DC ID.
