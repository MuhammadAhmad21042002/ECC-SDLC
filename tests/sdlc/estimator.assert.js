// estimator.assert.js
// Asserts that a captured estimator agent output is correct for a given fixture.
//
// Usage (after running /estimate against a fixture):
//   node tests/sdlc/estimator.assert.js \
//     --fixture tests/sdlc/fixtures/estimate-fixture.json \
//     --output  .sdlc/artifacts/estimate-v1.json
//
// Exit code 0 = all assertions passed.
// Exit code 1 = one or more assertions failed.

'use strict';
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// FPA logic mirrored exactly from agents/estimator.md
// (Section 1, 2, 3, 4, 6)
// ---------------------------------------------------------------------------

const FPA_TABLE = {
  EI:  { simple: 3, average: 4,  complex: 6  },
  EO:  { simple: 4, average: 5,  complex: 7  },
  EQ:  { simple: 3, average: 4,  complex: 6  },
  ILF: { simple: 7, average: 10, complex: 15 },
  EIF: { simple: 5, average: 7,  complex: 10 }
};

const FPA_FULL = {
  EI:  'External Input',
  EO:  'External Output',
  EQ:  'External Inquiry',
  ILF: 'Internal Logical File',
  EIF: 'External Interface File',
  UNMAPPABLE: 'UNMAPPABLE'
};

const WRITE_VERBS = ['create','update','delete','submit','insert','patch','post','write','save','remove'];

function expectedFpaType(component) {
  const t = component.type;
  if (t === 'infra' || t === 'library' || t === 'other') return 'UNMAPPABLE';
  if (t === 'api' || t === 'ui') {
    const ifaces = component.interfaces || [];
    const resps  = component.responsibilities || [];
    const hasNonDb = ifaces.some(i => i.kind !== 'db');
    const hasWrite = resps.some(r => WRITE_VERBS.some(v => r.toLowerCase().includes(v)));
    if (hasNonDb || hasWrite) return t === 'api' ? 'EO' : 'EI';
    if (ifaces.length > 0 && ifaces.every(i => i.kind === 'db') && !hasWrite) return 'EQ';
    return t === 'api' ? 'EO' : 'EI';
  }
  const map = { service:'EO', module:'EI', component:'EI', job:'EI', database:'ILF', integration:'EIF', ui:'EI' };
  return map[t] || 'UNMAPPABLE';
}

// Ranges: 0-3=simple, 4-7=average, 8+=complex (mutually exclusive)
function expectedComplexity(component) {
  if (component.complexity) return component.complexity;
  const score = (component.interfaces     || []).length
              + (component.responsibilities || []).length
              + (component.dataStores       || []).length;
  if (score <= 3) return 'simple';
  if (score <= 7) return 'average';
  return 'complex';
}

const HOURS_PER_FP = { juniorDev: 12, seniorDev: 8, architect: 6 };
const ALLOC        = { architect: 0.15, seniorDev: 0.60, juniorDev: 0.25 };
const ROLE_LABELS  = { architect: 'Solution Architect', seniorDev: 'Senior Developer', juniorDev: 'Junior Developer' };
const SENIORITY    = { architect: 'principal',          seniorDev: 'senior',           juniorDev: 'junior' };

// ---------------------------------------------------------------------------
// Test runner (same pattern as tests/sdlc/schemas.test.js)
// ---------------------------------------------------------------------------

function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    return true;
  } catch (err) {
    console.log('  \u2717 ' + name);
    console.log('    ' + err.message);
    return false;
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
  }
}

function assertClose(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error((label ? label + ': ' : '') + 'expected ~' + expected + ' (tol ' + tolerance + ') but got ' + actual);
  }
}

