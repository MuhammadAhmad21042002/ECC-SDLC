'use strict';

/**
 * build-gantt.js
 *
 * Post-processes an estimate JSON file by injecting a `gantt` block based on
 * the effortBreakdown rows. Runs as pure Node.js — zero dependency on the
 * Estimator agent understanding the Gantt scheduling rules. Guarantees every
 * run of /estimate produces a Gantt Timeline sheet in the final .xlsx.
 *
 * CLI:
 *   node scripts/build-gantt.js --file <estimate-vN.json> [--start YYYY-MM-DD]
 *
 * Behaviour:
 *   - Reads estimatePlan.sheets.effortBreakdown
 *   - Groups rows by phase in strict order (discovery → ... → deployment)
 *   - Within a phase, schedules components per role sequentially (same role
 *     can't do two things at once), across roles in parallel
 *   - Skips Saturday and Sunday (business days only)
 *   - Writes the result back to the same file, adding estimatePlan.gantt
 *
 * Exit codes:
 *   0  gantt block added successfully (or already present — idempotent)
 *   1  bad args, unreadable file, or empty effortBreakdown
 */

const fs   = require('fs');
const path = require('path');

const PHASE_ORDER = [
  'discovery',
  'requirements',
  'design',
  'development',
  'testing',
  'deployment',
];

const PHASE_LABEL = {
  discovery:    'Discovery',
  requirements: 'Requirements',
  design:       'Design',
  development:  'Development',
  testing:      'Testing',
  deployment:   'Deployment',
};

const ROLE_ORDER = ['architect', 'seniorDev', 'juniorDev'];

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseIsoDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

function formatIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isBusinessDay(d) {
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

function addCalendarDays(d, n) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function nextBusinessDay(d) {
  let cursor = addCalendarDays(d, 1);
  while (!isBusinessDay(cursor)) cursor = addCalendarDays(cursor, 1);
  return cursor;
}

function firstBusinessDayOnOrAfter(d) {
  let cursor = new Date(d.getTime());
  while (!isBusinessDay(cursor)) cursor = addCalendarDays(cursor, 1);
  return cursor;
}

/**
 * Add N business days to a start date, returning the Nth business day.
 * addNBusinessDays(Mon, 1) = Mon (same day counts as day 1)
 * addNBusinessDays(Mon, 5) = Fri
 * addNBusinessDays(Fri, 2) = the following Monday
 */
function addNBusinessDays(start, n) {
  if (n <= 1) return firstBusinessDayOnOrAfter(start);
  let cursor = firstBusinessDayOnOrAfter(start);
  let remaining = n - 1;
  while (remaining > 0) {
    cursor = nextBusinessDay(cursor);
    remaining--;
  }
  return cursor;
}

function businessDaysBetweenInclusive(start, end) {
  if (!start || !end) return 0;
  let count = 0;
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    if (isBusinessDay(cursor)) count++;
    cursor = addCalendarDays(cursor, 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Build the Gantt schedule from effortBreakdown rows.
 * Returns { projectStartDate, projectEndDate, totalBusinessDays, startDateSource, tasks }.
 */
function buildGantt(effortBreakdown, projectStartIso, startDateSource) {
  const projectStart = firstBusinessDayOnOrAfter(parseIsoDate(projectStartIso));

  // Skip UNMAPPABLE rows (zero effort)
  const scheduled = effortBreakdown.filter(
    row => row.fpaType !== 'UNMAPPABLE' && Number(row.effortHours) > 0
  );

  // Collect phases that actually appear, in canonical order + any unknown trailing
  const seenPhases = new Set(scheduled.map(r => r.phase || 'development'));
  const orderedPhases = [
    ...PHASE_ORDER.filter(p => seenPhases.has(p)),
    ...[...seenPhases].filter(p => !PHASE_ORDER.includes(p)),
  ];

  const tasks = [];
  let phaseStart = projectStart;
  let phaseCounter = 1;
  let projectEnd = projectStart;

  for (const phase of orderedPhases) {
    const phaseRows = scheduled
      .filter(r => (r.phase || 'development') === phase)
      .sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(a.role || 'seniorDev');
        const rb = ROLE_ORDER.indexOf(b.role || 'seniorDev');
        if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        return String(a.componentId || '').localeCompare(String(b.componentId || ''));
      });

    if (phaseRows.length === 0) continue;

    // Schedule each role lane sequentially, across lanes in parallel
    const laneEndByRole = {};
    const laneCursorByRole = {};
    const componentTasks = [];
    let phaseEffortHours = 0;

    for (const row of phaseRows) {
      const role = row.role || 'seniorDev';
      if (!laneCursorByRole[role]) {
        laneCursorByRole[role] = phaseStart;
      }

      const componentDays = Math.max(1, Math.ceil(Number(row.effortHours) / 8));
      const laneStart = firstBusinessDayOnOrAfter(laneCursorByRole[role]);
      const laneEnd   = addNBusinessDays(laneStart, componentDays);

      componentTasks.push({
        id:            row.componentId || 'DC-???',
        name:          row.componentTitle || 'Unnamed component',
        phase:         phase,
        role:          role,
        startDate:     formatIsoDate(laneStart),
        endDate:       formatIsoDate(laneEnd),
        durationDays:  componentDays,
        effortHours:   Number(row.effortHours) || 0,
        isPhaseHeader: false,
      });

      // Next task in the same lane starts the business day after this one ends
      laneCursorByRole[role] = nextBusinessDay(laneEnd);
      laneEndByRole[role]    = laneEnd;
      phaseEffortHours      += Number(row.effortHours) || 0;
    }

    // Phase end = latest lane end across all roles in this phase
    const phaseEnd = Object.values(laneEndByRole).reduce(
      (max, d) => (d.getTime() > max.getTime() ? d : max),
      phaseStart
    );

    // Emit the phase header row FIRST, then its component rows
    const phaseDurationDays = businessDaysBetweenInclusive(phaseStart, phaseEnd);
    tasks.push({
      id:            `PHASE-${phaseCounter++}`,
      name:          PHASE_LABEL[phase] || phase,
      phase:         phase,
      role:          '',
      startDate:     formatIsoDate(phaseStart),
      endDate:       formatIsoDate(phaseEnd),
      durationDays:  phaseDurationDays,
      effortHours:   phaseEffortHours,
      isPhaseHeader: true,
    });
    tasks.push(...componentTasks);

    if (phaseEnd.getTime() > projectEnd.getTime()) projectEnd = phaseEnd;

    // Next phase starts the business day after this phase ends
    phaseStart = nextBusinessDay(phaseEnd);
  }

  return {
    projectStartDate: formatIsoDate(projectStart),
    projectEndDate:   formatIsoDate(projectEnd),
    totalBusinessDays: businessDaysBetweenInclusive(projectStart, projectEnd),
    startDateSource:  startDateSource,
    tasks:            tasks,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

function todayPlusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}

function main() {
  const args = process.argv.slice(2);
  const filePath = getArg(args, '--file');
  let   startIso = getArg(args, '--start');

  if (!filePath) {
    console.error('Usage: node scripts/build-gantt.js --file <estimate-vN.json> [--start YYYY-MM-DD]');
    process.exit(1);
  }

  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`ERR: file not found: ${absPath}`);
    process.exit(1);
  }

  let root;
  try {
    root = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    console.error(`ERR: cannot parse JSON: ${e.message}`);
    process.exit(1);
  }

  const plan = root.estimatePlan;
  if (!plan || !plan.sheets || !Array.isArray(plan.sheets.effortBreakdown)) {
    console.error('ERR: estimatePlan.sheets.effortBreakdown missing or not an array');
    process.exit(1);
  }
  if (plan.sheets.effortBreakdown.length === 0) {
    console.error('ERR: effortBreakdown is empty — nothing to schedule');
    process.exit(1);
  }

  let startDateSource;
  if (startIso && /^\d{4}-\d{2}-\d{2}$/.test(startIso)) {
    startDateSource = 'state.json';
  } else {
    startIso = todayPlusDays(7);
    startDateSource = 'default-fallback';
    console.error(`WARN: no valid --start supplied — defaulting projectStartDate to ${startIso}`);
  }

  plan.gantt = buildGantt(plan.sheets.effortBreakdown, startIso, startDateSource);

  fs.writeFileSync(absPath, JSON.stringify(root, null, 2));
  console.log(
    `Gantt injected: ${plan.gantt.tasks.length} tasks, ` +
    `${plan.gantt.projectStartDate} → ${plan.gantt.projectEndDate} ` +
    `(${plan.gantt.totalBusinessDays} business days, source: ${plan.gantt.startDateSource})`
  );
}

if (require.main === module) {
  main();
}

module.exports = { buildGantt };
