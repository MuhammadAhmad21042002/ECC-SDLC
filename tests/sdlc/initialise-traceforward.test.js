#!/usr/bin/env node
/**
 * ECC-SDLC — initialise-traceforward.js Unit Tests
 *
 * Tests for:
 *   scripts/sdlc/utils/initialise-traceforward.js
 *   scripts/sdlc/utils/state-writer.js
 *
 * Covers all acceptance criteria from the user story:
 *   1. Fresh initialisation — all 3 arrays present and empty on every REQ-*
 *   2. Merge-safe re-run — existing non-empty arrays preserved after second run
 *   3. Legacy state.json — traceForward added when key is absent; no runtime error
 *   4. Null-safety — .length accessible on all three arrays (never undefined)
 *   5. Atomic write — state.json.bak is created (evidence atomic writer fired)
 *   6. Idempotency — three consecutive initialisations produce identical state.json
 *   7. Zero percent coverage — /traceability coverage formula returns 0% on fresh state
 *
 * Run with: node tests/sdlc/initialise-traceforward.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const REPO_ROOT      = path.resolve(__dirname, '..', '..');
const INIT_MODULE    = path.join(REPO_ROOT, 'scripts', 'sdlc', 'utils', 'initialise-traceforward.js');
const WRITER_MODULE  = path.join(REPO_ROOT, 'scripts', 'sdlc', 'utils', 'state-writer.js');

const { initialiseTraceForward, applyToState } = require(INIT_MODULE);
const { writeJsonAtomic }                       = require(WRITER_MODULE);

// ---------------------------------------------------------------------------
// Test harness (matches ECC pattern)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal valid requirement with no traceForward key.
 */
function makeReq(id, overrides = {}) {
  return {
    id,
    type: 'functional',
    title: `Requirement ${id}`,
    description: 'The system shall do something.',
    priority: 'must',
    source: 'Test fixture',
    status: 'draft',
    acceptanceCriteria: ['Given X, when Y, then Z'],
    dependencies: [],
    complianceFrameworks: [],
    assumptions: [],
    deferralReason: null,
    ...overrides
  };
}

/**
 * Write a temporary state.json to a fresh temp dir.
 * Returns { statePath, sdlcDir, projectRoot, cleanup }.
 */
function makeTempState(requirements = [], extra = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-trace-test-'));
  const sdlcDir     = path.join(projectRoot, '.sdlc');
  fs.mkdirSync(sdlcDir, { recursive: true });

  const state = {
    projectId:   crypto.randomUUID(),
    projectName: 'Test Project',
    clientName:  'Test Client',
    currentPhase: 'requirements',
    phaseHistory: [],
    artifacts:   { scope: null, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements,
    designComponents: [],
    testCases: [],
    complianceFlags: [],
    traceabilityMatrix: {},
    ...extra
  };

  const statePath = path.join(sdlcDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  return {
    statePath,
    sdlcDir,
    projectRoot,
    state,
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true })
  };
}

function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Coverage formula — mirrors the logic in commands/traceability.md
// ---------------------------------------------------------------------------

/**
 * Calculate traceability coverage percentage from a requirements array.
 * Mirrors the formula in commands/traceability.md exactly.
 *
 * @param {Array} requirements
 * @returns {{ pct: number, fullyTraced: number, total: number }}
 */