function assertHasKeys(obj, keys, label) {
  keys.forEach(k => {
    if (!(k in obj)) throw new Error((label || '') + ' missing key: ' + k);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(fixturePath, outputPath) {
  console.log('\n=== Estimator Assertion Tests ===');
  console.log('  Fixture: ' + fixturePath);
  console.log('  Output:  ' + outputPath + '\n');

  if (!fs.existsSync(fixturePath)) {
    console.error('ERROR: fixture not found at ' + fixturePath);
    process.exit(1);
  }
  if (!fs.existsSync(outputPath)) {
    console.error('ERROR: output not found at ' + outputPath);
    console.error('       Run /estimate against the fixture first, then re-run this script.');
    process.exit(1);
  }

  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const output  = JSON.parse(fs.readFileSync(outputPath,  'utf8'));
  const plan    = output.estimatePlan;
  const sheets  = plan.sheets;

  let passed = 0;
  let total  = 0;

  function t(name, fn) {
    total++;
    if (test(name, fn)) passed++;
  }

  // -----------------------------------------------------------------------
  // Group 1: FPA accuracy — every component's FP must match the lookup table
  // -----------------------------------------------------------------------
  console.log('--- FPA Accuracy ---');

  fixture.designComponents.forEach(component => {
    const row = sheets.effortBreakdown.find(r => r.componentId === component.id);
    const expFpaType    = expectedFpaType(component);
    const expComplexity = expectedComplexity(component);
    const expFP         = expFpaType === 'UNMAPPABLE' ? 0 : FPA_TABLE[expFpaType][expComplexity];

    t(component.id + ' (' + component.type + '/' + expComplexity + '): fpaType = ' + expFpaType, () => {
      if (!row) throw new Error('no effortBreakdown row found for ' + component.id);
      assertEqual(row.fpaType, expFpaType, 'fpaType');
    });

    t(component.id + ': functionPoints = ' + expFP + ' (FPA table: ' + expFpaType + ' ' + expComplexity + ')', () => {
      if (!row) throw new Error('no effortBreakdown row found for ' + component.id);
      assertEqual(row.functionPoints, expFP, 'functionPoints');
    });

    t(component.id + ': fpaTypeFullName = "' + FPA_FULL[expFpaType] + '"', () => {
      if (!row) throw new Error('no effortBreakdown row found for ' + component.id);
      assertEqual(row.fpaTypeFullName, FPA_FULL[expFpaType], 'fpaTypeFullName');
    });

    t(component.id + ': complexity = ' + expComplexity, () => {
      if (!row) throw new Error('no effortBreakdown row found for ' + component.id);
      assertEqual(row.complexity, expComplexity, 'complexity');
    });
  });

  // -----------------------------------------------------------------------
  // Group 2: FPA consistency — totals must match sum of rows
  // -----------------------------------------------------------------------
  console.log('\n--- FPA Consistency ---');

  const expTotalFP    = fixture.designComponents.reduce((s, c) => {
    const ft = expectedFpaType(c);
    const cx = expectedComplexity(c);
    return s + (ft === 'UNMAPPABLE' ? 0 : FPA_TABLE[ft][cx]);
  }, 0);

  const expTotalHours = fixture.designComponents.reduce((s, c) => {
    const ft = expectedFpaType(c);
    const cx = expectedComplexity(c);
    const fp = ft === 'UNMAPPABLE' ? 0 : FPA_TABLE[ft][cx];
    const role = (c.assignedRole && HOURS_PER_FP[c.assignedRole]) ? c.assignedRole : 'seniorDev';
    return s + fp * HOURS_PER_FP[role];
  }, 0);

  t('totalFunctionPoints = ' + expTotalFP, () => {
    assertEqual(plan.totalFunctionPoints, expTotalFP, 'totalFunctionPoints');
  });

  t('sum of effortBreakdown.functionPoints = totalFunctionPoints', () => {
    const sum = sheets.effortBreakdown.reduce((s, r) => s + r.functionPoints, 0);
    assertEqual(sum, plan.totalFunctionPoints, 'FP sum');
  });

  t('totalEffortHours = ' + expTotalHours, () => {
    assertEqual(plan.totalEffortHours, expTotalHours, 'totalEffortHours');
  });

  t('sum of effortBreakdown.effortHours = totalEffortHours', () => {
    const sum = sheets.effortBreakdown.reduce((s, r) => s + r.effortHours, 0);
    assertClose(sum, plan.totalEffortHours, 0.01, 'effort hours sum');
  });

  t('FP counts are never rounded (all integers matching FPA table)', () => {
    sheets.effortBreakdown.forEach(row => {
      if (row.fpaType === 'UNMAPPABLE') return;
      const expected = FPA_TABLE[row.fpaType][row.complexity];
      if (row.functionPoints !== expected) {
        throw new Error(row.componentId + ': functionPoints=' + row.functionPoints + ' but FPA table says ' + expected);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Group 3: Rate card — cost = hours × rate exactly, no rounding
  // -----------------------------------------------------------------------
  console.log('\n--- Rate Card ---');

  const rateCard = fixture.rateCard || {};

  sheets.resourcePlan.forEach(row => {
    const rate = rateCard[row.role] ? rateCard[row.role].hourlyRate : null;
    if (rate === null) return; // missing rate card role — skip cost check

    t(row.role + ': totalCost = totalHours × hourlyRate (' + row.totalHours + ' × $' + rate + ' = $' + (row.totalHours * rate) + ')', () => {
      const expected = row.totalHours * rate;
      assertEqual(row.totalCost, expected, row.role + '.totalCost');
    });

    t(row.role + ': hourlyRate read correctly from rateCard ($' + rate + ')', () => {
      assertEqual(row.hourlyRate, rate, row.role + '.hourlyRate');
    });

    t(row.role + ': currency read correctly from rateCard ("' + rateCard[row.role].currency + '")', () => {
      assertEqual(row.currency, rateCard[row.role].currency, row.role + '.currency');
    });
  });

  t('totalCost = sum of all role costs + contingency', () => {
    const roleCostSum = sheets.resourcePlan.reduce((s, r) => s + r.totalCost, 0);
    const contingencyPct = fixture.contingencyPct != null ? fixture.contingencyPct : 0;
    const expectedTotal  = roleCostSum + roleCostSum * (contingencyPct / 100);
    assertClose(plan.totalCost, expectedTotal, 0.01, 'totalCost');
  });

  t('role hours rounding drift within ±2h of totalEffortHours', () => {
    const roleHoursSum = sheets.resourcePlan.reduce((s, r) => s + r.totalHours, 0);
    if (Math.abs(roleHoursSum - plan.totalEffortHours) > 2) {
      throw new Error('role hours sum=' + roleHoursSum + ' vs totalEffortHours=' + plan.totalEffortHours + ' (>2h drift)');
    }
  });

  // -----------------------------------------------------------------------
  // Group 4: ExcelJS field mapping — no orphaned fields
  // -----------------------------------------------------------------------
  console.log('\n--- ExcelJS Field Mapping ---');

  const REQUIRED_EB = ['componentId','componentTitle','componentType','fpaType','fpaTypeFullName','complexity','functionPoints','hoursPerFP','effortHours','phase','requirementIds','notes'];
  const REQUIRED_RP = ['role','roleLabel','seniorityLevel','allocationPct','totalHours','storyPoints','hourlyRate','currency','totalCost'];
  const REQUIRED_CS = ['category','description','role','hours','hourlyRate','currency','subtotal'];

  t('effortBreakdown: all ' + REQUIRED_EB.length + ' required keys present in every row', () => {
    sheets.effortBreakdown.forEach((row, i) => assertHasKeys(row, REQUIRED_EB, 'effortBreakdown[' + i + ']'));
  });

  t('resourcePlan: all ' + REQUIRED_RP.length + ' required keys present in every row', () => {
    sheets.resourcePlan.forEach((row, i) => assertHasKeys(row, REQUIRED_RP, 'resourcePlan[' + i + ']'));
  });

  t('costSummary: all ' + REQUIRED_CS.length + ' required keys present in every row', () => {
    sheets.costSummary.forEach((row, i) => assertHasKeys(row, REQUIRED_CS, 'costSummary[' + i + ']'));
  });

  t('estimatePlan has projectId field', () => {
    if (!plan.projectId) throw new Error('projectId is missing from estimatePlan');
  });

  t('estimatePlan has projectName, clientName, currency, generatedDate, documentVersion', () => {
    ['projectName','clientName','currency','generatedDate','documentVersion'].forEach(k => {
      if (!plan[k]) throw new Error('missing top-level field: ' + k);
    });
  });

  t('costSummary contains a GRAND TOTAL row', () => {
    const gt = sheets.costSummary.find(r => r.category === 'GRAND TOTAL');
    if (!gt) throw new Error('no GRAND TOTAL row in costSummary');
    if (typeof gt.subtotal !== 'number') throw new Error('GRAND TOTAL.subtotal is not a number');
  });

  // -----------------------------------------------------------------------
  // Group 5: UNMAPPABLE components flagged correctly
  // -----------------------------------------------------------------------
  console.log('\n--- UNMAPPABLE Handling ---');

  const unmappableInFixture = fixture.designComponents.filter(c => expectedFpaType(c) === 'UNMAPPABLE');

  t('all UNMAPPABLE components have functionPoints = 0', () => {
    unmappableInFixture.forEach(c => {
      const row = sheets.effortBreakdown.find(r => r.componentId === c.id);
      if (!row) throw new Error('no row for ' + c.id);
      assertEqual(row.functionPoints, 0, c.id + '.functionPoints');
    });
  });

  t('all UNMAPPABLE components have effortHours = 0', () => {
    unmappableInFixture.forEach(c => {
      const row = sheets.effortBreakdown.find(r => r.componentId === c.id);
      if (!row) throw new Error('no row for ' + c.id);
      assertEqual(row.effortHours, 0, c.id + '.effortHours');
    });
  });

  t('all UNMAPPABLE components have FLAGGED note', () => {
    unmappableInFixture.forEach(c => {
      const row = sheets.effortBreakdown.find(r => r.componentId === c.id);
      if (!row) throw new Error('no row for ' + c.id);
      if (!row.notes || !row.notes.includes('FLAGGED')) {
        throw new Error(c.id + ': notes field missing FLAGGED keyword');
      }
    });
  });

  t('unmappableComponents list contains all UNMAPPABLE component IDs', () => {
    unmappableInFixture.forEach(c => {
      const listed = (plan.unmappableComponents || []).some(s => s.includes(c.id));
      if (!listed) throw new Error(c.id + ' not found in unmappableComponents list');
    });
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n' + passed + '/' + total + ' assertions passed.');
  if (passed < total) {
    console.log((total - passed) + ' assertion(s) FAILED.\n');
    process.exit(1);
  }
  console.log('All assertions PASSED.\n');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const fixturePath = getArg('--fixture') || path.join(__dirname, 'fixtures', 'estimate-fixture.json');
const outputPath  = getArg('--output')  || path.join(__dirname, 'fixtures', 'estimate-golden-output.json');

run(fixturePath, outputPath);
