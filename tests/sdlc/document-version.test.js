'use strict';

/**
 * Tests for hooks/sdlc/document-version.js
 *
 * Per JIRA ticket spec:
 *   Unit 1 — modified artifact: scope.docx SHA-256 changes → version incremented by 0.1 and new hash saved
 *   Unit 2 — unmodified artifact: no artifact changes → all version numbers and hashes unchanged
 *   Unit 3 — exit code: document-version.js always returns exit code 0 (both scenarios)
 *   Unit 4 — multiple artifacts modified: scope AND srs both change → both get independent 0.1 increment
 *
 * Additional coverage:
 *   Unit 5 — no state.json found → exits 0, no error
 *   Unit 6 — session snapshot used when present → baseline is snapshot hash, not state hash
 *   Unit 7 — falls back to state.json hash when no snapshot exists
 *   Unit 8 — version history accumulates (does not overwrite prior rows)
 *   Unit 9 — version increments correctly: 1.0→1.1, 1.9→2.0, 2.1→2.2
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}\n    Error: ${err.message}`);
    return false;
  }
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Run document-version.js hook in a given project dir.
 */
function runHook(projectDir, env = {}) {
  const hookPath = path.resolve(__dirname, '..', '..', 'hooks', 'sdlc', 'document-version.js');
  return spawnSync(process.execPath, [hookPath], {
    cwd: projectDir,
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 5 * 1024 * 1024
  });
}

/**
 * Create a minimal SDLC project structure with a real artifact file.
 * Returns { projectDir, statePath, artifactPath, artifactBuf }
 */
function makeProject(prefix, opts = {}) {
  const projectDir = mkTmpDir(prefix);
  const sdlcDir = path.join(projectDir, '.sdlc');
  const artifacts = path.join(sdlcDir, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });

  // Create a fake artifact file
  const artifactBuf = Buffer.from('fake scope docx content v1 ' + Date.now());
  const artifactPath = path.join(artifacts, 'scope-v1.docx');
  fs.writeFileSync(artifactPath, artifactBuf);

  const artifactHash = sha256(artifactBuf);

  const baseState = {
    $schema: '../schemas/sdlc-state.schema.json',
    projectId: '11111111-2222-4333-8444-555555555555',
    projectName: 'Test Project',
    clientName: 'Test Client',
    currentPhase: 'requirements',
    phaseHistory: [{ phase: 'discovery', startedAt: '2026-03-26T00:00:00Z', completedAt: '2026-03-27T00:00:00Z' }],
    artifacts: {
      scope: {
        path: '.sdlc/artifacts/scope-v1.docx',
        version: opts.startVersion ?? 1,
        hash: artifactHash,
        createdAt: '2026-03-26T00:00:00Z',
        updatedAt: '2026-03-26T00:00:00Z',
        versionHistory: opts.priorHistory ?? [{ version: '1.0', date: '2026-03-26', author: 'ECC-SDLC', changes: 'Initial draft' }]
      },
      srs: null,
      sds: null,
      sts: null,
      estimate: null,
      proposal: null
    },
    requirements: [],
    designComponents: [],
    testCases: [],
    complianceFlags: [],
    traceabilityMatrix: {}
  };

  const statePath = path.join(sdlcDir, 'state.json');
  writeJson(statePath, baseState);

  return { projectDir, sdlcDir, statePath, artifactPath, artifactBuf, artifactHash };
}

/**
 * Write a session snapshot file as sdlc-session-start.js would.
 */
