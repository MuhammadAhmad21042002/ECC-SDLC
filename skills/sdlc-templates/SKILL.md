---
name: sdlc-templates
description: >
  ECC-SDLC template system reference for the technical-writer agent. Covers
  the 3-tier template resolution order (project → user → plugin), the full
  dataContract.requiredFields for every pipeline template (scope, srs, sds),
  all section types and their placeholder tokens, column key contracts for
  table sections, quality validation rules from Section 10.3 of the Technical
  Proposal, and the Mode A / Mode B invocation contract. Load this skill
  whenever the technical-writer agent is processing any ECC-SDLC template.
---

# SDLC Templates Skill

## Purpose

This skill is the authoritative reference for the `technical-writer` agent
when it works with ECC-SDLC document templates. It covers:

- Template resolution order (which file wins when overrides exist)
- Every template's `dataContract.requiredFields` — the agent must satisfy
  all of these before document generation can proceed
- Section types and their placeholder token contracts
- Column key shapes for every table section
- Quality validation rules the agent must enforce (Section 10.3)
- The exact Mode A / Mode B invocation contract

---

## 1. Template Resolution Order (Section 10.2)

When the technical-writer resolves a template, it must check in this order
(highest priority first). The first file found wins:

```
1. Project-level  →  .sdlc/templates/{name}.json
2. User-level     →  ~/.claude/sdlc-templates/{name}.json
3. Plugin default →  templates/{name}.json          ← lowest priority
```

**`{name}`** is the bare template name without path or extension:
`scope`, `srs`, `sds`, `sts`, `proposal`, `estimation`.

**Practical steps:**

1. Check if `.sdlc/templates/{name}.json` exists — use it if present.
2. Otherwise check `~/.claude/sdlc-templates/{name}.json` — use it if present.
3. Otherwise use `templates/{name}.json` from the plugin root.
4. Record which source was used in the `resolvedTemplateSource` field of
   the output (`"project"`, `"user"`, or `"plugin"`).

This lets organisations maintain branded templates at the user level while
individual projects can override sections as needed.

---

## 2. Section Types

Every section in a template has a `type` field. The agent must handle each
type correctly:

