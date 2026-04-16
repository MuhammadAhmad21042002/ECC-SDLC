// estimator.assert.test.js
// Self-test: verifies that estimator.assert.js passes on correct output
// and fails on deliberately broken output.
//
// Run: node tests/sdlc/estimator.assert.test.js
// Exit code 0 = self-test passed. Exit code 1 = self-test failed.

'use strict';
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const FIXTURES = path.join(__dirname, 'fixtures');
const ASSERT   = path.join(__dirname, 'estimator.assert.js');
const FIXTURE  = path.join(FIXTURES, 'estimate-fixture.json');
const GOLDEN   = path.join(FIXTURES, 'estimate-golden-output.json');
const BROKEN   = path.join(FIXTURES, 'estimate-broken-output.json');

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

// ---------------------------------------------------------------------------
// Build the broken output: take golden, corrupt one FP value and one cost
// ---------------------------------------------------------------------------
function buildBrokenOutput() {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

  // Corrupt: change DC-001 ILF simple from 7 → 8 (wrong FP value)
  const dc001 = golden.estimatePlan.sheets.effortBreakdown.find(r => r.componentId === 'DC-001');
  if (dc001) dc001.functionPoints = 8;

  // Corrupt: change totalFunctionPoints to match (so the sum check also catches it)
  // Actually keep totalFunctionPoints correct to test BOTH checks independently
  // The FPA table check will catch functionPoints=8 for ILF simple (should be 7)

  // Corrupt: change seniorDev totalCost to wrong value (hours × rate + 1)
  const seniorRow = golden.estimatePlan.sheets.resourcePlan.find(r => r.role === 'seniorDev');
  if (seniorRow) seniorRow.totalCost = seniorRow.totalCost + 1;

  fs.writeFileSync(BROKEN, JSON.stringify(golden, null, 2));
}

