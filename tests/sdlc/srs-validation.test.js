#!/usr/bin/env node
/**
 * ECC-SDLC — /srs Requirement Validation Tests
 *
 * Tests for scripts/sdlc/validate-requirements.js
 *
 * Covers:
 *   - All valid requirements pass (exit 0)
 *   - Invalid requirements hard block (exit 1)
 *   - Specific schema violations: bad ID, empty title, missing field,
 *     invalid priority, non-functional without category, missing traceForward
 *   - Empty requirements array blocks (exit 1)
 *   - Missing state.json blocks (exit 2)
 *   - --json flag produces machine-readable output
 *
 * Run with: node tests/sdlc/srs-validation.test.js
 */

'use strict';

const assert     = require('assert');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Test harness (matches the pattern used throughout this repo)
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
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT      = path.resolve(__dirname, '..', '..');
const VALIDATOR      = path.join(REPO_ROOT, 'scripts', 'sdlc', 'validate-requirements.js');
const FIXTURES_DIR   = path.join(__dirname, 'fixtures');

const VALID_STATE    = path.join(FIXTURES_DIR, 'state-with-valid-requirements.json');
const INVALID_STATE  = path.join(FIXTURES_DIR, 'state-with-invalid-requirements.json');

/**
 * Run the validator script against a given state file.
 * Returns { exitCode, stdout, stderr }.
 */
function runValidator(stateFile, extraArgs = []) {
  const args = [VALIDATOR, '--state', stateFile, ...extraArgs];
  const result = spawnSync('node', args, { encoding: 'utf8' });
  return {
    exitCode: result.status,
    stdout:   result.stdout || '',
    stderr:   result.stderr || '',
  };
}

/**
 * Write a temporary state file to os.tmpdir(), return its path.
 * Caller is responsible for cleanup.
 */
