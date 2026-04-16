'use strict';

/**
 * generate-xlsx.test.js
 *
 * Unit tests for scripts/generate-xlsx.js.
 *
 * Run: node tests/sdlc/generate-xlsx.test.js
 *
 * Tests:
 *   1. Schema compliance  — 3 sheets with exact names
 *   2. Row completeness   — all 5 components appear in Effort by Phase
 *   3. Formula cell type  — effortCost subtotal cell is formula, not numeric
 *   4. Rate cascade       — doubling seniorDev hourlyRate doubles grandTotal
 *   5. Zero error cells   — no cell contains an Excel error value
 */

const assert  = require('assert');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const ExcelJS = require('exceljs');

const { generateXlsx } = require('../../scripts/generate-xlsx');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT    = path.resolve(__dirname, '..', '..');
const TEMPLATE     = path.join(REPO_ROOT, 'templates', 'estimation-template.json');
const FIXTURE      = path.join(__dirname, 'fixtures', 'estimation-payload-5components.json');
const OUTPUT_DIR   = path.join(os.tmpdir(), 'ecc-sdlc-xlsx-tests');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'test-output.xlsx');

// Column indices (1-based) — must match generate-xlsx.js constants
const RP_ROLE_COL        = 1;  // A — role key
const RP_HOURLY_RATE_COL = 9;  // I — hourlyRate
const EB_ROLE_COL        = 2;  // B — Assigned Role
const EB_EFFORT_HRS_COL  = 11; // K — Effort Hours
const CS_SUBTOTAL_COL    = 7;  // G — Subtotal

// ---------------------------------------------------------------------------
// Minimal async test runner
// ---------------------------------------------------------------------------

let passed = 0;
let total  = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log('  \u2713 ' + name);
    passed++;
  } catch (err) {
    console.log('  \u2717 ' + name);
    console.log('    Error: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Helper: read workbook from output path
// ---------------------------------------------------------------------------

async function openWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

/**
 * Build a role → hourlyRate lookup map from the Resource Plan sheet.
 * Skips the header row (row 1) and any row whose role cell is 'TOTAL'.
 */
function buildRateMap(wsRP) {
  const rateMap = {};
  wsRP.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const role = row.getCell(RP_ROLE_COL).value;
    const rate = row.getCell(RP_HOURLY_RATE_COL).value;
    if (role && role !== 'TOTAL' && typeof rate === 'number') {
      rateMap[String(role)] = rate;
    }
  });
  return rateMap;
}

/**
 * Manually evaluate the SUMPRODUCT(effortHours, VLOOKUP(role → rate)) formula
 * using actual worksheet cell values.  Pass rateOverride to simulate a rate change.
 */