// ---------------------------------------------------------------------------
// Run assert script and return { exitCode, stdout, stderr }
// ---------------------------------------------------------------------------
function runAssert(fixturePath, outputPath) {
  const cmd = 'node "' + ASSERT + '" --fixture "' + fixturePath + '" --output "' + outputPath + '"';
  try {
    const stdout = execSync(cmd, { encoding: 'utf8' });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status || 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
console.log('\n=== Estimator Assert Self-Test ===\n');

let passed = 0;
let total  = 0;

function t(name, fn) {
  total++;
  if (test(name, fn)) passed++;
}

// --- prerequisite: golden output must exist ---
t('golden output fixture exists', () => {
  if (!fs.existsSync(GOLDEN)) throw new Error('Run: node tests/sdlc/compute-golden.js first');
});

// --- build broken output ---
t('broken output built successfully', () => {
  buildBrokenOutput();
  if (!fs.existsSync(BROKEN)) throw new Error('broken output file was not created');
});

// --- Test 1: correct output → assertions must PASS (exit code 0) ---
console.log('\n  [Running assertions against GOLDEN output — expect: all pass]');
const goldenResult = runAssert(FIXTURE, GOLDEN);

t('golden output: assert script exits 0 (all assertions pass)', () => {
  if (goldenResult.exitCode !== 0) {
    throw new Error('assert script exited ' + goldenResult.exitCode + '\n' + goldenResult.output);
  }
});

t('golden output: "All assertions PASSED" in output', () => {
  if (!goldenResult.output.includes('All assertions PASSED')) {
    throw new Error('Expected "All assertions PASSED" in output. Got:\n' + goldenResult.output);
  }
});

// --- Test 2: broken output → assertions must FAIL (exit code 1) ---
console.log('\n  [Running assertions against BROKEN output — expect: failures caught]');
const brokenResult = runAssert(FIXTURE, BROKEN);

t('broken output: assert script exits 1 (failures detected)', () => {
  if (brokenResult.exitCode === 0) {
    throw new Error('assert script should have exited 1 but exited 0 — assertions are not catching errors');
  }
});

t('broken output: ILF simple FP error is caught (expected 7, got 8)', () => {
  if (!brokenResult.output.includes('DC-001')) {
    throw new Error('Expected DC-001 error in output. Got:\n' + brokenResult.output);
  }
});

t('broken output: rate card cost error is caught (seniorDev cost off by 1)', () => {
  if (!brokenResult.output.includes('seniorDev')) {
    throw new Error('Expected seniorDev error in output. Got:\n' + brokenResult.output);
  }
});

// --- Test 3: ILF fixture → exactly 7 FP ---
console.log('\n  [Running assertions against ILF accuracy fixture]');

// Build a minimal correct output for the ILF fixture
function buildIlfOutput() {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'estimate-fixture-ilf.json'), 'utf8'));
  const fp = 7; // ILF simple = 7
  const hoursPerFP = 8;
  const effortHours = fp * hoursPerFP; // 56

  const rateCard = fixture.rateCard;
  const totalEffortHours = effortHours;
  const archHours   = Math.round(totalEffortHours * 0.15); // 8
  const seniorHours = Math.round(totalEffortHours * 0.60); // 34
  const juniorHours = Math.round(totalEffortHours * 0.25); // 14

  const plan = {
    estimatePlan: {
      templatePath: 'templates/estimation-template.json',
      templateId:   'ecc-sdlc.estimation.v1',
      projectId:    fixture.projectId,
      projectName:  fixture.projectName,
      clientName:   fixture.clientName,
      generatedDate: '2026-03-20',
      documentVersion: '1.0',
      currency: 'USD',
      totalFunctionPoints: fp,
      totalEffortHours,
      totalCost: archHours * 80 + seniorHours * 50 + juniorHours * 30,
      sheets: {
        effortBreakdown: [{
          componentId: 'DC-001', componentTitle: 'Core Data Store', componentType: 'database',
          fpaType: 'ILF', fpaTypeFullName: 'Internal Logical File', complexity: 'simple',
          functionPoints: fp, hoursPerFP, effortHours, phase: 'development',
          requirementIds: 'REQ-FUNC-001', notes: ''
        }],
        resourcePlan: [
          { role:'architect', roleLabel:'Solution Architect', seniorityLevel:'principal', allocationPct:0.15, totalHours: archHours,   storyPoints: Math.ceil(archHours/8),   hourlyRate:80, currency:'USD', totalCost: archHours   * 80 },
          { role:'seniorDev', roleLabel:'Senior Developer',   seniorityLevel:'senior',    allocationPct:0.60, totalHours: seniorHours, storyPoints: Math.ceil(seniorHours/8), hourlyRate:50, currency:'USD', totalCost: seniorHours * 50 },
          { role:'juniorDev', roleLabel:'Junior Developer',   seniorityLevel:'junior',    allocationPct:0.25, totalHours: juniorHours, storyPoints: Math.ceil(juniorHours/8), hourlyRate:30, currency:'USD', totalCost: juniorHours * 30 }
        ],
        costSummary: [
          { category:'Solution Architect', description:'Solution Architect effort cost', role:'architect', hours: archHours,   hourlyRate:80, currency:'USD', subtotal: archHours   * 80 },
          { category:'Senior Developer',   description:'Senior Developer effort cost',   role:'seniorDev', hours: seniorHours, hourlyRate:50, currency:'USD', subtotal: seniorHours * 50 },
          { category:'Junior Developer',   description:'Junior Developer effort cost',   role:'juniorDev', hours: juniorHours, hourlyRate:30, currency:'USD', subtotal: juniorHours * 30 },
          { category:'GRAND TOTAL', description:'Total project cost', role:'', hours: archHours+seniorHours+juniorHours, hourlyRate:null, currency:'USD', subtotal: archHours*80 + seniorHours*50 + juniorHours*30 }
        ]
      },
      unmappableComponents: [],
      missingRateCardRoles: [],
      validation: { totalFPMatchesBreakdown:true, totalHoursMatchesBreakdown:true, totalCostMatchesResourcePlan:true, allComponentsProcessed:true, unmappableCount:0, missingRateCardRolesCount:0 }
    }
  };

  const outPath = path.join(FIXTURES, 'estimate-ilf-output.json');
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  return outPath;
}

const ilfOutputPath = buildIlfOutput();
const ilfResult     = runAssert(path.join(FIXTURES, 'estimate-fixture-ilf.json'), ilfOutputPath);

t('ILF fixture: assert script exits 0', () => {
  if (ilfResult.exitCode !== 0) throw new Error('assert failed:\n' + ilfResult.output);
});

t('ILF fixture: DC-001 ILF simple = 7 FP confirmed', () => {
  if (!ilfResult.output.includes('ILF') || !ilfResult.output.includes('7')) {
    throw new Error('Expected ILF + 7 FP in output. Got:\n' + ilfResult.output);
  }
});

// --- Clean up temp files ---
[BROKEN, ilfOutputPath].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });

// --- Summary ---
console.log('\n' + passed + '/' + total + ' self-tests passed.');
if (passed < total) {
  console.log((total - passed) + ' self-test(s) FAILED.\n');
  process.exit(1);
}
console.log('Self-test PASSED — assertion script is working correctly.\n');