function writeSnapshot(sdlcDir, hashes) {
  const snapPath = path.join(sdlcDir, '.session-hashes.json');
  writeJson(snapPath, { capturedAt: new Date().toISOString(), hashes });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

console.log('\n=== document-version.js Unit Tests ===\n');

let passed = 0;
let failed = 0;
function record(r) {
  if (r) passed++;
  else failed++;
}

// ---------------------------------------------------------------------------
// Unit 1 — modified artifact: version incremented by 0.1, hash updated
// ---------------------------------------------------------------------------

record(
  test('Unit 1: modified artifact → version incremented by 0.1 and hash updated in state.json', () => {
    const { projectDir, sdlcDir, statePath, artifactPath, artifactHash } = makeProject('ecc-dv-u1-', { startVersion: 1 });

    // Write snapshot with the ORIGINAL hash (session started with v1 content)
    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: artifactHash, version: 1 }
    });

    // Modify the artifact file (simulates in-session edit)
    const newContent = Buffer.from('modified scope docx content during session');
    fs.writeFileSync(artifactPath, newContent);
    const newHash = sha256(newContent);

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}. stderr: ${res.stderr}`);

    const after = readJson(statePath);
    const scope = after.artifacts.scope;

    assert.ok(typeof scope.version === 'number' || typeof scope.version === 'string', 'version must be a number or string');
    const v = parseFloat(scope.version);
    assert.ok(Math.abs(v - 1.1) < 0.0001, `Expected version 1.1, got ${v}`);

    assert.strictEqual(scope.hash, newHash, `Expected hash to be updated. Got: ${scope.hash}`);

    assert.ok(typeof scope.updatedAt === 'string' && scope.updatedAt.length > 0, 'updatedAt must be set');
  })
);

// ---------------------------------------------------------------------------
// Unit 2 — unmodified artifact: version and hash unchanged
// ---------------------------------------------------------------------------

record(
  test('Unit 2: unmodified artifact → version number and hash unchanged in state.json', () => {
    const { projectDir, sdlcDir, statePath, artifactHash } = makeProject('ecc-dv-u2-', { startVersion: 2 });

    // Write snapshot with the SAME hash as current file (no modification)
    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: artifactHash, version: 2 }
    });

    const before = readJson(statePath);
    const res = runHook(projectDir);

    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);

    const after = readJson(statePath);
    assert.strictEqual(
      parseFloat(after.artifacts.scope.version),
      parseFloat(before.artifacts.scope.version),
      `Version must not change. Before: ${before.artifacts.scope.version}, After: ${after.artifacts.scope.version}`
    );
    assert.strictEqual(after.artifacts.scope.hash, before.artifacts.scope.hash, 'Hash must not change for unmodified artifact');
  })
);

// ---------------------------------------------------------------------------
// Unit 3 — exit code always 0 (both modified and unmodified scenarios)
// ---------------------------------------------------------------------------

record(
  test('Unit 3a: exit code 0 when artifact IS modified', () => {
    const { projectDir, sdlcDir, artifactPath, artifactHash } = makeProject('ecc-dv-u3a-');

    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: artifactHash, version: 1 }
    });
    fs.writeFileSync(artifactPath, Buffer.from('changed content'));

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  })
);

record(
  test('Unit 3b: exit code 0 when artifact is NOT modified', () => {
    const { projectDir, sdlcDir, artifactHash } = makeProject('ecc-dv-u3b-');

    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: artifactHash, version: 1 }
    });

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  })
);

record(
  test('Unit 3c: exit code 0 even with no state.json present', () => {
    const emptyDir = mkTmpDir('ecc-dv-u3c-');
    const res = runHook(emptyDir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
  })
);

// ---------------------------------------------------------------------------
// Unit 4 — multiple artifacts modified: scope AND srs both increment independently
// ---------------------------------------------------------------------------

record(
  test('Unit 4: scope AND srs both modified → both get independent 0.1 increments', () => {
    const projectDir = mkTmpDir('ecc-dv-u4-');
    const sdlcDir = path.join(projectDir, '.sdlc');
    const artDir = path.join(sdlcDir, 'artifacts');
    fs.mkdirSync(artDir, { recursive: true });

    // Create scope artifact
    const scopeBuf = Buffer.from('scope original content');
    const scopePath = path.join(artDir, 'scope-v1.docx');
    fs.writeFileSync(scopePath, scopeBuf);
    const scopeHash = sha256(scopeBuf);

    // Create srs artifact
    const srsBuf = Buffer.from('srs original content');
    const srsPath = path.join(artDir, 'srs-v1.docx');
    fs.writeFileSync(srsPath, srsBuf);
    const srsHash = sha256(srsBuf);

    const state = {
      projectId: '11111111-2222-4333-8444-555555555555',
      projectName: 'Multi-Artifact Project',
      clientName: 'Test Client',
      currentPhase: 'design',
      phaseHistory: [],
      artifacts: {
        scope: { path: '.sdlc/artifacts/scope-v1.docx', version: 1, hash: scopeHash, versionHistory: [{ version: '1.0', date: '2026-03-26', author: 'ECC-SDLC', changes: 'Initial' }] },
        srs: { path: '.sdlc/artifacts/srs-v1.docx', version: 1, hash: srsHash, versionHistory: [{ version: '1.0', date: '2026-03-26', author: 'ECC-SDLC', changes: 'Initial' }] },
        sds: null,
        sts: null,
        estimate: null,
        proposal: null
      },
      requirements: [],
      designComponents: [],
      testCases: [],
      complianceFlags: [],
      traceabilityMatrix: {}
    };
    writeJson(path.join(sdlcDir, 'state.json'), state);

    // Snapshot with original hashes
    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: scopeHash, version: 1 },
      srs: { path: '.sdlc/artifacts/srs-v1.docx', hash: srsHash, version: 1 }
    });

    // Modify BOTH artifacts
    fs.writeFileSync(scopePath, Buffer.from('scope modified content'));
    fs.writeFileSync(srsPath, Buffer.from('srs modified content'));

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);

    const after = readJson(path.join(sdlcDir, 'state.json'));

    const scopeV = parseFloat(after.artifacts.scope.version);
    const srsV = parseFloat(after.artifacts.srs.version);

    assert.ok(Math.abs(scopeV - 1.1) < 0.0001, `scope version should be 1.1, got ${scopeV}`);
    assert.ok(Math.abs(srsV - 1.1) < 0.0001, `srs version should be 1.1, got ${srsV}`);

    // Hashes must be updated
    const newScopeHash = sha256(fs.readFileSync(scopePath));
    const newSrsHash = sha256(fs.readFileSync(srsPath));
    assert.strictEqual(after.artifacts.scope.hash, newScopeHash, 'scope hash not updated');
    assert.strictEqual(after.artifacts.srs.hash, newSrsHash, 'srs hash not updated');
  })
);

// ---------------------------------------------------------------------------
// Unit 5 — no state.json → exits 0 cleanly
// ---------------------------------------------------------------------------

record(
  test('Unit 5: no state.json found → exits 0, no crash', () => {
    const dir = mkTmpDir('ecc-dv-u5-');
    const res = runHook(dir);
    assert.strictEqual(res.status, 0, `Expected exit 0, got ${res.status}`);
    assert.ok(!res.stderr.includes('ERROR:'), `Unexpected ERROR in stderr: ${res.stderr}`);
  })
);

// ---------------------------------------------------------------------------
// Unit 6 — session snapshot used when present (baseline = snapshot hash)
// ---------------------------------------------------------------------------

record(
  test('Unit 6: when session snapshot exists, baseline is snapshot hash (not state.json hash)', () => {
    const { projectDir, sdlcDir, statePath, artifactPath } = makeProject('ecc-dv-u6-');

    // Modify artifact BEFORE writing the snapshot (simulates: artifact already changed before session start)
    const modifiedBuf = Buffer.from('already-modified content before session');
    fs.writeFileSync(artifactPath, modifiedBuf);
    const modifiedHash = sha256(modifiedBuf);

    // State.json has OLD hash — but snapshot was written AFTER the modification
    // so snapshot reflects current file → no change detected vs snapshot
    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: modifiedHash, version: 1 }
    });

    const before = readJson(statePath);
    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0);

    const after = readJson(statePath);
    // Version should NOT change — snapshot hash matches current file
    assert.strictEqual(parseFloat(after.artifacts.scope.version), parseFloat(before.artifacts.scope.version), 'Version should not increment when snapshot hash matches current file');
  })
);

// ---------------------------------------------------------------------------
// Unit 7 — fallback to state.json hashes when no snapshot
// ---------------------------------------------------------------------------

record(
  test('Unit 7: when no session snapshot, falls back to state.json hash comparison', () => {
    const { projectDir, statePath, artifactPath, artifactHash } = makeProject('ecc-dv-u7-');
    // Do NOT write a snapshot

    // Modify the artifact file
    fs.writeFileSync(artifactPath, Buffer.from('changed in session without snapshot'));

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0);

    const after = readJson(statePath);
    const v = parseFloat(after.artifacts.scope.version);
    // state.json had original hash → disk hash differs → should increment
    assert.ok(Math.abs(v - 1.1) < 0.0001, `Expected fallback to detect change and increment to 1.1, got ${v}`);
  })
);

// ---------------------------------------------------------------------------
// Unit 8 — versionHistory accumulates (does not overwrite prior rows)
// ---------------------------------------------------------------------------

record(
  test('Unit 8: versionHistory accumulates — prior rows preserved, new row appended', () => {
    const priorHistory = [
      { version: '1.0', date: '2026-03-26', author: 'ECC-SDLC', changes: 'Initial draft' },
      { version: '1.1', date: '2026-03-27', author: 'ECC-SDLC (auto)', changes: 'SCOPE artifact modified during session' }
    ];
    const { projectDir, sdlcDir, statePath, artifactPath, artifactHash } = makeProject('ecc-dv-u8-', {
      startVersion: 1.1,
      priorHistory
    });

    writeSnapshot(sdlcDir, {
      scope: { path: '.sdlc/artifacts/scope-v1.docx', hash: artifactHash, version: 1.1 }
    });

    fs.writeFileSync(artifactPath, Buffer.from('second in-session modification'));

    const res = runHook(projectDir);
    assert.strictEqual(res.status, 0);

    const after = readJson(statePath);
    const vh = after.artifacts.scope.versionHistory;

    assert.ok(Array.isArray(vh), 'versionHistory must be an array');
    assert.strictEqual(vh.length, 3, `Expected 3 rows (2 prior + 1 new), got ${vh.length}`);

    // Prior rows preserved exactly
    assert.strictEqual(vh[0].version, '1.0', 'First prior row must be preserved');
    assert.strictEqual(vh[1].version, '1.1', 'Second prior row must be preserved');

    // New row added
    assert.strictEqual(parseFloat(vh[2].version), 1.2, `New row version should be 1.2, got ${vh[2].version}`);
    assert.ok(vh[2].changes.toLowerCase().includes('modified'), 'New row changes should mention modification');
  })
);

// ---------------------------------------------------------------------------
// Unit 9 — version increment arithmetic
// ---------------------------------------------------------------------------

record(
  test('Unit 9a: incrementVersion(1) → 1.1', () => {
    // Test the arithmetic inline (replicates the hook logic)
    function inc(v) {
      const n = typeof v === 'number' ? v : parseFloat(v) || 0;
      return Math.round((n + 0.1) * 10) / 10;
    }
    assert.strictEqual(inc(1), 1.1);
    assert.strictEqual(inc(1.1), 1.2);
    assert.strictEqual(inc(1.9), 2.0);
    assert.strictEqual(inc(2), 2.1);
    assert.strictEqual(inc(2.1), 2.2);
    assert.strictEqual(inc(1.0), 1.1);
  })
);

record(
  test('Unit 9b: 1.9 increments to 2.0 (no floating point drift)', () => {
    function inc(v) {
      return Math.round((v + 0.1) * 10) / 10;
    }
    const result = inc(1.9);
    assert.strictEqual(result, 2.0, `Expected 2.0, got ${result}`);
  })
);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