function calcCoverage(requirements) {
  const reqs = Array.isArray(requirements) ? requirements : [];
  let fullyTraced = 0;

  for (const r of reqs) {
    const tf   = r.traceForward || {};
    const dcs  = Array.isArray(tf.designComponentIds) ? tf.designComponentIds  : [];
    const tcs  = Array.isArray(tf.testCaseIds)         ? tf.testCaseIds         : [];
    const cost = Array.isArray(tf.costLineItemIds)      ? tf.costLineItemIds     : [];
    if (dcs.length > 0 && tcs.length > 0 && cost.length > 0) fullyTraced++;
  }

  const total = reqs.length;
  const pct   = total > 0 ? Math.round((fullyTraced / total) * 100) : 0;
  return { pct, fullyTraced, total };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== Testing scripts/sdlc/utils/initialise-traceforward.js ===\n');

// ── Module existence ─────────────────────────────────────────────────────────
console.log('Module existence:');

test('initialise-traceforward.js exists', () => {
  assert.ok(fs.existsSync(INIT_MODULE), `Not found: ${INIT_MODULE}`);
});

test('state-writer.js exists', () => {
  assert.ok(fs.existsSync(WRITER_MODULE), `Not found: ${WRITER_MODULE}`);
});

test('initialiseTraceForward is a function', () => {
  assert.strictEqual(typeof initialiseTraceForward, 'function');
});

test('applyToState is a function', () => {
  assert.strictEqual(typeof applyToState, 'function');
});

test('writeJsonAtomic is a function', () => {
  assert.strictEqual(typeof writeJsonAtomic, 'function');
});

// ── AC1: Fresh initialisation ─────────────────────────────────────────────────
console.log('\nAC1 — Fresh initialisation (no prior traceForward):');

test('single requirement with no traceForward gets all 3 arrays', () => {
  const req    = makeReq('REQ-FUNC-001'); // no traceForward
  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.ok(tf, 'traceForward must exist');
  assert.deepStrictEqual(tf.designComponentIds, [], 'designComponentIds must be []');
  assert.deepStrictEqual(tf.testCaseIds,         [], 'testCaseIds must be []');
  assert.deepStrictEqual(tf.costLineItemIds,      [], 'costLineItemIds must be []');
});

test('10 requirements with no traceForward all get all 3 arrays', () => {
  const reqs = Array.from({ length: 10 }, (_, i) =>
    makeReq(`REQ-FUNC-${String(i + 1).padStart(3, '0')}`)
  );
  const result = initialiseTraceForward(reqs);

  assert.strictEqual(result.length, 10, 'result must have 10 entries');
  for (const r of result) {
    const tf = r.traceForward;
    assert.ok(tf, `traceForward missing on ${r.id}`);
    assert.deepStrictEqual(tf.designComponentIds, [], `designComponentIds not [] on ${r.id}`);
    assert.deepStrictEqual(tf.testCaseIds,         [], `testCaseIds not [] on ${r.id}`);
    assert.deepStrictEqual(tf.costLineItemIds,      [], `costLineItemIds not [] on ${r.id}`);
  }
});

test('state.json after applyToState has all 3 arrays on every requirement', () => {
  const { statePath, state, cleanup } = makeTempState([
    makeReq('REQ-FUNC-001'),
    makeReq('REQ-FUNC-002'),
    makeReq('REQ-NFUNC-001', { type: 'non-functional', category: 'security' })
  ]);

  try {
    applyToState(statePath, state);
    const written = readState(statePath);

    for (const r of written.requirements) {
      const tf = r.traceForward;
      assert.ok(tf, `traceForward missing on ${r.id}`);
      assert.ok(Array.isArray(tf.designComponentIds), `designComponentIds not array on ${r.id}`);
      assert.ok(Array.isArray(tf.testCaseIds),         `testCaseIds not array on ${r.id}`);
      assert.ok(Array.isArray(tf.costLineItemIds),      `costLineItemIds not array on ${r.id}`);
      assert.strictEqual(tf.designComponentIds.length, 0);
      assert.strictEqual(tf.testCaseIds.length,         0);
      assert.strictEqual(tf.costLineItemIds.length,      0);
    }
  } finally {
    cleanup();
  }
});

// ── AC2: Merge-safe re-run ────────────────────────────────────────────────────
console.log('\nAC2 — Merge-safe re-run (existing values preserved):');

test('designComponentIds with existing value is preserved after re-run', () => {
  const req = makeReq('REQ-FUNC-001', {
    traceForward: {
      designComponentIds: ['CMP-001'],
      testCaseIds:        [],
      costLineItemIds:    []
    }
  });
  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.deepStrictEqual(tf.designComponentIds, ['CMP-001'], 'CMP-001 must be preserved');
  assert.deepStrictEqual(tf.testCaseIds,         [],         'testCaseIds must remain []');
  assert.deepStrictEqual(tf.costLineItemIds,      [],         'costLineItemIds must remain []');
});

test('all three non-empty arrays preserved after re-run', () => {
  const req = makeReq('REQ-FUNC-001', {
    traceForward: {
      designComponentIds: ['DC-001', 'DC-002'],
      testCaseIds:        ['TC-001'],
      costLineItemIds:    ['COST-001']
    }
  });
  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.deepStrictEqual(tf.designComponentIds, ['DC-001', 'DC-002']);
  assert.deepStrictEqual(tf.testCaseIds,         ['TC-001']);
  assert.deepStrictEqual(tf.costLineItemIds,      ['COST-001']);
});

test('mixed batch: pre-populated req keeps values; fresh req gets empty arrays', () => {
  const reqs = [
    makeReq('REQ-FUNC-001', {
      traceForward: { designComponentIds: ['CMP-001'], testCaseIds: [], costLineItemIds: [] }
    }),
    makeReq('REQ-FUNC-002')  // no traceForward
  ];
  const result = initialiseTraceForward(reqs);

  assert.deepStrictEqual(result[0].traceForward.designComponentIds, ['CMP-001']);
  assert.deepStrictEqual(result[1].traceForward.designComponentIds, []);
  assert.deepStrictEqual(result[1].traceForward.testCaseIds,         []);
  assert.deepStrictEqual(result[1].traceForward.costLineItemIds,      []);
});

test('applyToState: re-running with CMP-001 present preserves it in state.json', () => {
  const req = makeReq('REQ-FUNC-001', {
    traceForward: { designComponentIds: ['CMP-001'], testCaseIds: [], costLineItemIds: [] }
  });
  const { statePath, state, cleanup } = makeTempState([req]);

  try {
    applyToState(statePath, state);
    const written = readState(statePath);
    assert.deepStrictEqual(
      written.requirements[0].traceForward.designComponentIds,
      ['CMP-001'],
      'CMP-001 must survive applyToState'
    );
  } finally {
    cleanup();
  }
});

// ── AC3: Legacy state.json (no traceForward key) ──────────────────────────────
console.log('\nAC3 — Legacy state.json (missing traceForward key):');

test('requirement with traceForward: undefined gets traceForward added', () => {
  const req = makeReq('REQ-FUNC-001');
  // Explicitly delete any traceForward to simulate legacy state
  delete req.traceForward;
  assert.strictEqual(req.traceForward, undefined);

  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.ok(tf, 'traceForward must be added');
  assert.deepStrictEqual(tf.designComponentIds, []);
  assert.deepStrictEqual(tf.testCaseIds,         []);
  assert.deepStrictEqual(tf.costLineItemIds,      []);
});

test('requirement with traceForward: null gets proper traceForward', () => {
  const req = makeReq('REQ-FUNC-001', { traceForward: null });
  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.ok(tf && typeof tf === 'object');
  assert.deepStrictEqual(tf.designComponentIds, []);
});

test('requirement with traceForward: {} (empty object) gets all 3 keys added', () => {
  const req    = makeReq('REQ-FUNC-001', { traceForward: {} });
  const result = initialiseTraceForward([req]);
  const tf     = result[0].traceForward;

  assert.deepStrictEqual(tf.designComponentIds, []);
  assert.deepStrictEqual(tf.testCaseIds,         []);
  assert.deepStrictEqual(tf.costLineItemIds,      []);
});

test('requirement with traceForward.designComponentIds: null — replaced with []', () => {
  const req = makeReq('REQ-FUNC-001', {
    traceForward: { designComponentIds: null, testCaseIds: [], costLineItemIds: [] }
  });
  const result = initialiseTraceForward([req]);
  assert.deepStrictEqual(result[0].traceForward.designComponentIds, []);
});

test('no runtime error processing a legacy batch (mix of present and absent traceForward)', () => {
  const reqs = [
    makeReq('REQ-FUNC-001'),                             // no traceForward
    makeReq('REQ-FUNC-002', { traceForward: null }),     // null
    makeReq('REQ-FUNC-003', { traceForward: {} }),       // empty object
    makeReq('REQ-FUNC-004', {
      traceForward: { designComponentIds: ['DC-001'], testCaseIds: ['TC-001'], costLineItemIds: ['COST-001'] }
    })
  ];

  let result;
  assert.doesNotThrow(() => {
    result = initialiseTraceForward(reqs);
  }, 'initialiseTraceForward must not throw on legacy batch');

  assert.strictEqual(result.length, 4);
  // All four should have valid traceForward
  for (const r of result) {
    assert.ok(r.traceForward && typeof r.traceForward === 'object');
    assert.ok(Array.isArray(r.traceForward.designComponentIds));
    assert.ok(Array.isArray(r.traceForward.testCaseIds));
    assert.ok(Array.isArray(r.traceForward.costLineItemIds));
  }
  // Pre-populated values preserved
  assert.deepStrictEqual(result[3].traceForward.designComponentIds, ['DC-001']);
});

// ── AC4: Null-safety (.length never throws) ───────────────────────────────────
console.log('\nAC4 — Null-safety (all .length accesses return valid integers):');

test('designComponentIds.length returns 0 on freshly initialised requirement', () => {
  const [r] = initialiseTraceForward([makeReq('REQ-FUNC-001')]);
  assert.strictEqual(typeof r.traceForward.designComponentIds.length, 'number');
  assert.strictEqual(r.traceForward.designComponentIds.length, 0);
});

test('testCaseIds.length returns 0 on freshly initialised requirement', () => {
  const [r] = initialiseTraceForward([makeReq('REQ-FUNC-001')]);
  assert.strictEqual(r.traceForward.testCaseIds.length, 0);
});

test('costLineItemIds.length returns 0 on freshly initialised requirement', () => {
  const [r] = initialiseTraceForward([makeReq('REQ-FUNC-001')]);
  assert.strictEqual(r.traceForward.costLineItemIds.length, 0);
});

test('all .length values are integers — no undefined — across 10 fresh requirements', () => {
  const reqs   = Array.from({ length: 10 }, (_, i) => makeReq(`REQ-FUNC-${String(i + 1).padStart(3, '0')}`));
  const result = initialiseTraceForward(reqs);

  for (const r of result) {
    const tf = r.traceForward;
    assert.strictEqual(typeof tf.designComponentIds.length, 'number', `designComponentIds.length not number on ${r.id}`);
    assert.strictEqual(typeof tf.testCaseIds.length,         'number', `testCaseIds.length not number on ${r.id}`);
    assert.strictEqual(typeof tf.costLineItemIds.length,      'number', `costLineItemIds.length not number on ${r.id}`);
    // Must be a valid integer ≥ 0
    assert.ok(Number.isInteger(tf.designComponentIds.length) && tf.designComponentIds.length >= 0);
    assert.ok(Number.isInteger(tf.testCaseIds.length)         && tf.testCaseIds.length         >= 0);
    assert.ok(Number.isInteger(tf.costLineItemIds.length)     && tf.costLineItemIds.length     >= 0);
  }
});

// ── AC5: Atomic write — .bak evidence ────────────────────────────────────────
console.log('\nAC5 — Atomic write (state.json.bak created as evidence):');

test('writeJsonAtomic creates state.json at target path', () => {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-writer-test-'));
  const target  = path.join(tmpDir, 'state.json');
  try {
    writeJsonAtomic(target, { test: true });
    assert.ok(fs.existsSync(target), 'state.json must exist after write');
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.strictEqual(parsed.test, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeJsonAtomic creates .bak file when overwriting an existing state.json', () => {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-writer-bak-'));
  const target  = path.join(tmpDir, 'state.json');
  const bakPath = `${target}.bak`;
  try {
    // First write (no .bak created — nothing to back up)
    writeJsonAtomic(target, { version: 1 });
    assert.ok(fs.existsSync(target));
    assert.ok(!fs.existsSync(bakPath), '.bak should not exist after first write');

    // Second write — should back up version 1 to .bak
    writeJsonAtomic(target, { version: 2 });
    assert.ok(fs.existsSync(target),  'state.json must still exist');
    assert.ok(fs.existsSync(bakPath), 'state.json.bak must exist after overwrite (atomic writer fired)');

    const current = JSON.parse(fs.readFileSync(target, 'utf8'));
    const backup  = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
    assert.strictEqual(current.version, 2, 'current state.json must have version 2');
    assert.strictEqual(backup.version,  1, 'state.json.bak must have prior version 1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyToState creates state.json.bak on the statePath when state already exists', () => {
  const reqs = [makeReq('REQ-FUNC-001')];
  const { statePath, state, cleanup } = makeTempState(reqs);
  const bakPath = `${statePath}.bak`;

  try {
    // First write creates state.json (done by makeTempState).
    // applyToState does a second write → should produce .bak.
    applyToState(statePath, state);
    assert.ok(fs.existsSync(bakPath), 'state.json.bak must exist after applyToState');
  } finally {
    cleanup();
  }
});

// ── AC6: Idempotency ──────────────────────────────────────────────────────────
console.log('\nAC6 — Idempotency (three consecutive runs produce identical state.json):');

test('initialiseTraceForward is idempotent on fresh requirements', () => {
  const reqs = [makeReq('REQ-FUNC-001'), makeReq('REQ-FUNC-002')];
  const r1 = JSON.stringify(initialiseTraceForward(reqs));
  const r2 = JSON.stringify(initialiseTraceForward(JSON.parse(r1).map ? JSON.parse(r1) : reqs));
  // Run three times to verify stability
  const once  = initialiseTraceForward(reqs);
  const twice = initialiseTraceForward(once);
  const three = initialiseTraceForward(twice);

  assert.deepStrictEqual(once,  twice, 'second run must equal first');
  assert.deepStrictEqual(twice, three, 'third run must equal second');
});

test('three applyToState calls produce identical state.json content', () => {
  const reqs = [makeReq('REQ-FUNC-001'), makeReq('REQ-FUNC-002')];
  const { statePath, state, cleanup } = makeTempState(reqs);

  try {
    const s1 = applyToState(statePath, state);
    const s2 = applyToState(statePath, s1);
    const s3 = applyToState(statePath, s2);

    // Requirements arrays must be identical across all three states
    assert.deepStrictEqual(s1.requirements, s2.requirements, 'run 1 vs run 2 must be identical');
    assert.deepStrictEqual(s2.requirements, s3.requirements, 'run 2 vs run 3 must be identical');

    // Final state.json on disk must match third run
    const onDisk = readState(statePath);
    assert.deepStrictEqual(onDisk.requirements, s3.requirements, 'disk state must match third run');
  } finally {
    cleanup();
  }
});

test('initialiseTraceForward does not mutate the input array', () => {
  const original = [makeReq('REQ-FUNC-001')];
  const snapshot = JSON.stringify(original);

  initialiseTraceForward(original);

  assert.strictEqual(JSON.stringify(original), snapshot, 'input array must not be mutated');
});

// ── AC7: Zero percent coverage ────────────────────────────────────────────────
console.log('\nAC7 — Zero percent coverage (0% reported; no null reference errors):');

test('calcCoverage returns 0% when all traceForward arrays are empty', () => {
  const reqs = initialiseTraceForward([
    makeReq('REQ-FUNC-001'),
    makeReq('REQ-FUNC-002'),
    makeReq('REQ-FUNC-003')
  ]);

  let result;
  assert.doesNotThrow(() => {
    result = calcCoverage(reqs);
  }, 'calcCoverage must not throw on initialised requirements');

  assert.strictEqual(result.pct,          0, 'coverage must be 0%');
  assert.strictEqual(result.fullyTraced,  0, 'fullyTraced must be 0');
  assert.strictEqual(result.total,        3, 'total must be 3');
});

test('calcCoverage returns 0% for 10 fresh requirements (no null errors)', () => {
  const reqs = initialiseTraceForward(
    Array.from({ length: 10 }, (_, i) => makeReq(`REQ-FUNC-${String(i + 1).padStart(3, '0')}`))
  );

  const result = calcCoverage(reqs);
  assert.strictEqual(result.pct, 0);
  assert.strictEqual(result.total, 10);
});

test('command-level traceability script reports 0% on freshly initialised state', () => {
  const reqs = initialiseTraceForward(
    Array.from({ length: 10 }, (_, i) => makeReq(`REQ-FUNC-${String(i + 1).padStart(3, '0')}`))
  );
  const { projectRoot, cleanup } = makeTempState(reqs);

  try {
    const script = `
const fs = require('fs');
const path = require('path');
const statePath = path.join(process.cwd(), '.sdlc', 'state.json');
const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const reqs = Array.isArray(s.requirements) ? s.requirements : [];
let fullyTraced = 0;
for (const r of reqs) {
  const tf = r.traceForward || {};
  const dcs = Array.isArray(tf.designComponentIds) ? tf.designComponentIds : [];
  const tcs = Array.isArray(tf.testCaseIds) ? tf.testCaseIds : [];
  const cost = Array.isArray(tf.costLineItemIds) ? tf.costLineItemIds : [];
  if (dcs.length > 0 && tcs.length > 0 && cost.length > 0) fullyTraced++;
}
const pct = reqs.length > 0 ? Math.round((fullyTraced / reqs.length) * 100) : 0;
console.log('Coverage: ' + fullyTraced + '/' + reqs.length + ' requirements fully traced (' + pct + '%)');
`;

    const result = spawnSync('node', ['-e', script], {
      cwd: projectRoot,
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, `script failed: ${result.stderr || 'unknown error'}`);
    assert.match(
      result.stdout,
      /Coverage:\s*0\/10 requirements fully traced \(0%\)/,
      'traceability command-level script must report exactly 0% coverage'
    );
  } finally {
    cleanup();
  }
});

test('calcCoverage matches traceability.md formula: fully-traced/total × 100 rounded', () => {
  // 2 of 5 fully traced → 40%
  const reqs = [
    makeReq('REQ-FUNC-001', {
      traceForward: { designComponentIds: ['DC-001'], testCaseIds: ['TC-001'], costLineItemIds: ['COST-001'] }
    }),
    makeReq('REQ-FUNC-002', {
      traceForward: { designComponentIds: ['DC-002'], testCaseIds: ['TC-002'], costLineItemIds: ['COST-002'] }
    }),
    makeReq('REQ-FUNC-003'),  // empty — will be initialised to 0
    makeReq('REQ-FUNC-004'),
    makeReq('REQ-FUNC-005')
  ];
  const initialised = initialiseTraceForward(reqs);
  const { pct } = calcCoverage(initialised);
  assert.strictEqual(pct, 40, 'Expected 40% (2/5 fully traced)');
});

test('coverage formula safe on empty requirements array (returns 0%)', () => {
  const { pct, total } = calcCoverage([]);
  assert.strictEqual(pct,   0);
  assert.strictEqual(total, 0);
});

test('calcCoverage: access to all three .length properties never throws', () => {
  const reqs = initialiseTraceForward([
    makeReq('REQ-FUNC-001'),
    makeReq('REQ-FUNC-002', {
      traceForward: { designComponentIds: ['DC-001'], testCaseIds: [], costLineItemIds: [] }
    })
  ]);

  assert.doesNotThrow(() => {
    for (const r of reqs) {
      const tf = r.traceForward || {};
      void (Array.isArray(tf.designComponentIds) ? tf.designComponentIds : []).length;
      void (Array.isArray(tf.testCaseIds)         ? tf.testCaseIds         : []).length;
      void (Array.isArray(tf.costLineItemIds)      ? tf.costLineItemIds     : []).length;
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────
console.log('\nEdge cases:');

test('empty requirements array returns empty array', () => {
  const result = initialiseTraceForward([]);
  assert.deepStrictEqual(result, []);
});

test('non-array input is returned as-is (no throw)', () => {
  assert.doesNotThrow(() => {
    const result = initialiseTraceForward(null);
    assert.strictEqual(result, null);
  });
});

test('requirement IDs are preserved exactly through initialisation', () => {
  const ids  = ['REQ-FUNC-001', 'REQ-NFUNC-001', 'REQ-CON-001'];
  const reqs = ids.map(id => makeReq(id));
  const result = initialiseTraceForward(reqs);

  assert.deepStrictEqual(
    result.map(r => r.id),
    ids,
    'IDs must be preserved in the same order'
  );
});

test('other requirement fields are not modified by initialiseTraceForward', () => {
  const req    = makeReq('REQ-FUNC-001', { priority: 'must', status: 'approved', source: 'RFP §2.1' });
  const [result] = initialiseTraceForward([req]);

  assert.strictEqual(result.priority, 'must');
  assert.strictEqual(result.status,   'approved');
  assert.strictEqual(result.source,   'RFP §2.1');
});

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('\n' + '─'.repeat(60));
console.log(`Passed: ${passed}  /  Failed: ${failed}  /  Total: ${total}`);
console.log('─'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
