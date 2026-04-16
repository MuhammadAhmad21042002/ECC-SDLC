---
name: sdlc-estimation
description: >
  Function Point Analysis (FPA) methodology for ECC-SDLC. Load this skill
  when running the estimator agent during /estimate. Provides the complete
  FPA value table, DC-type to FPA-type mapping, complexity algorithm, hours
  per function point, story point conversion, and rate card format — so the
  estimator reads values from a fixed source and produces identical FP counts
  on identical inputs across all sessions.
---

# SDLC Estimation Skill

## Purpose

This skill is a deterministic lookup reference for the Estimator agent during
`/estimate`. It provides the complete Function Point Analysis methodology,
the FPA value table, story point sizing scale, and rate card format so that
the agent reads these values from a fixed source rather than recalling them —
guaranteeing identical FP counts on identical inputs across all runs.

---

## When to Use

Load this skill when:

- Running `/estimate` to generate the cost model and resource plan
- Validating FP counts produced by a previous session
- Reviewing or populating the rate card in `state.json`

---

## 1. FPA Methodology — 5-Step Process

Execute these steps in order. Do not skip any step.

1. **Identify boundary** — Draw the boundary between the system under
   estimation and all external entities (users, external systems, existing
   data stores outside the project scope).
2. **Identify EIs, EOs, EQs, ILFs, and EIFs** — Classify every function
   crossing the boundary by type using the DC Type → FPA Type mapping in
   Section 6.
3. **Classify each by complexity** — Apply the complexity algorithm in
   Section 3 to assign simple, average, or complex to each function.
4. **Look up FP value from table** — Read the exact integer from the Function
   Point Type Table in Section 2. Never recall from memory or approximate.
5. **Sum total FP count** — Add all individual function points to produce
   `totalFunctionPoints`.

---

## 2. Function Point Type Table

**Always read values from this table. Never approximate or round FP counts.**

| Type | Full Name | Simple | Average | Complex |
| ---- | --------- | ------ | ------- | ------- |
| EI | External Input | 3 | 4 | 6 |
| EO | External Output | 4 | 5 | 7 |
| EQ | External Inquiry | 3 | 4 | 6 |
| ILF | Internal Logical File | 7 | 10 | 15 |
| EIF | External Interface File | 5 | 7 | 10 |

All 15 combinations are valid. Any type/complexity pair not in this table is
an error — flag it explicitly and stop processing that component.

---

## 3. Complexity Determination

If the design component includes a `complexity` field, use it directly.
Valid values: `simple` | `average` | `complex`.

If `complexity` is absent, derive it from this algorithm:

```text
score = interfaces.length + responsibilities.length + dataStores.length

score 0–3  →  simple
score 4–7  →  average
score 8+   →  complex
```

Apply only the first matching range. The same input must produce the same
complexity on every run.

---

## 4. Hours per Function Point

| Role | Hours / FP | Seniority Label |
| ---- | ---------- | --------------- |
| juniorDev | 12 h/FP | Junior Developer |
| seniorDev | 8 h/FP | Senior Developer |
| architect | 6 h/FP | Solution Architect |

Default when `component.assignedRole` is absent or invalid: **seniorDev** (8 h/FP).

Story point formula (seniorDev baseline only):

```text
storyPoints = Math.ceil(effortHours / 8)
```

`Math.ceil` is the only rounding permitted in the entire estimation workflow.

---

## 5. Story Point Conversion Scale

This Fibonacci scale is the project-wide reference for JIRA ticket sizing.
Use it when converting resource plan hours into sprint-planning story points.

| Story Points | Equivalent Effort |
| ------------ | ----------------- |
| 1 SP | 2 hours |
| 2 SP | 4 hours |
| 3 SP | 1 full day (8 hours) |
| 5 SP | 1.5 days (12 hours) |
| 8 SP | 2 days (16 hours) |
| 13 SP | 3 days (24 hours) |

---

## 6. DC Type to FPA Type Mapping

| DC Type | FPA Type | Rationale |
| ------- | -------- | --------- |
| `api` | EO or EQ | Default EO. Use EQ only if all interfaces are `kind: db` and no write verbs appear in responsibilities |
| `ui` | EI or EQ | Default EI. Use EQ only if all responsibilities are display/read-only with no form submit or mutation verbs |
| `database` | ILF | Internal data store |
| `integration` | EIF | External system connection |
| `service` | EO | Produces outputs consumed by other components |
| `module` | EI | Processes and transforms inputs |
| `component` | EI | Handles user-facing input processing |
| `job` | EI | Batch data input processing |
| `infra` | UNMAPPABLE | No FPA equivalent — flag and set FP to 0 |
| `library` | UNMAPPABLE | Not transactional — flag and set FP to 0 |
| `other` | UNMAPPABLE | Insufficient detail — flag and set FP to 0 |

**EI vs EQ disambiguation (apply in order):**

1. If any interface has `kind` outside `["db"]`, or any responsibility contains
   a write verb (`create`, `update`, `delete`, `submit`, `insert`, `patch`,
   `post`, `write`, `save`, `remove`) → use **EI**.
2. If all interfaces are `kind: db` and no responsibility contains a write
   verb → use **EQ**.
3. If both arrays are empty → use the DC type default (EO for `api`, EI for `ui`).

---

## 7. Rate Card Format

The rate card is stored in `state.json` under the `rateCard` key. Each role
key maps to an object with `hourlyRate` (number) and `currency` (string).

```json
{
  "rateCard": {
    "juniorDev":  { "hourlyRate": 25,  "currency": "USD" },
    "seniorDev":  { "hourlyRate": 50,  "currency": "USD" },
    "architect":  { "hourlyRate": 75,  "currency": "USD" }
  }
}
```

**Rate card rules:**

- Never approximate or round `hourlyRate` values.
- Never blend rates across roles.
- If a role key is missing, flag it: `FLAGGED: rateCard.{role} not found in state.json` and set that role's cost to 0.
- `contingencyPct` is an optional whole number (e.g., `10` = 10%). Formula: `grandTotal * (contingencyPct / 100)`.

---

## 8. Default Role Allocations

When `state.json.roleAllocations` is absent, use:

| Role | Default Allocation |
| ---- | ------------------ |
| architect | 15% |
| seniorDev | 60% |
| juniorDev | 25% |

Override by setting `state.json.roleAllocations` with decimal values that sum
to `1.0` (e.g., `{ "architect": 0.15, "seniorDev": 0.60, "juniorDev": 0.25 }`).

---

## 9. Key Rules

- Always use the FPA table in Section 2 — never recall values from memory.
- The only permitted rounding is `Math.ceil()` on story point computation.
- Never blend hourly rates across roles.
- The same design component must produce the same FP count on every run.
- Run the validation script in `agents/estimator.md` Section 9 before
  updating `state.json` — do not advance to Step 10 if it exits non-zero.
- UNMAPPABLE components must appear in `estimatePlan.unmappableComponents`
  and must not contribute to `totalFunctionPoints`.
