'use strict';

/**
 * generate-xlsx.js
 *
 * Standalone ExcelJS financial model generator for ECC-SDLC.
 * Produces a 3-sheet .xlsx from a structured estimatePlan JSON payload
 * that matches the Estimator agent output format.
 *
 * CLI:
 *   node scripts/generate-xlsx.js \
 *     --template templates/estimation-template.json \
 *     --data     <estimatePlan JSON path> \
 *     --output   <output .xlsx path>
 *
 * Module:
 *   const { generateXlsx } = require('./scripts/generate-xlsx');
 *   await generateXlsx(templatePath, dataPath, outputPath);
 */

const fs   = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildGantt } = require('./build-gantt');

// ---------------------------------------------------------------------------
// Column indices (1-based) — must match templates/estimation-template.json
// ---------------------------------------------------------------------------

// Resource Plan: A=role(1) … H=hourlyRate(8) … J=totalCost(10)
const RP_HOURLY_RATE_COL = 8;

// Effort by Phase: A=phase(1), B=role(2) … K=effortHours(11)
const EB_ROLE_COL        = 2;
const EB_EFFORT_HRS_COL  = 11;

// Cost Summary: A=category(1), B=description(2), C=currency(3), D=subtotal(4)
const CS_SUBTOTAL_COL    = 4;

// Column format values that should default to 0 (not '') when a payload field is null/undefined.
// Empty strings in numeric cells cause SUMPRODUCT to return #VALUE! in Excel.
const NUMERIC_FORMATS = new Set(['decimal1', 'integer', 'currency', 'pct']);

// Gantt sheet — static columns before the dynamic calendar grid
const GANTT_STATIC_COLS = [
  { key: 'id',            header: 'ID',             widthChars: 12 },
  { key: 'task',          header: 'Task',           widthChars: 38 },
  { key: 'phase',         header: 'Phase',          widthChars: 16 },
  { key: 'role',          header: 'Role',           widthChars: 16 },
  { key: 'startDate',     header: 'Start',          widthChars: 12 },
  { key: 'endDate',       header: 'End',            widthChars: 12 },
  { key: 'durationDays',  header: 'Days',           widthChars: 8, format: 'integer' },
  { key: 'effortHours',   header: 'Effort (h)',     widthChars: 12, format: 'decimal1' },
];

// Role → fill colour (ARGB hex) for Gantt bar cells
const GANTT_ROLE_COLORS = {
  architect: 'FF4F81BD', // blue
  seniorDev: 'FF4CAF50', // green
  juniorDev: 'FFFFC107', // amber
};
const GANTT_PHASE_HEADER_COLOR = 'FFD3D3D3'; // light grey
const GANTT_DEFAULT_BAR_COLOR  = 'FF9E9E9E'; // fallback grey

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a 1-based column index to an Excel letter (A, B, …, Z, AA, …). */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Add a bold header row (row 1) to a worksheet using the template column list.
 * Sets column keys and widths as a side-effect.
 */
