/**
 * tests/sdlc/srs-integration.test.js
 *
 * Integration tests for the /srs command.
 * Validates the output of a real /srs run against the test project.
 *
 * USAGE:
 *   1. Run /scope and /srs in a test project:
 *        cd ~/test-srs-v1 && claude
 *        type /scope, then /srs
 *   2. Run this script from ~/.claude:
 *        node tests/sdlc/srs-integration.test.js
 *
 * WHAT THIS SCRIPT CHECKS:
 *   - state.json: requirements[] is non-empty after /srs
 *   - state.json: currentPhase is "requirements" or beyond
 *   - state.json: artifacts.srs is registered with path, version, hash
 *   - state.json: every requirement has traceForward with 3 arrays
 *   - state.json: traceForward arrays are empty (not pre-filled)
 *   - state.json: every requirement has required fields (id, type, title, etc.)
 *   - state.json: all REQ-* IDs match correct format
 *   - state.json: no duplicate requirement IDs
 *   - Disk: srs-vN.docx exists at registered path
 *   - Disk: srs-vN.docx is valid zip (PK header — valid docx)
 *   - Disk: srs-vN.docx hash matches registered hash in state.json
 *   - Precondition: state.json byte-unchanged when scope artifact is null
 *
 * WHAT STAYS MANUAL:
 *   - Open srs-v1.docx in Word and Google Docs — confirm tables render
 *   - Confirm functional requirements table has all REQ-FUNC-* entries
 *   - Zainab sign-off
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const os           = require('os');
const { spawnSync } = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_PROJECT  = path.resolve(os.homedir(), 'test-srs-v1');
const STATE_PATH    = path.join(TEST_PROJECT, '.sdlc', 'state.json');
const ARTIFACTS_DIR = path.join(TEST_PROJECT, '.sdlc', 'artifacts');
const REPO_ROOT     = path.resolve(__dirname, '..', '..');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    → ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Load state ───────────────────────────────────────────────────────────────

console.log('\n/srs Command — Integration Tests\n');
console.log(`  Test project: ${TEST_PROJECT}\n`);

if (!fs.existsSync(STATE_PATH)) {
  console.error(
    `  ERROR: state.json not found at ${STATE_PATH}\n` +
    '  Run /scope and /srs in ~/test-srs-v1 first.\n'
  );
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

// ─── 1. Requirements Array ────────────────────────────────────────────────────
console.log('── 1. Requirements Array ──────────────────────────────────────');

test('state.json has non-empty requirements array', () => {
  assert(
    Array.isArray(state.requirements) && state.requirements.length > 0,
    `requirements[] is empty or missing — got ${state.requirements ? state.requirements.length : 'null'}`
  );
});

test('requirements count is reasonable (at least 5)', () => {
  assert(
    state.requirements.length >= 5,
    `Only ${state.requirements.length} requirements — expected at least 5`
  );
});

test('requirements include functional type', () => {
  const hasFunc = state.requirements.some(r => r.type === 'functional');
  assert(hasFunc, 'No functional requirements found');
});

test('requirements include non-functional type', () => {
  const hasNFunc = state.requirements.some(r => r.type === 'non-functional');
  assert(hasNFunc, 'No non-functional requirements found');
});

// ─── 2. Phase Update ─────────────────────────────────────────────────────────
console.log('\n── 2. Phase Update ────────────────────────────────────────────');

const VALID_POST_SRS_PHASES = ['requirements', 'design', 'test-planning', 'estimation', 'proposal', 'handoff'];

test('currentPhase has advanced past discovery', () => {
  assert(
    VALID_POST_SRS_PHASES.includes(state.currentPhase),
    `currentPhase is "${state.currentPhase}" — expected requirements or beyond`
  );
});

test('phaseHistory contains requirements phase entry', () => {
  const hasReqPhase = Array.isArray(state.phaseHistory) &&
    state.phaseHistory.some(p => p.phase === 'requirements');
  assert(hasReqPhase, 'No requirements phase entry in phaseHistory');
});

// ─── 3. SRS Artifact Registration ────────────────────────────────────────────
console.log('\n── 3. SRS Artifact Registration ───────────────────────────────');

test('artifacts.srs is registered in state.json', () => {
  assert(state.artifacts && state.artifacts.srs, 'artifacts.srs is null or missing');
});

test('artifacts.srs has path field', () => {
  assert(
    state.artifacts.srs && state.artifacts.srs.path,
    'artifacts.srs.path is missing'
  );
});

test('artifacts.srs has version field', () => {
  assert(
    state.artifacts.srs && state.artifacts.srs.version,
    'artifacts.srs.version is missing'
  );
});

test('artifacts.srs has hash field starting with sha256:', () => {
  assert(
    state.artifacts.srs && state.artifacts.srs.hash &&
    state.artifacts.srs.hash.startsWith('sha256:'),
    `artifacts.srs.hash missing or wrong format: "${state.artifacts.srs && state.artifacts.srs.hash}"`
  );
});

test('artifacts.srs has createdAt timestamp', () => {
  assert(
    state.artifacts.srs && state.artifacts.srs.createdAt,
    'artifacts.srs.createdAt is missing'
  );
});

// ─── 4. SRS Docx on Disk ─────────────────────────────────────────────────────
console.log('\n── 4. SRS Docx on Disk ────────────────────────────────────────');

const srsRelPath  = state.artifacts && state.artifacts.srs && state.artifacts.srs.path;
const srsFullPath = srsRelPath ? path.join(TEST_PROJECT, srsRelPath) : null;

test('srs-vN.docx exists on disk at registered path', () => {
  assert(srsFullPath, 'artifacts.srs.path is not set');
  assert(
    fs.existsSync(srsFullPath),
    `srs docx not found at: ${srsFullPath}`
  );
});

test('srs-vN.docx is a valid zip file (PK header)', () => {
  assert(srsFullPath && fs.existsSync(srsFullPath), 'docx file not found');
  const buf = fs.readFileSync(srsFullPath);
  assert(buf.length > 200, `docx file too small: ${buf.length} bytes`);
  assert(
    buf[0] === 0x50 && buf[1] === 0x4b,
    'docx file does not start with PK header — not a valid zip/docx'
  );
});

test('srs-vN.docx file size is non-trivial (> 5KB)', () => {
  assert(srsFullPath && fs.existsSync(srsFullPath), 'docx file not found');
  const size = fs.statSync(srsFullPath).size;
  assert(size > 5000, `docx file is only ${size} bytes — may be empty`);
});

test('srs-vN.docx hash matches registered hash in state.json', () => {
  assert(srsFullPath && fs.existsSync(srsFullPath), 'docx file not found');
  const buf          = fs.readFileSync(srsFullPath);
  const actualHash   = 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
  const storedHash   = state.artifacts.srs.hash;
  assert(
    actualHash === storedHash,
    `Hash mismatch:\n    stored: ${storedHash}\n    actual: ${actualHash}`
  );
});

// ─── 5. traceForward Initialisation ──────────────────────────────────────────
console.log('\n── 5. traceForward Initialisation ─────────────────────────────');

test('every requirement has traceForward object', () => {
  const missing = state.requirements.filter(r => !r.traceForward);
  assert(
    missing.length === 0,
    `${missing.length} requirements missing traceForward: ${missing.map(r => r.id).join(', ')}`
  );
});

test('every traceForward has designComponentIds array', () => {
  const bad = state.requirements.filter(
    r => !r.traceForward || !Array.isArray(r.traceForward.designComponentIds)
  );
  assert(bad.length === 0,
    `${bad.length} requirements missing traceForward.designComponentIds`);
});

test('every traceForward has testCaseIds array', () => {
  const bad = state.requirements.filter(
    r => !r.traceForward || !Array.isArray(r.traceForward.testCaseIds)
  );
  assert(bad.length === 0,
    `${bad.length} requirements missing traceForward.testCaseIds`);
});

test('every traceForward has costLineItemIds array', () => {
  const bad = state.requirements.filter(
    r => !r.traceForward || !Array.isArray(r.traceForward.costLineItemIds)
  );
  assert(bad.length === 0,
    `${bad.length} requirements missing traceForward.costLineItemIds`);
});

test('traceForward arrays are empty (not pre-filled by /srs)', () => {
  const prefilled = state.requirements.filter(r =>
    r.traceForward && (
      r.traceForward.designComponentIds.length > 0 ||
      r.traceForward.testCaseIds.length > 0 ||
      r.traceForward.costLineItemIds.length > 0
    )
  );
  assert(
    prefilled.length === 0,
    `${prefilled.length} requirements have pre-filled traceForward arrays — should be empty after /srs`
  );
});

// ─── 6. Requirement Field Completeness ───────────────────────────────────────
console.log('\n── 6. Requirement Field Completeness ──────────────────────────');

const REQUIRED_REQ_FIELDS = ['id', 'type', 'title', 'description', 'priority', 'source', 'status', 'acceptanceCriteria'];

REQUIRED_REQ_FIELDS.forEach(field => {
  test(`every requirement has "${field}" field`, () => {
    const missing = state.requirements.filter(r => !r[field] && r[field] !== 0);
    assert(
      missing.length === 0,
      `${missing.length} requirements missing "${field}": ${missing.map(r => r.id).join(', ')}`
    );
  });
});

// ─── 7. REQ-* ID Format ───────────────────────────────────────────────────────
console.log('\n── 7. REQ-* ID Format ─────────────────────────────────────────');

const REQ_ID_PATTERN = /^REQ-(FUNC|NFUNC|CON)-\d{3}$/;

test('all requirement IDs match REQ-(FUNC|NFUNC|CON)-NNN format', () => {
  const bad = state.requirements.filter(r => !REQ_ID_PATTERN.test(r.id || ''));
  assert(
    bad.length === 0,
    `Invalid IDs: ${bad.map(r => r.id || '(missing)').join(', ')}`
  );
});

test('all requirement IDs are unique', () => {
  const ids  = state.requirements.map(r => r.id);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(dups.length === 0, `Duplicate IDs: ${[...new Set(dups)].join(', ')}`);
});

// ─── 8. Precondition — No Write on Missing Scope ─────────────────────────────
console.log('\n── 8. Precondition — State Unchanged on Missing Scope ─────────');

test('state.json byte-unchanged when scope artifact is null', () => {
  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-precond-'));
  const tmpStatePath = path.join(tmpDir, 'state.json');
  const sdlcDir      = path.join(tmpDir, '.sdlc');
  fs.mkdirSync(sdlcDir);

  // Create a state with no scope artifact
  const noScopeState = {
    projectName  : 'Test Project',
    clientName   : 'Test Client',
    currentPhase : 'discovery',
    requirements : [],
    artifacts    : {
      scope   : null,
      srs     : null,
      sds     : null,
      sts     : null,
      estimate: null,
      proposal: null,
    },
    phaseHistory: [],
  };

  fs.writeFileSync(tmpStatePath, JSON.stringify(noScopeState, null, 2));
  const stateBefore = fs.readFileSync(tmpStatePath);

  // Run validate-requirements.js — should exit non-zero with no scope
  const validateScript = path.join(REPO_ROOT, 'scripts', 'sdlc', 'validate-requirements.js');
  if (fs.existsSync(validateScript)) {
    spawnSync(process.execPath, [validateScript, '--state', tmpStatePath], {
      encoding: 'utf8',
      cwd     : tmpDir,
    });
  }

  const stateAfter = fs.readFileSync(tmpStatePath);
  assert(
    stateBefore.equals(stateAfter),
    'state.json was modified despite missing scope artifact'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── 9. AJV Hard Block — No Write on Invalid Requirements ────────────────────
console.log('\n── 9. AJV Hard Block ───────────────────────────────────────────');

test('validate-requirements.js exits non-zero on invalid requirements', () => {
  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-ajv-'));
  const tmpStatePath = path.join(tmpDir, 'state.json');
  const tmpReqPath   = path.join(tmpDir, 'requirements.json');

  // Invalid requirement — empty acceptanceCriteria (minItems: 1)
  const invalidState = {
    projectName : 'Test',
    clientName  : 'Test',
    currentPhase: 'discovery',
    requirements: [
      {
        id                 : 'REQ-FUNC-001',
        type               : 'functional',
        title              : 'Test',
        description        : 'The system shall test.',
        priority           : 'must',
        source             : 'Test',
        status             : 'draft',
        acceptanceCriteria : [],  // invalid — minItems: 1
        traceForward       : { designComponentIds: [], testCaseIds: [], costLineItemIds: [] },
      },
    ],
    artifacts: { scope: { path: 'scope-v1.md', version: 1 } },
  };

  fs.writeFileSync(tmpStatePath, JSON.stringify(invalidState, null, 2));
  fs.writeFileSync(tmpReqPath, JSON.stringify(invalidState.requirements, null, 2));
  const stateBefore = fs.readFileSync(tmpStatePath);

  const validateScript = path.join(REPO_ROOT, 'scripts', 'sdlc', 'validate-requirements.js');
  const res = spawnSync(
    process.execPath,
    [validateScript, '--state', tmpStatePath],
    { encoding: 'utf8', cwd: tmpDir }
  );

  assert(res.status !== 0, 'validate-requirements.js should exit non-zero on invalid requirements');

  const stateAfter = fs.readFileSync(tmpStatePath);
  assert(
    stateBefore.equals(stateAfter),
    'state.json was modified despite AJV validation failure'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validate-requirements.js exits 0 on valid requirements', () => {
  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-ajv-valid-'));
  const tmpStatePath = path.join(tmpDir, 'state.json');

  const validState = {
    projectName : 'Test',
    clientName  : 'Test',
    currentPhase: 'requirements',
    requirements: [
      {
        id                 : 'REQ-FUNC-001',
        type               : 'functional',
        title              : 'Test requirement',
        description        : 'The system shall test.',
        priority           : 'must',
        source             : 'RFP Section 1',
        status             : 'draft',
        acceptanceCriteria : ['Given test, when run, then passes.'],
        traceForward       : { designComponentIds: [], testCaseIds: [], costLineItemIds: [] },
      },
    ],
    artifacts: { scope: { path: 'scope-v1.md', version: 1 } },
  };

  fs.writeFileSync(tmpStatePath, JSON.stringify(validState, null, 2));

  const validateScript = path.join(REPO_ROOT, 'scripts', 'sdlc', 'validate-requirements.js');
  const res = spawnSync(
    process.execPath,
    [validateScript, '--state', tmpStatePath],
    { encoding: 'utf8', cwd: tmpDir }
  );

  assert(res.status === 0,
    `validate-requirements.js failed on valid requirements:\n${res.stderr}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
console.log(`${'─'.repeat(60)}\n`);

process.exitCode = failed > 0 ? 1 : 0;