function writeTempState(content) {
  const tmpPath = path.join(os.tmpdir(), `ecc-sdlc-test-state-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(content, null, 2), 'utf8');
  return tmpPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== Testing scripts/sdlc/validate-requirements.js ===\n');

// ── Prerequisites ────────────────────────────────────────────────────────────
console.log('Prerequisites:');

test('validator script exists', () => {
  assert.ok(fs.existsSync(VALIDATOR), `Validator not found at ${VALIDATOR}`);
});

test('requirement schema exists', () => {
  const schemaPath = path.join(REPO_ROOT, 'schemas', 'requirement.schema.json');
  assert.ok(fs.existsSync(schemaPath), `Schema not found at ${schemaPath}`);
});

test('valid-requirements fixture exists', () => {
  assert.ok(fs.existsSync(VALID_STATE), `Fixture not found: ${VALID_STATE}`);
});

test('invalid-requirements fixture exists', () => {
  assert.ok(fs.existsSync(INVALID_STATE), `Fixture not found: ${INVALID_STATE}`);
});

// ── Happy path ───────────────────────────────────────────────────────────────
console.log('\nHappy path — all requirements valid:');

test('exits 0 when all requirements pass schema', () => {
  const { exitCode } = runValidator(VALID_STATE);
  assert.strictEqual(exitCode, 0, `Expected exit 0, got ${exitCode}`);
});

test('stdout reports 0 failures on valid input', () => {
  const { stdout } = runValidator(VALID_STATE);
  assert.ok(stdout.includes('Failed     : 0'), 'Expected "Failed     : 0" in output');
});

test('stdout confirms SRS generation may proceed', () => {
  const { stdout } = runValidator(VALID_STATE);
  assert.ok(stdout.includes('SRS generation may proceed'), 'Expected proceed message in output');
});

test('reports correct total count (4 requirements in fixture)', () => {
  const { stdout } = runValidator(VALID_STATE);
  assert.ok(stdout.includes('Total      : 4'), 'Expected "Total      : 4" in output');
});

// ── Hard block path ───────────────────────────────────────────────────────────
console.log('\nHard block — invalid requirements:');

test('exits 1 (HARD BLOCK) when requirements fail schema', () => {
  const { exitCode } = runValidator(INVALID_STATE);
  assert.strictEqual(exitCode, 1, `Expected exit 1 (hard block), got ${exitCode}`);
});

test('stdout shows HARD BLOCK message', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('HARD BLOCK'), 'Expected "HARD BLOCK" in output');
});

test('all 6 failing requirements are reported', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('Failed     : 6'), 'Expected "Failed     : 6" in output');
});

// ── Specific schema violation detection ──────────────────────────────────────
console.log('\nSpecific violation detection:');

test('detects bad ID format (WRONG-001)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('WRONG-001'), 'Expected WRONG-001 in failure list');
});

test('detects empty title (REQ-FUNC-002)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('REQ-FUNC-002'), 'Expected REQ-FUNC-002 in failure list');
});

test('detects missing acceptanceCriteria (REQ-FUNC-003)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('REQ-FUNC-003'), 'Expected REQ-FUNC-003 in failure list');
});

test('detects invalid priority value "high" (REQ-FUNC-004)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('REQ-FUNC-004'), 'Expected REQ-FUNC-004 in failure list');
});

test('detects non-functional missing category (REQ-NFUNC-001)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('REQ-NFUNC-001'), 'Expected REQ-NFUNC-001 in failure list');
});

test('detects missing traceForward field (REQ-FUNC-005)', () => {
  const { stdout } = runValidator(INVALID_STATE);
  assert.ok(stdout.includes('REQ-FUNC-005'), 'Expected REQ-FUNC-005 in failure list');
});

// ── Edge cases ────────────────────────────────────────────────────────────────
console.log('\nEdge cases:');

test('exits 1 when requirements array is empty', () => {
  const tmp = writeTempState({
    "$schema": "../schemas/sdlc-state.schema.json",
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test', clientName: 'Test',
    currentPhase: 'requirements',
    phaseHistory: [], artifacts: { scope: null, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements: [],
    designComponents: [], testCases: [], complianceFlags: [], traceabilityMatrix: {}
  });
  try {
    const { exitCode } = runValidator(tmp);
    assert.strictEqual(exitCode, 1, `Expected exit 1 for empty requirements, got ${exitCode}`);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('exits 2 when state file does not exist', () => {
  const { exitCode } = runValidator('/nonexistent/path/state.json');
  assert.strictEqual(exitCode, 2, `Expected exit 2 for missing state, got ${exitCode}`);
});

test('exits 2 when state.json contains invalid JSON', () => {
  const tmp = path.join(os.tmpdir(), `ecc-sdlc-bad-json-${Date.now()}.json`);
  fs.writeFileSync(tmp, '{ this is not valid json }', 'utf8');
  try {
    const { exitCode } = runValidator(tmp);
    assert.strictEqual(exitCode, 2, `Expected exit 2 for invalid JSON, got ${exitCode}`);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('exits 2 when requirements field is not an array', () => {
  const tmp = writeTempState({
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test', clientName: 'Test',
    currentPhase: 'requirements',
    phaseHistory: [], artifacts: { scope: null, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements: 'not-an-array',
    designComponents: [], testCases: [], complianceFlags: [], traceabilityMatrix: {}
  });
  try {
    const { exitCode } = runValidator(tmp);
    assert.strictEqual(exitCode, 2, `Expected exit 2 for non-array requirements, got ${exitCode}`);
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ── JSON output mode ──────────────────────────────────────────────────────────
console.log('\nJSON output mode (--json flag):');

test('--json flag produces valid JSON on stdout', () => {
  const { stdout } = runValidator(VALID_STATE, ['--json']);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    assert.fail('stdout was not valid JSON');
  }
  assert.ok(typeof parsed === 'object', 'Parsed output is not an object');
});

test('--json output has valid:true for valid requirements', () => {
  const { stdout } = runValidator(VALID_STATE, ['--json']);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.valid, true, `Expected valid:true, got ${parsed.valid}`);
});

test('--json output has valid:false for invalid requirements', () => {
  const { stdout } = runValidator(INVALID_STATE, ['--json']);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.valid, false, `Expected valid:false, got ${parsed.valid}`);
});

test('--json output includes failures array with correct length', () => {
  const { stdout } = runValidator(INVALID_STATE, ['--json']);
  const parsed = JSON.parse(stdout);
  assert.ok(Array.isArray(parsed.failures), 'Expected failures to be an array');
  assert.strictEqual(parsed.failures.length, 6, `Expected 6 failures, got ${parsed.failures.length}`);
});

test('--json failures include id and errors fields', () => {
  const { stdout } = runValidator(INVALID_STATE, ['--json']);
  const parsed = JSON.parse(stdout);
  for (const failure of parsed.failures) {
    assert.ok('id' in failure, 'Each failure must have an id field');
    assert.ok(Array.isArray(failure.errors), 'Each failure must have an errors array');
    assert.ok(failure.errors.length > 0, 'Each failure must have at least one error');
  }
});

// ── User story acceptance criteria ───────────────────────────────────────────
console.log('\nUser story acceptance criteria:');

// AC1: empty acceptanceCriteria array ([] is different from a missing field)
test('AC1: acceptanceCriteria:[] halts pipeline and names the field', () => {
  const tmp = writeTempState({
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test', clientName: 'Test',
    currentPhase: 'requirements',
    phaseHistory: [],
    artifacts: { scope: { path: '.sdlc/artifacts/scope-v1.docx', version: 1, hash: 'sha256:abc' }, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements: [{
      id: 'REQ-FUNC-001',
      type: 'functional',
      title: 'Empty AC array',
      description: 'acceptanceCriteria is present but empty.',
      priority: 'must',
      source: 'Test',
      status: 'draft',
      acceptanceCriteria: [],
      traceForward: { designComponentIds: [], testCaseIds: [], costLineItemIds: [] }
    }],
    designComponents: [], testCases: [], complianceFlags: [], traceabilityMatrix: {}
  });
  try {
    const { exitCode, stdout } = runValidator(tmp);
    assert.strictEqual(exitCode, 1, `Expected exit 1 (hard block), got ${exitCode}`);
    assert.ok(stdout.includes('REQ-FUNC-001'), 'Expected REQ-FUNC-001 in failure output');
    assert.ok(
      stdout.includes('acceptanceCriteria') || stdout.includes('minItems'),
      'Expected acceptanceCriteria or minItems in error text'
    );
  } finally {
    fs.unlinkSync(tmp);
  }
});

// AC2: id 'FUNC-001' (missing REQ- prefix) — error includes the expected pattern string
test('AC2: id FUNC-001 — error output includes the expected ID pattern', () => {
  const tmp = writeTempState({
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test', clientName: 'Test',
    currentPhase: 'requirements',
    phaseHistory: [],
    artifacts: { scope: { path: '.sdlc/artifacts/scope-v1.docx', version: 1, hash: 'sha256:abc' }, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements: [{
      id: 'FUNC-001',
      type: 'functional',
      title: 'Missing REQ- prefix',
      description: 'ID is FUNC-001, missing the REQ- prefix.',
      priority: 'must',
      source: 'Test',
      status: 'draft',
      acceptanceCriteria: ['At least one criterion'],
      traceForward: { designComponentIds: [], testCaseIds: [], costLineItemIds: [] }
    }],
    designComponents: [], testCases: [], complianceFlags: [], traceabilityMatrix: {}
  });
  try {
    const { exitCode, stdout } = runValidator(tmp);
    assert.strictEqual(exitCode, 1, `Expected exit 1, got ${exitCode}`);
    assert.ok(
      stdout.includes('FUNC|NFUNC|CON') || stdout.includes('pattern'),
      'Expected the ID pattern (FUNC|NFUNC|CON or "pattern") in error output'
    );
  } finally {
    fs.unlinkSync(tmp);
  }
});

// AC3: batch of 5 requirements, exactly 2 fail — both are reported before halting
test('AC3: 5 requirements with 2 failures — both failures reported in one output', () => {
  const validReq = (id) => ({
    id,
    type: 'functional',
    title: `Requirement ${id}`,
    description: 'Valid requirement.',
    priority: 'must',
    source: 'Test',
    status: 'draft',
    acceptanceCriteria: ['Criterion'],
    traceForward: { designComponentIds: [], testCaseIds: [], costLineItemIds: [] }
  });
  const tmp = writeTempState({
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test', clientName: 'Test',
    currentPhase: 'requirements',
    phaseHistory: [],
    artifacts: { scope: { path: '.sdlc/artifacts/scope-v1.docx', version: 1, hash: 'sha256:abc' }, srs: null, sds: null, sts: null, estimate: null, proposal: null },
    requirements: [
      validReq('REQ-FUNC-001'),
      validReq('REQ-FUNC-002'),
      validReq('REQ-FUNC-003'),
      { ...validReq('REQ-FUNC-004'), priority: 'high' },       // invalid: bad priority
      { ...validReq('REQ-FUNC-005'), acceptanceCriteria: [] }  // invalid: empty AC array
    ],
    designComponents: [], testCases: [], complianceFlags: [], traceabilityMatrix: {}
  });
  try {
    const { exitCode, stdout } = runValidator(tmp);
    assert.strictEqual(exitCode, 1, `Expected exit 1, got ${exitCode}`);
    assert.ok(stdout.includes('Failed     : 2'), 'Expected exactly 2 failures reported');
    assert.ok(stdout.includes('REQ-FUNC-004'), 'Expected REQ-FUNC-004 in failure output');
    assert.ok(stdout.includes('REQ-FUNC-005'), 'Expected REQ-FUNC-005 in failure output');
  } finally {
    fs.unlinkSync(tmp);
  }
});

// AC4 (state safety): state.json is byte-for-byte unchanged after a failed validation run
test('AC4: state.json is byte-for-byte unchanged after failed validation', () => {
  const before = fs.readFileSync(INVALID_STATE, 'utf8');
  runValidator(INVALID_STATE);
  const after = fs.readFileSync(INVALID_STATE, 'utf8');
  assert.strictEqual(before, after, 'state.json must not be modified by a failed validation run');
});

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('\n' + '─'.repeat(50));
console.log(`Passed: ${passed}  /  Failed: ${failed}  /  Total: ${total}`);
console.log('─'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
