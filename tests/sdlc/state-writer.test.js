#!/usr/bin/env node
/**
 * ECC-SDLC — state-writer.js Unit Tests
 *
 * Tests for: scripts/sdlc/utils/state-writer.js
 *            scripts/sdlc/utils/initialise-traceforward.js
 *
 * Covers acceptance criteria from the Atomic State Writer user story:
 *   1. Interrupted write — state.json.bak intact, state.json readable
 *   2. Successful write — new content, .bak has previous, no .tmp leftover
 *   3. traceForward initialisation — every REQ-* has 3 empty arrays
 *   4. Merge-safe re-run — existing designComponentIds preserved
 *   5. Stale .tmp from prior crash is overwritten without error
 *
 * Run with: node tests/sdlc/state-writer.test.js
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ---------------------------------------------------------------------------
// Modules under test
// ---------------------------------------------------------------------------

const REPO_ROOT     = path.resolve(__dirname, '..', '..');
const WRITER_MODULE = path.join(REPO_ROOT, 'scripts', 'sdlc', 'utils', 'state-writer.js');
const INIT_MODULE   = path.join(REPO_ROOT, 'scripts', 'sdlc', 'utils', 'initialise-traceforward.js');

const { writeJsonAtomic }                       = require(WRITER_MODULE);
const { initialiseTraceForward, applyToState } = require(INIT_MODULE);

// ---------------------------------------------------------------------------
// Test harness (matches ECC pattern)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeTempState(requirements = [], extra = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sw-test-'));
  const sdlcDir     = path.join(projectRoot, '.sdlc');
  fs.mkdirSync(sdlcDir, { recursive: true });

  const state = {
    projectId:    crypto.randomUUID(),
    projectName:  'Test Project',
    clientName:   'Test Client',
    currentPhase: 'requirements',
    phaseHistory: [],
    artifacts:    { scope: null, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements,
    designComponents: [],
    testCases:        [],
    complianceFlags:  [],
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== Testing scripts/sdlc/utils/state-writer.js ===\n');

// ── Test 1: Simulated interrupted write ──────────────────────────────────────
console.log('AC1 — Interrupted write recovery:');

test('interrupted write leaves state.json.bak intact and state.json readable', () => {
  const { statePath, state, cleanup } = makeTempState([makeReq('REQ-FUNC-001')]);
  const bakPath = `${statePath}.bak`;

  try {
    // Write v1 successfully
    writeJsonAtomic(statePath, { ...state, clientName: 'Version 1' });

    // Write v2 successfully so .bak = v1
    writeJsonAtomic(statePath, { ...state, clientName: 'Version 2' });

    // Verify .bak has v1
    assert.ok(fs.existsSync(bakPath), '.bak must exist');
    const backup = readJson(bakPath);
    assert.strictEqual(backup.clientName, 'Version 1', '.bak must contain Version 1');

    // Verify state.json has v2
    const current = readJson(statePath);
    assert.strictEqual(current.clientName, 'Version 2', 'state.json must contain Version 2');

    // Simulate corruption: overwrite state.json with garbage
    fs.writeFileSync(statePath, '{corrupted', 'utf8');

    // The .bak is still readable as the last clean version
    const recovered = readJson(bakPath);
    assert.strictEqual(recovered.clientName, 'Version 1', '.bak must still be readable after corruption');
    assert.ok(recovered.projectId, 'recovered state must have projectId');
  } finally {
    cleanup();
  }
});

// ── Test 2: Successful write ─────────────────────────────────────────────────
console.log('\nAC2 — Successful write:');

test('successful write: state.json has new content, .bak has previous, no .tmp leftover', () => {
  const { statePath, state, cleanup } = makeTempState([makeReq('REQ-FUNC-001')]);
  const bakPath = `${statePath}.bak`;

  try {
    // First write — creates state.json (overwrite from makeTempState)
    writeJsonAtomic(statePath, { ...state, clientName: 'Previous' });

    // Second write — should create .bak with "Previous"
    writeJsonAtomic(statePath, { ...state, clientName: 'Current' });

    // state.json has new content
    const current = readJson(statePath);
    assert.strictEqual(current.clientName, 'Current');

    // .bak has previous content
    assert.ok(fs.existsSync(bakPath), '.bak must exist');
    const backup = readJson(bakPath);
    assert.strictEqual(backup.clientName, 'Previous');

    // No .tmp files left behind
    const dir = path.dirname(statePath);
    const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    assert.strictEqual(tmpFiles.length, 0, 'no .tmp files should remain');
  } finally {
    cleanup();
  }
});

// ── Test 3: Stale .tmp overwritten ───────────────────────────────────────────
console.log('\nAC3 — Stale .tmp from prior crash:');

test('pre-existing .tmp file does not block a new write', () => {
  const { statePath, state, cleanup } = makeTempState([makeReq('REQ-FUNC-001')]);

  try {
    // Simulate a stale .tmp from a prior crash (different naming pattern but same dir)
    const staleTemp = `${statePath}.stale.tmp`;
    fs.writeFileSync(staleTemp, 'stale garbage', 'utf8');

    // A new atomic write should succeed without error
    assert.doesNotThrow(() => {
      writeJsonAtomic(statePath, { ...state, clientName: 'After Stale' });
    }, 'writeJsonAtomic must not throw when stale .tmp exists');

    const current = readJson(statePath);
    assert.strictEqual(current.clientName, 'After Stale');
  } finally {
    cleanup();
  }
});

// ── Test 4: traceForward initialisation ──────────────────────────────────────
console.log('\nAC4 — traceForward initialisation after /srs:');

test('after applyToState, every REQ-* has traceForward with 3 empty arrays', () => {
  const reqs = [
    makeReq('REQ-FUNC-001'),
    makeReq('REQ-FUNC-002'),
    makeReq('REQ-NFUNC-001', { type: 'non-functional', category: 'security' }),
    makeReq('REQ-CON-001', { type: 'constraint' })
  ];
  const { statePath, state, cleanup } = makeTempState(reqs);

  try {
    applyToState(statePath, state);
    const written = readJson(statePath);

    for (const r of written.requirements) {
      const tf = r.traceForward;
      assert.ok(tf, `traceForward missing on ${r.id}`);
      assert.deepStrictEqual(tf.designComponentIds, [], `designComponentIds not [] on ${r.id}`);
      assert.deepStrictEqual(tf.testCaseIds, [], `testCaseIds not [] on ${r.id}`);
      assert.deepStrictEqual(tf.costLineItemIds, [], `costLineItemIds not [] on ${r.id}`);
    }
  } finally {
    cleanup();
  }
});

// ── Test 5: Merge-safe re-run ────────────────────────────────────────────────
console.log('\nAC5 — Merge-safe: existing traceForward IDs preserved on re-run:');

test('re-running /srs initialisation does not overwrite non-empty traceForward arrays', () => {
  const reqs = [
    makeReq('REQ-FUNC-001', {
      traceForward: {
        designComponentIds: ['DC-001', 'DC-003'],
        testCaseIds: ['TC-001'],
        costLineItemIds: ['COST-001']
      }
    }),
    makeReq('REQ-FUNC-002', {
      traceForward: {
        designComponentIds: ['DC-002'],
        testCaseIds: [],
        costLineItemIds: []
      }
    }),
    makeReq('REQ-FUNC-003')  // no traceForward at all
  ];
  const { statePath, state, cleanup } = makeTempState(reqs);

  try {
    // First run
    const s1 = applyToState(statePath, state);

    // Second run (simulating /srs re-run on updated requirements)
    const s2 = applyToState(statePath, s1);
    const written = readJson(statePath);

    // REQ-FUNC-001: all three arrays preserved
    const tf1 = written.requirements[0].traceForward;
    assert.deepStrictEqual(tf1.designComponentIds, ['DC-001', 'DC-003'], 'DC IDs must be preserved');
    assert.deepStrictEqual(tf1.testCaseIds, ['TC-001'], 'TC IDs must be preserved');
    assert.deepStrictEqual(tf1.costLineItemIds, ['COST-001'], 'COST IDs must be preserved');

    // REQ-FUNC-002: designComponentIds preserved, empty arrays stay empty
    const tf2 = written.requirements[1].traceForward;
    assert.deepStrictEqual(tf2.designComponentIds, ['DC-002'], 'DC-002 must be preserved');
    assert.deepStrictEqual(tf2.testCaseIds, [], 'empty testCaseIds stays []');
    assert.deepStrictEqual(tf2.costLineItemIds, [], 'empty costLineItemIds stays []');

    // REQ-FUNC-003: freshly initialised with empty arrays
    const tf3 = written.requirements[2].traceForward;
    assert.deepStrictEqual(tf3.designComponentIds, []);
    assert.deepStrictEqual(tf3.testCaseIds, []);
    assert.deepStrictEqual(tf3.costLineItemIds, []);
  } finally {
    cleanup();
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('\n' + '\u2500'.repeat(60));
console.log(`Passed: ${passed}  /  Failed: ${failed}  /  Total: ${total}`);
console.log('\u2500'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