function addHeaderRow(ws, cols) {
  // Set column keys and widths (no header property — we control row 1 manually)
  ws.columns = cols.map(c => ({ key: c.key, width: c.widthChars }));

  const headerValues = {};
  cols.forEach(c => { headerValues[c.key] = c.header; });
  const row = ws.addRow(headerValues);
  row.font = { bold: true };
  return row; // row.number === 1
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

/**
 * Build the "Resource Plan" sheet.
 * Returns the number of data rows written (excludes header and TOTAL rows).
 */
function buildResourcePlanSheet(ws, templateSheet, resourcePlan) {
  const cols = templateSheet.columns;
  addHeaderRow(ws, cols);

  resourcePlan.forEach(rowData => {
    const row = {};
    cols.forEach(c => {
      const v = rowData[c.key];
      row[c.key] = v != null ? v : (NUMERIC_FORMATS.has(c.format) ? 0 : '');
    });
    ws.addRow(row);
  });

  const nData       = resourcePlan.length;
  const lastDataRow = nData + 1; // header(1) + data rows

  // TOTAL row with SUM formulas for designated columns
  const totalRow = ws.addRow({ [cols[0].key]: 'TOTAL' });
  totalRow.font = { bold: true };

  templateSheet.totalsRow.sumColumns.forEach(colKey => {
    const colIdx = cols.findIndex(c => c.key === colKey) + 1;
    const col    = colLetter(colIdx);
    totalRow.getCell(colIdx).value = { formula: `SUM(${col}2:${col}${lastDataRow})` };
  });

  return nData;
}

/**
 * Build the "Effort by Phase" sheet.
 * Rows without a role field are assigned the dominant role from the Resource Plan.
 * Returns the number of data rows written.
 */
function buildEffortByPhaseSheet(ws, templateSheet, effortBreakdown, dominantRole) {
  const cols = templateSheet.columns;
  addHeaderRow(ws, cols);

  // Sort by phase then role per template specification
  const sorted = [...effortBreakdown].sort((a, b) => {
    const pc = String(a.phase || '').localeCompare(String(b.phase || ''));
    return pc !== 0 ? pc : String(a.role || '').localeCompare(String(b.role || ''));
  });

  sorted.forEach(rowData => {
    const row = {};
    cols.forEach(c => {
      if (c.key === 'role' && !rowData.role) {
        console.warn(
          `[generate-xlsx] WARNING: effortBreakdown row "${rowData.componentId}" has no role field — ` +
          `substituting dominantRole "${dominantRole}". ` +
          `Fix: ensure the Estimator agent populates role on every effortBreakdown row.`
        );
        row[c.key] = dominantRole;
      } else {
        const v = rowData[c.key];
        row[c.key] = v != null ? v : (NUMERIC_FORMATS.has(c.format) ? 0 : '');
      }
    });
    ws.addRow(row);
  });

  const nData       = sorted.length;
  const lastDataRow = nData + 1;

  const totalRow = ws.addRow({ [cols[0].key]: 'TOTAL' });
  totalRow.font = { bold: true };

  templateSheet.totalsRow.sumColumns.forEach(colKey => {
    const colIdx = cols.findIndex(c => c.key === colKey) + 1;
    const col    = colLetter(colIdx);
    totalRow.getCell(colIdx).value = { formula: `SUM(${col}2:${col}${lastDataRow})` };
  });

  return nData;
}

/**
 * Build the "Cost Summary" sheet with 5 named line items.
 *
 * Row layout (after header at row 1):
 *   Row 2 — effortCost      : SUMPRODUCT formula (Effort by Phase × VLOOKUP Resource Plan)
 *   Row 3 — infrastructureCost : manual input value (default 0)
 *   Row 4 — licenseCost        : manual input value (default 0)
 *   Row 5 — contingency        : formula  = G2 * contingencyRate
 *   Row 6 — grandTotal         : formula  = SUM(G2:G5)
 *
 * All formula cells use ExcelJS { formula: '...' } syntax — no hardcoded numeric values.
 */
function buildCostSummarySheet(ws, templateSheet, plan, ebRowCount) {
  const cols = templateSheet.columns;
  addHeaderRow(ws, cols);

  const ebLastDataRow   = ebRowCount + 1; // header(1) + N data rows
  const ebRoleCol       = colLetter(EB_ROLE_COL);
  const ebHoursCol      = colLetter(EB_EFFORT_HRS_COL);
  const stCol           = colLetter(CS_SUBTOTAL_COL);
  const contingencyRate = (plan.contingencyPct != null ? plan.contingencyPct : 10) / 100;
  const infraCost       = plan.infrastructureCost || 0;
  const licenseCost     = plan.licenseCost        || 0;
  const currency        = plan.currency           || 'USD';

  // Bound the Resource Plan lookup range to data rows only (exclude header row 1 and TOTAL row).
  // Using a bounded range instead of full-column $A:$I improves compatibility with Excel 2016
  // and Google Sheets, where full-column references inside SUMPRODUCT can behave unexpectedly.
  const rpRowCount    = (plan.sheets.resourcePlan || []).length;
  const rpLastDataRow = rpRowCount > 0 ? rpRowCount + 1 : 2;

  // effortCost: SUMPRODUCT(effortHours * INDEX/MATCH(role → hourlyRate))
  // Uses INDEX/MATCH instead of VLOOKUP. The MATCH lookup_value is wrapped in
  // IF(1, range) to prevent Excel 365 from inserting the implicit intersection
  // operator (@) before the range reference. Plain range refs as MATCH/VLOOKUP
  // first args get @-prefixed in non-spill context, collapsing the array to a
  // single value and breaking SUMPRODUCT. IF(1, range) returns the same array
  // but as an expression result that Excel leaves intact.
  const rpRateCol = colLetter(RP_HOURLY_RATE_COL); // column I in Resource Plan (hourlyRate)
  const effortCostFormula =
    `SUMPRODUCT(('Effort by Phase'!$${ebHoursCol}$2:$${ebHoursCol}$${ebLastDataRow})*` +
    `IFERROR(INDEX('Resource Plan'!$${rpRateCol}$2:$${rpRateCol}$${rpLastDataRow},` +
    `MATCH(IF(1,'Effort by Phase'!$${ebRoleCol}$2:$${ebRoleCol}$${ebLastDataRow}),` +
    `'Resource Plan'!$A$2:$A$${rpLastDataRow},0)),0))`;

  // Row 2 — effortCost
  const r2 = ws.addRow({
    category:    'Development Effort',
    description: 'Total cost of all billed role hours across all phases',
    currency,
    subtotal:    null
  });
  r2.getCell(CS_SUBTOTAL_COL).value = { formula: effortCostFormula };

  // Row 3 — infrastructureCost (manual input — leave as plain numeric for human editing)
  ws.addRow({
    category:    'Infrastructure',
    description: 'Hosting, cloud, server, and DevOps infrastructure costs',
    currency,
    subtotal:    infraCost
  });

  // Row 4 — licenseCost (manual input)
  ws.addRow({
    category:    'Licences',
    description: 'Software licences, SaaS subscriptions, and third-party tool costs',
    currency,
    subtotal:    licenseCost
  });

  // Row 5 — contingency (formula references effortCost cell D2)
  const r5 = ws.addRow({
    category:    'Contingency',
    description: `Risk buffer at ${Math.round(contingencyRate * 100)}% of total effort cost`,
    currency,
    subtotal:    null
  });
  r5.getCell(CS_SUBTOTAL_COL).value = { formula: `${stCol}2*${contingencyRate}` };

  // Row 6 — grandTotal (formula sums all 4 line items: effortCost + infra + license + contingency)
  const r6 = ws.addRow({
    category:    'GRAND TOTAL',
    description: 'Sum of all cost categories',
    currency,
    subtotal:    null
  });
  r6.getCell(CS_SUBTOTAL_COL).value = { formula: `SUM(${stCol}2:${stCol}5)` };
  r6.font = { bold: true };
}

// ---------------------------------------------------------------------------
// Gantt sheet — date helpers + builder
// ---------------------------------------------------------------------------

/**
 * Parse an ISO date string (YYYY-MM-DD) into a UTC Date.
 * Returns null on invalid input.
 */
function parseIsoDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

/** Format a Date as YYYY-MM-DD (UTC). */
function formatIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Day index: 0=Sun, 1=Mon, ..., 6=Sat. */
function dayOfWeek(d) {
  return d.getUTCDay();
}

/** Is this date a business day (Mon–Fri)? */
function isBusinessDay(d) {
  const dow = dayOfWeek(d);
  return dow >= 1 && dow <= 5;
}

/** Add N calendar days to a Date, returning a new Date. */
function addDays(d, n) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Count business days between two dates inclusive.
 * e.g. Mon → Fri = 5 days.
 */
function businessDaysBetween(start, end) {
  if (!start || !end) return 0;
  let count = 0;
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    if (isBusinessDay(cursor)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Build the "Gantt Timeline" sheet.
 *
 * Renders a calendar grid to the right of the task columns with coloured cells
 * marking each task's duration. Weekend columns are greyed out.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {{ projectStartDate: string, projectEndDate: string, tasks: Array<object> }} gantt
 */
function buildGanttSheet(ws, gantt) {
  if (!gantt || !Array.isArray(gantt.tasks) || gantt.tasks.length === 0) {
    console.warn('[generate-xlsx] Gantt sheet skipped — no gantt.tasks provided');
    return;
  }

  const projectStart = parseIsoDate(gantt.projectStartDate);
  const projectEnd   = parseIsoDate(gantt.projectEndDate);
  if (!projectStart || !projectEnd) {
    console.warn('[generate-xlsx] Gantt sheet skipped — invalid projectStartDate or projectEndDate');
    return;
  }

  // Build calendar column list — one column per business day between start and end
  const calendarDates = [];
  let cursor = new Date(projectStart.getTime());
  while (cursor.getTime() <= projectEnd.getTime()) {
    calendarDates.push(new Date(cursor.getTime()));
    cursor = addDays(cursor, 1);
  }

  // Merge static columns + calendar columns into the worksheet column definition
  const calendarCols = calendarDates.map((d, i) => ({
    key: `day${i}`,
    width: 4,
  }));
  ws.columns = [
    ...GANTT_STATIC_COLS.map(c => ({ key: c.key, width: c.widthChars })),
    ...calendarCols,
  ];

  // Header row 1 — static column labels, then calendar dates (MM-DD)
  const headerValues = {};
  GANTT_STATIC_COLS.forEach(c => { headerValues[c.key] = c.header; });
  calendarDates.forEach((d, i) => {
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    headerValues[`day${i}`] = `${mm}-${dd}`;
  });
  const headerRow = ws.addRow(headerValues);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

  // Grey-out weekend columns in header
  calendarDates.forEach((d, i) => {
    if (!isBusinessDay(d)) {
      const cellCol = GANTT_STATIC_COLS.length + i + 1;
      headerRow.getCell(cellCol).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' },
      };
    }
  });

  // Data rows
  gantt.tasks.forEach(task => {
    const rowValues = {
      id:           task.id || '',
      task:         task.isPhaseHeader ? (task.name || '') : `  ${task.name || ''}`,
      phase:        task.phase || '',
      role:         task.isPhaseHeader ? '' : (task.role || ''),
      startDate:    task.startDate || '',
      endDate:      task.endDate || '',
      durationDays: task.durationDays != null ? task.durationDays : 0,
      effortHours:  task.effortHours != null ? task.effortHours : 0,
    };
    const row = ws.addRow(rowValues);

    // Style phase header rows bold + grey background across static columns
    if (task.isPhaseHeader) {
      row.font = { bold: true };
      for (let c = 1; c <= GANTT_STATIC_COLS.length; c++) {
        row.getCell(c).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: GANTT_PHASE_HEADER_COLOR },
        };
      }
    }

    // Paint calendar cells within [taskStart, taskEnd]
    const taskStart = parseIsoDate(task.startDate);
    const taskEnd   = parseIsoDate(task.endDate);
    if (!taskStart || !taskEnd) return;

    const barColor = task.isPhaseHeader
      ? GANTT_PHASE_HEADER_COLOR
      : (GANTT_ROLE_COLORS[task.role] || GANTT_DEFAULT_BAR_COLOR);

    calendarDates.forEach((d, i) => {
      const inRange = d.getTime() >= taskStart.getTime() && d.getTime() <= taskEnd.getTime();
      const cellCol = GANTT_STATIC_COLS.length + i + 1;
      const cell = row.getCell(cellCol);

      if (inRange && isBusinessDay(d)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: barColor } };
      } else if (!isBusinessDay(d)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      }
    });
  });

  // Freeze static columns + header row so the calendar scrolls independently
  ws.views = [{ state: 'frozen', xSplit: GANTT_STATIC_COLS.length, ySplit: 1 }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Locate `.sdlc/state.json` by walking up from the data JSON's directory.
 * Expected layout: `<project>/.sdlc/tmp/estimate-vN.json` → `<project>/.sdlc/state.json`.
 * Returns null if not found within 4 parent levels.
 */
function findStateJsonNearby(dataPath) {
  let dir = path.dirname(path.resolve(dataPath));
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'state.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Compute today + N days as an ISO date string (UTC, YYYY-MM-DD).
 */
function todayPlusDaysIso(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Generate a 3- or 4-sheet .xlsx financial model.
 *
 * If `plan.gantt` is missing, this function auto-injects a Gantt schedule
 * using `buildGantt()` with `state.json.projectStartDate` as the anchor
 * (or today+7 days if absent). The `dataPath` JSON is NOT modified —
 * the injection happens in memory only.
 *
 * The tmp JSON is NOT deleted by this function. Cleanup happens later in
 * `scripts/finalize-traceforward.js`, which also needs to read the JSON.
 *
 * @param {string} templatePath  Absolute path to estimation-template.json
 * @param {string} dataPath      Absolute path to JSON file containing { estimatePlan: {...} }
 * @param {string} outputPath    Absolute path for the output .xlsx file
 */
async function generateXlsx(templatePath, dataPath, outputPath) {
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const dataFile = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const plan     = dataFile.estimatePlan;

  if (!plan) {
    throw new Error('Data file must contain an "estimatePlan" top-level object');
  }

  // Auto-inject Gantt schedule if the agent did not produce one.
  // This guarantees every estimate xlsx has a Gantt Timeline sheet regardless
  // of whether the agent followed Section 6.6 scheduling rules.
  if (!plan.gantt || !Array.isArray(plan.gantt.tasks) || plan.gantt.tasks.length === 0) {
    if (Array.isArray(plan.sheets?.effortBreakdown) && plan.sheets.effortBreakdown.length > 0) {
      const statePath = findStateJsonNearby(dataPath);
      let startIso = null;
      let startDateSource = 'default-fallback';
      if (statePath) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (state && typeof state.projectStartDate === 'string'
              && /^\d{4}-\d{2}-\d{2}$/.test(state.projectStartDate)) {
            startIso = state.projectStartDate;
            startDateSource = 'state.json';
          }
        } catch (e) {
          console.warn(`[generate-xlsx] could not read state.json: ${e.message}`);
        }
      }
      if (!startIso) {
        startIso = todayPlusDaysIso(7);
        console.warn(`[generate-xlsx] projectStartDate not set — defaulting Gantt start to ${startIso}`);
      }
      plan.gantt = buildGantt(plan.sheets.effortBreakdown, startIso, startDateSource);
      console.log(
        `[generate-xlsx] Gantt auto-injected: ${plan.gantt.tasks.length} tasks, ` +
        `${plan.gantt.projectStartDate} → ${plan.gantt.projectEndDate}`
      );
    }
  }

  const resourcePlan    = plan.sheets.resourcePlan    || [];
  const effortBreakdown = plan.sheets.effortBreakdown || [];

  if (effortBreakdown.length === 0) {
    throw new Error('estimatePlan.sheets.effortBreakdown must contain at least one row');
  }

  // Determine the dominant role to use for effortBreakdown rows that have no role field
  const dominantRole = resourcePlan.reduce(
    (best, r) => (r.allocationPct > best.alloc ? { role: r.role, alloc: r.allocationPct } : best),
    { role: resourcePlan[0]?.role || 'seniorDev', alloc: -1 }
  ).role;

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'ECC-SDLC generate-xlsx.js';
  wb.created  = new Date();
  wb.calcProperties = { fullCalcOnLoad: true }; // Excel recalculates all formulas on open

  const wsRP = wb.addWorksheet('Resource Plan');
  const wsEB = wb.addWorksheet('Effort by Phase');
  const wsCS = wb.addWorksheet('Cost Summary');

  buildResourcePlanSheet(wsRP, template.sheets.resourcePlan,   resourcePlan);
  const ebRowCount = buildEffortByPhaseSheet(wsEB, template.sheets.effortByPhase, effortBreakdown, dominantRole);
  buildCostSummarySheet(wsCS, template.sheets.costSummary, plan, ebRowCount);

  // Optional 4th sheet — Gantt Timeline (only rendered if estimatePlan.gantt is present)
  if (plan.gantt && Array.isArray(plan.gantt.tasks) && plan.gantt.tasks.length > 0) {
    const wsGT = wb.addWorksheet('Gantt Timeline');
    buildGanttSheet(wsGT, plan.gantt);
  }

  const outputDir = path.dirname(outputPath);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await wb.xlsx.writeFile(outputPath);

  // Cleanup of the tmp estimate JSON is deliberately NOT done here —
  // the traceForward update in the next orchestration step still needs to
  // read the JSON. Cleanup happens inside scripts/finalize-traceforward.js
  // after the traceForward update completes.
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function getArg(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

if (require.main === module) {
  const args         = process.argv.slice(2);
  const templatePath = getArg(args, '--template');
  const dataPath     = getArg(args, '--data');
  const outputPath   = getArg(args, '--output');

  if (!templatePath || !dataPath || !outputPath) {
    console.error('Usage: node scripts/generate-xlsx.js --template <path> --data <path> --output <path>');
    process.exit(1);
  }

  generateXlsx(
    path.resolve(templatePath),
    path.resolve(dataPath),
    path.resolve(outputPath)
  )
    .then(() => console.log('Generated: ' + outputPath))
    .catch(err => { console.error('Error: ' + err.message); process.exit(1); });
}

module.exports = { generateXlsx };
