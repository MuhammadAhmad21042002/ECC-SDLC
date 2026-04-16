'use strict';

/**
 * validate-estimate.js
 *
 * Validates a completed estimatePlan JSON file produced by the Estimator agent.
 * Must exit 0 (PASSED) before any caller is permitted to update state.json.
 *
 * CLI:
 *   node scripts/validate-estimate.js --file <path-to-estimate-vN.json>
 *
 * Exit codes:
 *   0  All checks passed
 *   1  One or more validation errors found
 *   2  Bad arguments or unreadable file
 *
 * Checks performed:
 *   1. Top-level required fields present (templateId, projectId, sheets, totalFunctionPoints, totalEffortHours, totalCost)
 *   2. All three sheets present and non-empty (effortBreakdown, resourcePlan, costSummary)
 *   3. FP totals: sum(effortBreakdown.functionPoints) === totalFunctionPoints
 *   4. Effort hours totals: sum(effortBreakdown.effortHours) === totalEffortHours (±0.01h tolerance)
 *   5. Cost consistency: sum(resourcePlan.totalCost) === sum(costSummary role rows) (±0.01 tolerance)
 *   6. Role hours drift: sum(resourcePlan.totalHours) within ±2h of totalEffortHours
 *   7. Required keys present on every effortBreakdown row (12 keys)
 *   8. Required keys present on every resourcePlan row (8 keys)
 *   9. Required keys present on every costSummary row (4 keys)
 *  10. FPA table accuracy: every non-UNMAPPABLE row has the exact function point count
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// FPA reference table — source of truth, matches agents/estimator.md §1
// ---------------------------------------------------------------------------

const FPA_TABLE = {
  EI:  { simple: 3, average: 4,  complex: 6  },
  EO:  { simple: 4, average: 5,  complex: 7  },
  EQ:  { simple: 3, average: 4,  complex: 6  },
  ILF: { simple: 7, average: 10, complex: 15 },
  EIF: { simple: 5, average: 7,  complex: 10 },
};

// ---------------------------------------------------------------------------
// Required field lists — must match agents/estimator.md §8 output structure
// ---------------------------------------------------------------------------

const REQUIRED_TOP_LEVEL = [
  'templateId', 'projectId', 'projectName', 'clientName',
  'generatedDate', 'currency',
  'totalFunctionPoints', 'totalEffortHours', 'totalCost',
  'sheets',
];

const REQUIRED_EFFORT_BREAKDOWN_KEYS = [
  'componentId', 'componentTitle', 'componentType',
  'fpaType', 'fpaTypeFullName', 'complexity',
  'functionPoints', 'hoursPerFP', 'effortHours',
  'role', 'phase', 'requirementIds', 'notes',
];

const REQUIRED_RESOURCE_PLAN_KEYS = [
  'role', 'roleLabel', 'allocationPct',
  'totalHours', 'storyPoints', 'hourlyRate', 'currency', 'totalCost',
];

const REQUIRED_COST_SUMMARY_KEYS = [
  'category', 'description', 'currency', 'subtotal',
];

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

function validate(plan) {
  const errors = [];

  // Check 1 — top-level required fields
  REQUIRED_TOP_LEVEL.forEach(key => {
    if (!(key in plan)) {
      errors.push(`estimatePlan missing required top-level field: "${key}"`);
    }
  });

  // If sheets is missing we cannot run further checks safely
  if (!plan.sheets || typeof plan.sheets !== 'object') {
    errors.push('estimatePlan.sheets is missing or not an object — cannot continue validation');
    return errors;
  }

  const { effortBreakdown, resourcePlan, costSummary } = plan.sheets;

  // Check 2 — all three sheets present and non-empty arrays
  if (!Array.isArray(effortBreakdown) || effortBreakdown.length === 0) {
    errors.push('estimatePlan.sheets.effortBreakdown is missing or empty');
  }
  if (!Array.isArray(resourcePlan) || resourcePlan.length === 0) {
    errors.push('estimatePlan.sheets.resourcePlan is missing or empty');
  }
  if (!Array.isArray(costSummary) || costSummary.length === 0) {
    errors.push('estimatePlan.sheets.costSummary is missing or empty');
  }

  // Cannot run numeric checks if any sheet is absent
  if (errors.length > 0) return errors;

  // Check 3 — FP totals match
  const fpSum = effortBreakdown.reduce((s, r) => s + (r.functionPoints || 0), 0);
  if (fpSum !== plan.totalFunctionPoints) {
    errors.push(
      `totalFunctionPoints mismatch: effortBreakdown sums to ${fpSum}, ` +
      `header says ${plan.totalFunctionPoints}`
    );
  }

  // Check 4 — effort hours match (float tolerance ±0.01h)
  const hrSum = effortBreakdown.reduce((s, r) => s + (r.effortHours || 0), 0);
  if (Math.abs(hrSum - plan.totalEffortHours) >= 0.01) {
    errors.push(
      `totalEffortHours mismatch: effortBreakdown sums to ${hrSum}, ` +
      `header says ${plan.totalEffortHours}`
    );
  }

  // Check 5 — resource plan total cost matches cost summary role rows (±0.01)
  const rpCost = resourcePlan.reduce((s, r) => s + (r.totalCost || 0), 0);
  const csCost = costSummary
    .filter(r => r.category !== 'GRAND TOTAL' && r.category !== 'Contingency')
    .reduce((s, r) => s + (r.subtotal || 0), 0);
  if (Math.abs(rpCost - csCost) >= 0.01) {
    errors.push(
      `Cost mismatch: resourcePlan total=${rpCost}, ` +
      `costSummary role rows total=${csCost}`
    );
  }

  // Check 6 — role hours drift within ±2h
  const roleHoursSum = resourcePlan.reduce((s, r) => s + (r.totalHours || 0), 0);
  if (Math.abs(roleHoursSum - plan.totalEffortHours) > 2) {
    errors.push(
      `Role hours drift: resourcePlan totalHours sum=${roleHoursSum} vs ` +
      `totalEffortHours=${plan.totalEffortHours} (tolerance ±2h exceeded)`
    );
  }

  // Check 7 — required keys in every effortBreakdown row
  effortBreakdown.forEach((row, i) => {
    REQUIRED_EFFORT_BREAKDOWN_KEYS.forEach(k => {
      if (!(k in row)) {
        errors.push(`effortBreakdown[${i}] (${row.componentId || '?'}) missing required key: "${k}"`);
      }
    });
  });

  // Check 8 — required keys in every resourcePlan row
  resourcePlan.forEach((row, i) => {
    REQUIRED_RESOURCE_PLAN_KEYS.forEach(k => {
      if (!(k in row)) {
        errors.push(`resourcePlan[${i}] (${row.role || '?'}) missing required key: "${k}"`);
      }
    });
  });

  // Check 9 — required keys in every costSummary row
  costSummary.forEach((row, i) => {
    REQUIRED_COST_SUMMARY_KEYS.forEach(k => {
      if (!(k in row)) {
        errors.push(`costSummary[${i}] (${row.category || '?'}) missing required key: "${k}"`);
      }
    });
  });

  // Check 11 — Gantt schedule (optional block; only validated if present)
  if (plan.gantt !== undefined) {
    const g = plan.gantt;
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    if (!g || typeof g !== 'object') {
      errors.push('estimatePlan.gantt is present but not an object');
    } else {
      if (!ISO_RE.test(g.projectStartDate || '')) {
        errors.push(`gantt.projectStartDate invalid or missing: "${g.projectStartDate}"`);
      }
      if (!ISO_RE.test(g.projectEndDate || '')) {
        errors.push(`gantt.projectEndDate invalid or missing: "${g.projectEndDate}"`);
      }
      if (!Array.isArray(g.tasks) || g.tasks.length === 0) {
        errors.push('gantt.tasks is missing or empty');
      } else {
        // Per-task checks
        g.tasks.forEach((t, i) => {
          if (!t.id)   errors.push(`gantt.tasks[${i}] missing "id"`);
          if (!t.name) errors.push(`gantt.tasks[${i}] (${t.id || '?'}) missing "name"`);
          if (!ISO_RE.test(t.startDate || '')) {
            errors.push(`gantt.tasks[${i}] (${t.id || '?'}) invalid startDate: "${t.startDate}"`);
          }
          if (!ISO_RE.test(t.endDate || '')) {
            errors.push(`gantt.tasks[${i}] (${t.id || '?'}) invalid endDate: "${t.endDate}"`);
          }
          if (ISO_RE.test(t.startDate || '') && ISO_RE.test(t.endDate || '') && t.startDate > t.endDate) {
            errors.push(
              `gantt.tasks[${i}] (${t.id || '?'}) startDate "${t.startDate}" is after endDate "${t.endDate}"`
            );
          }
        });

        // Phase headers must be strictly sequential — each phase starts on or after the previous phase's endDate
        const phaseHeaders = g.tasks.filter(t => t.isPhaseHeader === true);
        for (let i = 1; i < phaseHeaders.length; i++) {
          const prev = phaseHeaders[i - 1];
          const curr = phaseHeaders[i];
          if (prev.endDate && curr.startDate && curr.startDate < prev.endDate) {
            errors.push(
              `gantt phase ordering broken: "${curr.id}" starts ${curr.startDate} ` +
              `before previous phase "${prev.id}" ends ${prev.endDate}`
            );
          }
        }
      }
    }
  }

  // Check 10 — FPA table accuracy for all non-UNMAPPABLE rows
  effortBreakdown.forEach((row, i) => {
    if (row.fpaType === 'UNMAPPABLE') return;

    const typeTable = FPA_TABLE[row.fpaType];
    if (!typeTable) {
      errors.push(
        `effortBreakdown[${i}] (${row.componentId}): unknown fpaType "${row.fpaType}" — ` +
        `valid types: ${Object.keys(FPA_TABLE).join(', ')}`
      );
      return;
    }

    const expected = typeTable[row.complexity];
    if (expected === undefined) {
      errors.push(
        `effortBreakdown[${i}] (${row.componentId}): unknown complexity "${row.complexity}" ` +
        `for fpaType "${row.fpaType}" — valid values: simple, average, complex`
      );
      return;
    }

    if (row.functionPoints !== expected) {
      errors.push(
        `effortBreakdown[${i}] (${row.componentId}): functionPoints=${row.functionPoints} ` +
        `but FPA table says ${expected} for ${row.fpaType} ${row.complexity}`
      );
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('Usage: node scripts/validate-estimate.js --file <path-to-estimate-vN.json>');
    process.exit(2);
  }

  const absPath = path.resolve(process.cwd(), args.file);

  if (!fs.existsSync(absPath)) {
    console.error(`ERR: file not found: ${absPath}`);
    process.exit(2);
  }

  let root;
  try {
    root = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (err) {
    console.error(`ERR: cannot parse JSON at ${absPath}: ${err.message}`);
    process.exit(2);
  }

  if (!root.estimatePlan || typeof root.estimatePlan !== 'object') {
    console.error('ERR: file does not contain a top-level "estimatePlan" object');
    process.exit(1);
  }

  const errors = validate(root.estimatePlan);

  if (errors.length > 0) {
    console.error(`VALIDATION FAILED — ${errors.length} error(s):`);
    errors.forEach((e, i) => console.error(`  [${i + 1}] ${e}`));
    process.exit(1);
  }

  const plan = root.estimatePlan;
  const sheets = plan.sheets;
  console.log(
    `VALIDATION PASSED — ` +
    `${sheets.effortBreakdown.length} components, ` +
    `${plan.totalFunctionPoints} FP, ` +
    `${plan.totalEffortHours}h, ` +
    `${plan.currency}${plan.totalCost}`
  );
}

main();