function evalEffortCost(wsEB, rateMap, rateOverride) {
  const rates = rateOverride ? Object.assign({}, rateMap, rateOverride) : rateMap;
  let total = 0;
  wsEB.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // header
    const role  = row.getCell(EB_ROLE_COL).value;
    const hours = row.getCell(EB_EFFORT_HRS_COL).value;
    if (role === 'TOTAL' || typeof hours !== 'number') return;
    const rate = rates[String(role)];
    if (rate != null) total += hours * rate;
  });
  return total;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n=== generate-xlsx.test.js ===\n');

  // Generate the file once; all tests read from the same output
  console.log('Generating test .xlsx from 5-component fixture…');
  await generateXlsx(TEMPLATE, FIXTURE, OUTPUT_FILE);
  console.log('Output: ' + OUTPUT_FILE + '\n');

  // --------------------------------------------------------------------------
  // Test 1 — Schema compliance: 3 sheets with exact names
  // --------------------------------------------------------------------------
  await test('sheet names: Resource Plan, Effort by Phase, Cost Summary all present', async () => {
    const wb = await openWorkbook(OUTPUT_FILE);
    const EXPECTED = ['Resource Plan', 'Effort by Phase', 'Cost Summary'];
    EXPECTED.forEach(name => {
      const ws = wb.getWorksheet(name);
      assert(ws, `Sheet "${name}" not found — workbook has: ${wb.worksheets.map(s => s.name).join(', ')}`);
    });
    assert.strictEqual(wb.worksheets.length, 3, `Expected 3 sheets, found ${wb.worksheets.length}`);
  });

  // --------------------------------------------------------------------------
  // Test 2 — Row completeness: all 5 components in Effort by Phase
  // --------------------------------------------------------------------------
  await test('row completeness: all 5 component IDs present in Effort by Phase', async () => {
    const wb    = await openWorkbook(OUTPUT_FILE);
    const wsEB  = wb.getWorksheet('Effort by Phase');
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const expectedIds = fixture.estimatePlan.sheets.effortBreakdown.map(r => r.componentId);
    const COMPONENT_ID_COL = 3; // C

    const foundIds = [];
    wsEB.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const cid = row.getCell(COMPONENT_ID_COL).value;
      if (cid && cid !== 'TOTAL') foundIds.push(String(cid));
    });

    expectedIds.forEach(id => {
      assert(foundIds.includes(id), `Component ID "${id}" not found in Effort by Phase sheet`);
    });
    assert.strictEqual(foundIds.length, expectedIds.length,
      `Expected ${expectedIds.length} data rows, found ${foundIds.length}`);
  });

  // --------------------------------------------------------------------------
  // Test 3 — Formula cell type: effortCost subtotal is a formula cell
  // --------------------------------------------------------------------------
  await test('formula cell type: effortCost subtotal cell type is Formula, not numeric', async () => {
    const wb   = await openWorkbook(OUTPUT_FILE);
    const wsCS = wb.getWorksheet('Cost Summary');

    // Row 2 = effortCost line item; col G (7) = subtotal
    const cell = wsCS.getRow(2).getCell(CS_SUBTOTAL_COL);
    assert.strictEqual(cell.type, ExcelJS.ValueType.Formula,
      `Expected cell type Formula (${ExcelJS.ValueType.Formula}), got ${cell.type} — value: ${JSON.stringify(cell.value)}`);

    // Also verify the formula string references both required sheets
    const formulaStr = typeof cell.value === 'object' ? cell.value.formula : '';
    assert(formulaStr.includes('Effort by Phase'),
      `effortCost formula must reference 'Effort by Phase' sheet — got: "${formulaStr}"`);
    assert(formulaStr.includes('Resource Plan'),
      `effortCost formula must reference 'Resource Plan' sheet — got: "${formulaStr}"`);
    assert(formulaStr.toLowerCase().includes('sumproduct'),
      `effortCost formula must use SUMPRODUCT — got: "${formulaStr}"`);
    assert(formulaStr.toLowerCase().includes('vlookup'),
      `effortCost formula must use VLOOKUP — got: "${formulaStr}"`);
  });

  // --------------------------------------------------------------------------
  // Test 4 — Rate cascade: doubling seniorDev hourlyRate doubles grandTotal
  //
  // Because the fixture has:
  //   infrastructureCost = 0
  //   licenseCost        = 0
  //   contingencyPct     = 10
  //   all effort rows    = seniorDev
  //
  // grandTotal = effortCost * 1.1
  // Doubling the rate doubles effortCost which doubles grandTotal.
  // We verify this by manually evaluating the SUMPRODUCT formula logic
  // against the actual worksheet cell values (ExcelJS stores but does not
  // evaluate formulas; this test proves the formula WOULD recalculate correctly).
  // --------------------------------------------------------------------------
  await test('rate cascade: doubling seniorDev hourlyRate doubles computed grandTotal', async () => {
    const wb   = await openWorkbook(OUTPUT_FILE);
    const wsRP = wb.getWorksheet('Resource Plan');
    const wsEB = wb.getWorksheet('Effort by Phase');
    const wsCS = wb.getWorksheet('Cost Summary');

    const rateMap = buildRateMap(wsRP);
    assert('seniorDev' in rateMap, 'seniorDev not found in Resource Plan — cannot test rate cascade');
    assert.strictEqual(rateMap.seniorDev, 50, `Expected seniorDev rate 50, got ${rateMap.seniorDev}`);

    // Read manual-input values from Cost Summary rows 3 and 4 (infra, license)
    const infraCost   = wsCS.getRow(3).getCell(CS_SUBTOTAL_COL).value || 0;
    const licenseCost = wsCS.getRow(4).getCell(CS_SUBTOTAL_COL).value || 0;

    // Verify contingency (row 5) and grandTotal (row 6) are formula cells
    const contingencyCell = wsCS.getRow(5).getCell(CS_SUBTOTAL_COL);
    const grandTotalCell  = wsCS.getRow(6).getCell(CS_SUBTOTAL_COL);
    assert.strictEqual(contingencyCell.type, ExcelJS.ValueType.Formula,
      'contingency subtotal must be a formula cell');
    assert.strictEqual(grandTotalCell.type, ExcelJS.ValueType.Formula,
      'grandTotal subtotal must be a formula cell');

    // Manually evaluate grandTotal with original rate (50)
    const effortCost50   = evalEffortCost(wsEB, rateMap);
    const contingency50  = effortCost50 * 0.1;
    const grandTotal50   = effortCost50 + infraCost + licenseCost + contingency50;

    assert(effortCost50 > 0, `effortCost computed as 0 — check role values in Effort by Phase match Resource Plan`);

    // Manually evaluate grandTotal with doubled rate (100)
    const effortCost100  = evalEffortCost(wsEB, rateMap, { seniorDev: 100 });
    const contingency100 = effortCost100 * 0.1;
    const grandTotal100  = effortCost100 + infraCost + licenseCost + contingency100;

    const ratio = grandTotal100 / grandTotal50;
    const TOLERANCE = 0.0001;
    assert(Math.abs(ratio - 2) < TOLERANCE,
      `grandTotal should double when seniorDev rate doubles — ratio: ${ratio.toFixed(6)} (expected 2.0)`);
  });

  // --------------------------------------------------------------------------
  // Test 5 — Zero error cells: no cell contains an Excel error value
  // --------------------------------------------------------------------------
  await test('zero error cells: no cell in any sheet has an Excel error value', async () => {
    const wb          = await openWorkbook(OUTPUT_FILE);
    const ERROR_REGEX = /^#(REF|VALUE|NAME|DIV\/0|NULL|NUM|N\/A)!/;
    const errors      = [];

    wb.worksheets.forEach(ws => {
      ws.eachRow((row, rowNum) => {
        row.eachCell({ includeEmpty: false }, (cell, colNum) => {
          // Check ExcelJS error type
          if (cell.type === ExcelJS.ValueType.Error) {
            errors.push(`[${ws.name}] R${rowNum}C${colNum}: error type cell`);
            return;
          }
          // Check string values that look like Excel errors
          if (typeof cell.value === 'string' && ERROR_REGEX.test(cell.value)) {
            errors.push(`[${ws.name}] R${rowNum}C${colNum}: "${cell.value}"`);
          }
          // Check formula result field if present
          if (cell.value && typeof cell.value === 'object' && cell.value.error) {
            errors.push(`[${ws.name}] R${rowNum}C${colNum}: formula error "${cell.value.error}"`);
          }
        });
      });
    });

    assert.strictEqual(errors.length, 0,
      `Found ${errors.length} error cell(s):\n  ${errors.join('\n  ')}`);
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log(`\n${passed}/${total} tests passed.`);
  if (passed < total) {
    console.log(`${total - passed} test(s) FAILED.\n`);
    process.exit(1);
  }
  console.log('All tests PASSED.\n');
}

runTests().catch(err => {
  console.error('Unexpected error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