| Type                | Rendering behaviour                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cover`             | Cover page — substitute `{token}` values directly into title/subtitle/metadata fields                                                                                     |
| `tableOfContents`   | Auto-generated TOC — no data input needed; the docx engine builds it from H1/H2/H3 headings                                                                               |
| `table`             | Data table — `columns[]` defines keys and headers; `{placeholder}` is an array of row objects, each row must have every column `key`                                      |
| `requirementsTable` | Like `table` but purpose-built for REQ-\* rows; same column contract applies                                                                                              |
| `repeatingBlock`    | One formatted block per item in the array; uses `{id}` and `{title}` as per-item tokens                                                                                   |
| `contentBlock`      | Paragraphs and bullet lists; each `{placeholder}` is an array of strings                                                                                                  |
| `diagram`           | Rendered image (SVG/PNG) — no data input from agent; the generate script embeds the rendered diagram                                                                      |
| `mermaidBlock`      | Raw Mermaid source as a styled code listing — no data input from agent; the generate script reads `architectureDiagramMermaid` / `databaseErDiagramMermaid` from the JSON |
| `appendix`          | Appendix section — same as `contentBlock` for data purposes                                                                                                               |
| `index`             | Keyword index — `{placeholder}` is an array of `{ term, location }` objects                                                                                               |

**Key rule:** never pass data for `diagram` or `mermaidBlock` sections.
These are driven by the generate script, not the agent.

---

## 3. Placeholder Token Rules

- Every `{token}` in a template section maps to a named field in the data JSON.
- **String tokens** (`{projectName}`, `{generatedDate}`) — replace with a single string value.
- **Array-of-strings tokens** (`{purposeParagraphs}`, `{objectivesNumbered}`) — the value must be `string[]`. Minimum 1 item.
- **Array-of-objects tokens** (`{requirements}`, `{stakeholders}`) — the value must be an array of objects where every object has the keys matching the section's `columns[*].key` list.
- **Runtime tokens** (`{pageNumber}`, `{pageCount}`) — do NOT replace these; leave them for the docx runtime engine.
- If a required token value is missing or empty, insert `"TBD"` for strings and `["TBD"]` for arrays. Never leave a required field null or undefined.

---

## 4. Template Contracts

### 4.1 Scope Template — `ecc-sdlc.scope.v1`

**File:** `templates/scope-template.json`
**Used by:** `/scope` command, technical-writer Mode A

**`dataContract.requiredFields`:**

```
projectName, clientName, preparedBy, generatedDate, documentVersion,
versionHistory, projectOverviewParagraphs, objectivesNumbered, inScope,
outOfScopeBullets, stakeholders, assumptionsBullets, constraints, risks,
deliverablesNumbered, timelineMilestones
```

**Table column contracts:**

| Section          | Columns (keys)                                |
| ---------------- | --------------------------------------------- |
| `versionHistory` | `version`, `date`, `author`, `changes`        |
| `inScope`        | `id`, `title`, `description`                  |
| `stakeholders`   | `name`, `role`, `organization`, `contactType` |
| `constraints`    | `type`, `description`                         |
| `risks`          | `id`, `description`, `likelihood`, `impact`   |
| `timeline`       | `milestone`, `date`                           |

---

### 4.2 SRS Template — `ecc-sdlc.srs.v1`

**File:** `templates/srs-template.json`
**Used by:** `/srs` command, technical-writer Mode A

**`dataContract.requiredFields`:**

```
projectName, clientName, preparedBy, generatedDate, documentVersion,
versionHistory, purposeParagraphs, scopeParagraphs, definitionsTable,
referencesBullets, overviewParagraphs, productPerspective,
productFunctionsBullets, userClasses, constraintsNumbered,
assumptionsNumbered, userInterfacesParagraphs, hardwareInterfacesParagraphs,
softwareInterfacesParagraphs, communicationsInterfacesParagraphs,
functionalRequirements, nonFunctionalRequirements,
designConstraintsParagraphs, logicalDatabaseParagraphs,
reliabilityParagraphs, availabilityParagraphs, securityParagraphs,
maintainabilityParagraphs, portabilityParagraphs, otherRequirementsParagraphs,
dataModelsParagraphs, apiContractsParagraphs,
complianceConsiderationsParagraphs, signOffRows, indexEntries
```

**Table column contracts:**

| Section                          | Columns (keys)                                    |
| -------------------------------- | ------------------------------------------------- |
| `versionHistory`                 | `version`, `date`, `author`, `changes`            |
| `definitionsTable`               | `term`, `definition`, `source`                    |
| `userClassesTable`               | `role`, `description`, `accessLevel`, `frequency` |
| `functionalRequirementsTable`    | `id`, `title`, `priority`, `description`          |
| `nonFunctionalRequirementsTable` | `id`, `category`, `title`, `priority`             |
| `appendixSignOff`                | `name`, `title`, `signature`, `date`              |

**Requirement row shape** (for `functionalRequirements` and `nonFunctionalRequirements`):

```json
{
  "id": "REQ-FUNC-001",
  "type": "functional",
  "category": "",
  "title": "Short title",
  "priority": "must",
  "description": "The system shall ...",
  "acceptanceCriteria": ["Given/When/Then"],
  "status": "draft",
  "source": "RFP Section N",
  "dependencies": [],
  "complianceFrameworks": []
}
```

---

### 4.3 SDS Template — `ecc-sdlc.sds.v2`

**File:** `templates/sds-template.json`
**Used by:** `/sds` command, technical-writer Mode B (pre-flight validation only)

**`dataContract.requiredFields`:**

```
projectName, clientName, preparedBy, generatedDate, documentVersion,
versionHistory, architectureOverviewParagraphs, architectureDecisionsNumbered,
designComponents, databaseSchemaIntroParagraphs, databaseTables, apiEndpoints,
integrationIntroParagraphs, integrationPointsBullets,
securityArchitectureParagraphs, securityAuthParagraphs,
securityAuthorizationParagraphs, securityDataProtectionParagraphs,
securityAuditLoggingParagraphs, traceabilityMatrixRows,
architectureDiagramLines, databaseErDiagramLines
```

**Table column contracts:**

| Section                   | Columns (keys)                                                |
| ------------------------- | ------------------------------------------------------------- |
| `versionHistory`          | `version`, `date`, `author`, `changes`, `status`              |
| `componentSpecifications` | `id`, `name`, `responsibility`, `interfaces`, `tracesToReq`   |
| `databaseTables`          | `table`, `primaryKey`, `fields`, `relationships`              |
| `apiContracts`            | `method`, `path`, `description`, `request`, `response`        |
| `traceabilityMatrix`      | `reqId`, `requirementTitle`, `designComponentIds`, `coverage` |

**SDS-specific field notes:**

- `architectureDiagramLines` — array of raw Mermaid lines for the architecture
  `flowchart TD` diagram. Each string is one line. No fences. The generate
  script embeds these as a styled code block.
- `databaseErDiagramLines` — array of raw Mermaid lines for the `erDiagram`.
  Same rules as above.
- `designComponents[*]` shape (template shape — distinct from state.json shape):
  ```json
  { "id": "DC-001", "name": "...", "responsibility": "...", "interfaces": "flat string", "tracesToReq": ["REQ-FUNC-001"] }
  ```
- `versionHistory[*]` must have at least one entry. The generate script
  prepends prior version rows from state.json via `_versionHistory`.

---

## 5. Mode A vs Mode B Contract

The technical-writer agent operates in exactly one of two modes per invocation.
The invoking command specifies the mode.

### Mode A — Full docxPlan (`/scope`, `/srs`)

Return a `docxPlan` object:

```json
{
  "docxPlan": {
    "templatePath": "templates/srs-template.json",
    "templateId": "ecc-sdlc.srs.v1",
    "resolvedTemplateSource": "project | user | plugin",
    "outputPath": ".sdlc/artifacts/srs-vN.docx",
    "generatedDate": "YYYY-MM-DD",
    "document": {
      "format": { "page": {}, "defaults": {}, "styles": {}, "header": {}, "footer": {} },
      "sections": []
    },
    "checks": {
      "tocIncluded": true,
      "versionHistoryIncluded": true,
      "headerFooterIncluded": true,
      "paginationEnabled": true
    },
    "validation": {
      "templateSchemaVersion": "ecc-sdlc.template.v1",
      "requiredFieldsSatisfied": [],
      "missingRequiredFields": []
    }
  }
}
```

In Mode A, the agent resolves all `{placeholder}` tokens in the document
sections using the data JSON. `{pageNumber}` and `{pageCount}` are left
unchanged — they are runtime tokens. Missing required fields get `"TBD"`
(string) or `["TBD"]` (array) defaults.

### Mode B — Pre-flight validation only (`/sds`, `/sts`)

Return a `validation` object only — no `docxPlan`, no document assembly:

```json
{
  "validation": {
    "templatePath": "templates/sds-template.json",
    "templateId": "ecc-sdlc.sds.v2",
    "resolvedTemplateSource": "project | user | plugin",
    "templateSchemaVersion": "ecc-sdlc.template.v1",
    "requiredFieldsSatisfied": ["projectName", "clientName", "..."],
    "missingRequiredFields": []
  }
}
```

In Mode B:

- The agent reads the template's `dataContract.requiredFields`.
- A field is **satisfied** if it exists in the data JSON and is not empty
  (not `null`, not `""`, not `[]`).
- A field is **missing** if it is absent or empty.
- **The agent writes no files.** The `.docx` is produced by the command's
  generate script (`generate-sds-doc.js`) from the validated data JSON.

---

## 6. Quality Validation Rules (Section 10.3)

After the agent returns its output and before document generation runs,
the following quality checks must be satisfiable. The agent must produce
data that will pass all of them:

| Check                     | Rule                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Schema compliance         | All data fields validated against their JSON schema using AJV                                        |
| Traceability coverage     | Every requirement has at least one forward link populated                                            |
| Completeness              | All `dataContract.requiredFields` are non-empty — no blank sections                                  |
| Consistency               | Terminology cross-checked against `.sdlc/glossary.json` if it exists                                 |
| Diagram validity          | All Mermaid lines in `architectureDiagramLines` / `databaseErDiagramLines` must parse without errors |
| Cross-reference integrity | All IDs (`REQ-*`, `DC-*`, `TC-*`) in the data must resolve to existing entries in state.json         |

**Completeness rule — never leave a required section empty:**
If the data for a required field is not available, the agent must insert
a `"TBD"` placeholder rather than omitting the field. An empty section
fails the quality gate.

---

## 7. Self-Check Before Returning Output

- [ ] Template resolved using the 3-tier order — `resolvedTemplateSource` recorded
- [ ] All `dataContract.requiredFields` are either satisfied or have `"TBD"` defaults
- [ ] `missingRequiredFields` is empty — or lists every truly missing field
- [ ] Table rows have every column key the template defines
- [ ] `{pageNumber}` and `{pageCount}` left unchanged (Mode A only)
- [ ] No file writes in Mode B — document assembly is the generate script's job
- [ ] `versionHistory` has at least one entry
- [ ] Mermaid arrays contain raw lines only — no ` ``` ` fences
