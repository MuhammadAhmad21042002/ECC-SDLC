---
name: proposal
description: >
  Assembles a complete, client-ready 9-section proposal.docx from all upstream
  SDLC artifacts (scope, SRS, SDS, STS, estimate, compliance). Halts immediately
  if any required artifact is missing, naming it explicitly. Zero placeholder
  text guaranteed.
---

# /proposal — Technical Proposal Generator

## Purpose

`/proposal` produces:

- `.sdlc/artifacts/proposal-vN.docx` — client-ready proposal rendered from `templates/proposal-template.json`
- `.sdlc/state.json` update — `artifacts.proposal` registered with path, version, hash

This command runs after `/estimate` (and ideally after `/compliance`).

---

## Preconditions

Read `.sdlc/state.json` and **stop immediately** if any of the following are null or absent.  
Name the specific missing artifact in the error — never a generic message.

| Artifact | Required? | Error if missing |
|---|---|---|
| `artifacts.scope` | ✅ | "Cannot generate proposal: scope artifact is missing from state.json. Run /scope first." |
| `artifacts.srs` | ✅ | "Cannot generate proposal: srs artifact is missing from state.json. Run /srs first." |
| `artifacts.sds` | ✅ | "Cannot generate proposal: sds artifact is missing from state.json. Run /sds first." |
| `artifacts.estimate` | ✅ | "Cannot generate proposal: estimate artifact is missing from state.json. Run /estimate first." |

Check all four in the order above. Report the **first** null artifact found and halt.

---

## Orchestration Steps

### Step 0 — Resolve ECC runtime root (Bash — one call)

Use the same root-resolution pattern as `/scope`, `/srs`, and `/sds`.

Runtime must include:
- `scripts/generate-proposal-doc.js`
- `lib/doc-generator/proposal-render-data.js`
- `templates/proposal-template.json`
- `node_modules/docx/package.json`

If not found → stop with `ECC_ROOT_NOT_FOUND`.

---

### Step 1 — Load state and compute next version (Read tool — no Bash)

Read `.sdlc/state.json` and capture:

- `projectId` (preserve exactly)
- `projectName`, `clientName`
- `eccRoot`
- `requirements[]` (for win-theme extraction)
- `designComponents[]` (for technical approach)
- `complianceFlags[]` (for compliance statement)
- `artifacts.*` — all upstream paths
- `artifacts.proposal.version` (default 0 if null)

Compute `nextVersion = (artifacts.proposal.version || 0) + 1`.

If Step 0 resolved a new root, write back `eccRoot` now.

---

### Step 2 — Prerequisite artifact check (HALT GATE)

Before invoking any agent:

```
if artifacts.scope   is null → HALT: "Cannot generate proposal: scope artifact is missing from state.json. Run /scope first."
if artifacts.srs     is null → HALT: "Cannot generate proposal: srs artifact is missing from state.json. Run /srs first."
if artifacts.sds     is null → HALT: "Cannot generate proposal: sds artifact is missing from state.json. Run /sds first."
if artifacts.estimate is null → HALT: "Cannot generate proposal: estimate artifact is missing from state.json. Run /estimate first."
```

Stop here. Do not invoke any agent. Do not write any file.

---

### Step 3 — Invoke Proposal Writer agent (Agent: proposal-writer + sdlc-proposal skill)

Invoke `proposal-writer` with:

- Full `state.json` content
- Contents of all upstream artifact files (scope, SRS, SDS, estimate)
- Instruction to apply `skills/sdlc-proposal/SKILL.md`

Require strict JSON output matching `templates/proposal-template.json` data contract.

No markdown wrappers. No prose. No explanation text.

The agent MUST:
- Extract win themes from top-3 `must`-priority requirements
- Source all cost figures exclusively from `artifacts.estimate` — never independently calculated
- Name `SBP-2024` and/or `PPRA-2024` explicitly in `complianceStatementParagraphs`
- Produce zero banned phrases: `TBD`, `N/A`, `to be determined`, `not available`, `placeholder`, `insert here`, `coming soon`
- **Team profiles sourcing:** If `state.teamProfiles` is a non-empty array, pass its entries VERBATIM into the `teamProfiles` output field (`name`, `role`, `yearsExperience`, `relevantProjects`) — do NOT invent, rename, re-order, or modify any profile data. Only synthesize plausible profile rows when `state.teamProfiles` is empty or absent, and in that case flag each synthesized row for user review.

Write agent output to temporary file:

```bash
mkdir -p .sdlc/tmp
# write proposal-writer JSON output to:
# .sdlc/tmp/proposal-data.json
```

**`.sdlc/state.json` is NOT modified at this point.**

---

### Step 4 — Banned-phrase pre-flight check (Bash)

Before generating the docx, run a grep against the tmp file:

```bash
node -e "
const fs = require('fs');
const BANNED = ['tbd','n/a','to be determined','not available','placeholder','insert here','coming soon'];
const content = fs.readFileSync('.sdlc/tmp/proposal-data.json', 'utf8').toLowerCase();
const hits = BANNED.filter(b => content.includes(b));
if (hits.length > 0) {
  console.error('ERR:BANNED_PHRASES: ' + hits.join(', '));
  process.exit(1);
}
console.log('Banned-phrase check passed.');
"
```

If banned phrases found:
- Delete `.sdlc/tmp/proposal-data.json`
- Report to user: which phrases were found and in which sections
- Stop — do not generate docx

---

### Step 5 — Generate `proposal-vN.docx` (Bash)

```bash
node "<ECC_ROOT>/scripts/generate-proposal-doc.js" \
  --data   ".sdlc/tmp/proposal-data.json" \
  --out    ".sdlc/artifacts/proposal-v<nextVersion>.docx" \
  --template "<ECC_ROOT>/templates/proposal-template.json" \
  --version  "<nextVersion>" \
  --state  ".sdlc/state.json"
```

On success, compute file hash: `sha256:<hex>`

```bash
sha256sum ".sdlc/artifacts/proposal-v<nextVersion>.docx"
```

Clean up:

```bash
rm -f .sdlc/tmp/proposal-data.json
```

---

### Step 6 — Section completeness verification (Bash)

After docx generation, verify all 9 required sections are present by re-reading
the proposal-data.json fields against `proposal-template.json` required sections.

The 9 required sections (by template key) are:

1. `executiveSummary`
2. `understandingOfRequirement`
3. `proposedSolution`
4. `technicalApproach`
5. `teamProfiles`
6. `projectTimeline`
7. `costBreakdown`
8. `complianceStatement`
9. `appendices`

If any required section key maps to an empty array or null in the generated
data, report the missing section and stop.

---

### Step 7 — Atomic state update (Write tool — no Bash)

Update `artifacts.proposal`:

```json
{
  "path": ".sdlc/artifacts/proposal-v{nextVersion}.docx",
  "version": "{nextVersion}",
  "hash": "sha256:<hex>",
  "templateId": "ecc-sdlc.proposal.v1",
  "createdAt": "<original createdAt or now on first run>",
  "updatedAt": "<now>",
  "versionHistory": [
    {
      "version": "{nextVersion}.0",
      "date": "YYYY-MM-DD",
      "author": "ECC-SDLC",
      "changes": "Proposal assembled from scope, SRS, SDS, estimate artifacts",
      "status": "Draft"
    }
  ]
}
```

Append to existing `versionHistory` — never replace prior entries.

Also update:
- `currentPhase` → `"proposal"`
- `phaseHistory` — mark preceding phase complete, add proposal phase entry

---

### Step 8 — Report completion

Return:

```
SDLC:PROPOSAL:COMPLETE:[projectName]:proposal-v{nextVersion}.docx — 9 sections assembled, zero banned phrases, ready for client submission
```

---

## Error Handling

| Error | Action |
|---|---|
| `ECC_ROOT_NOT_FOUND` | Set `CLAUDE_PLUGIN_ROOT` or run `npm install` in ECC repo |
| Any artifact null | HALT immediately — name the specific missing artifact |
| `ERR:BANNED_PHRASES` | Delete tmp file, report phrases found, stop |
| Doc generation failure | Report `ERR:*` from generator and stop |
| Section completeness failure | Report missing section, stop |
| State write failure | Stop, do not register artifact |

---

## Cost Sourcing (MANDATORY CONSTRAINT)

All numeric values in `costBreakdown` and `paymentSchedule` sections MUST be
sourced exclusively from `state.json.artifacts.estimate`.

The Proposal Writer agent is explicitly instructed not to calculate or estimate
costs independently. If estimate artifact content is unavailable or unparseable,
the command halts at Step 2 (estimate is a required artifact).

---

## Compliance Verification

The `complianceStatement` section MUST explicitly name the applicable regulatory
frameworks. Based on client context detected from `state.json`:

- Pakistani government procurement → `PPRA-2024`
- Pakistani banking → `SBP-2024`
- GCC banking → `SAMA` / `CBUAE` / `CBK` (as applicable)

The compliance-checker agent's `complianceFlags[]` from state.json are the
authoritative source for which frameworks apply.

---

## Related Files

- `agents/proposal-writer.md`
- `scripts/generate-proposal-doc.js`
- `lib/doc-generator/proposal-render-data.js`
- `templates/proposal-template.json`
- `skills/sdlc-proposal/SKILL.md`
- `schemas/proposal-data.schema.json` *(recommended — mirrors requirement.schema.json pattern)*
