const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

function runNode(args, options = {}) {
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    ...options,
  });
  return res;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  }
}

console.log('\n=== Testing SDLC CLI scripts ===\n');

test('validate-json accepts valid-sds fixture', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-sds.json');
  const script = path.join(repoRoot, 'scripts', 'validate-json.js');

  const res = runNode([script, '--schema', 'sds', '--file', fixture], { cwd: repoRoot });
  assert.strictEqual(res.status, 0);
  assert.match((res.stdout || '').trim(), /^OK:sds:/);
});

test('validate-json rejects invalid-sds fixture', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'invalid-sds.json');
  const script = path.join(repoRoot, 'scripts', 'validate-json.js');

  const res = runNode([script, '--schema', 'sds', '--file', fixture], { cwd: repoRoot });
  assert.notStrictEqual(res.status, 0);
  assert.match((res.stderr || ''), /^ERR:sds:/m);
});

test('validate-design-components accepts valid design-component fixture wrapped in array', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-design-component.json');
  const tmpFile = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', '__tmp-design-components.json');
  const script = path.join(repoRoot, 'scripts', 'validate-design-components.js');

  const dc = require(fixture);
  require('fs').writeFileSync(tmpFile, JSON.stringify([dc], null, 2), 'utf8');

  const res = runNode([script, '--file', tmpFile], { cwd: repoRoot });
  assert.strictEqual(res.status, 0);
  assert.match((res.stdout || '').trim(), /^OK:design-components:/);
});

test('generate-scope-doc renders scope docx from valid-scope fixture', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fs = require('fs');
  const os = require('os');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-scope.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-scope-gen-'));
  const dataFile = path.join(tmpDir, 'scope-in.json');
  const outFile = path.join(tmpDir, 'scope-v1.docx');
  const script = path.join(repoRoot, 'scripts', 'generate-scope-doc.js');

  const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  raw.projectName = 'Demo Project';
  raw.clientName = 'Demo Client';
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  const res = runNode([script, '--data', dataFile, '--out', outFile], { cwd: repoRoot });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  const buf = fs.readFileSync(outFile);
  assert.ok(buf.length > 200);
  assert.strictEqual(buf[0], 0x50);
  assert.strictEqual(buf[1], 0x4b);
});

test('generate-sds-doc renders sds docx from valid-sds fixture', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fs = require('fs');
  const os = require('os');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-sds.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sds-gen-'));
  const dataFile = path.join(tmpDir, 'sds-in.json');
  const outFile = path.join(tmpDir, 'sds-v1.docx');
  const script = path.join(repoRoot, 'scripts', 'generate-sds-doc.js');

  const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  raw.projectName = 'Demo SDS Project';
  raw.clientName = 'Demo Client';
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  const res = runNode(
    [script, '--data', dataFile, '--out', outFile, '--version', '1'],
    { cwd: repoRoot }
  );
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual((res.stdout || '').trim(), '');
  const buf = fs.readFileSync(outFile);
  assert.ok(buf.length > 200);
  assert.strictEqual(buf[0], 0x50);
  assert.strictEqual(buf[1], 0x4b);
});

test('generate-sds-doc version 2 merges prior versionHistory from state.json', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fs = require('fs');
  const os = require('os');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-sds.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sds-gen-v2-'));
  const dataFile = path.join(tmpDir, 'sds-in.json');
  const stateFile = path.join(tmpDir, 'state.json');
  const outFile = path.join(tmpDir, 'sds-v2.docx');
  const script = path.join(repoRoot, 'scripts', 'generate-sds-doc.js');

  const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        artifacts: {
          sds: {
            path: '.sdlc/artifacts/sds-v1.docx',
            version: 1,
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-01T10:00:00.000Z',
            versionHistory: [
              {
                version: '1.0',
                date: '2026-04-01',
                author: 'ECC-SDLC',
                changes: 'Initial SDS',
                status: 'Approved',
              },
            ],
          },
        },
      },
      null,
      2
    ),
    'utf8'
  );

  const res = runNode(
    [script, '--data', dataFile, '--out', outFile, '--version', '2', '--state', stateFile],
    { cwd: repoRoot }
  );
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual((res.stdout || '').trim(), '');
  const buf = fs.readFileSync(outFile);
  assert.ok(buf.length > 200);
  assert.strictEqual(buf[0], 0x50);
  assert.strictEqual(buf[1], 0x4b);
});

test('generate-sds-doc exits 2 when --data or --out is missing', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const script = path.join(repoRoot, 'scripts', 'generate-sds-doc.js');

  const res = runNode([script], { cwd: repoRoot });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr || '', /Usage:/);
});

test('generate-srs-doc renders srs docx from valid-srs fixture', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fs = require('fs');
  const os = require('os');
  const fixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-srs.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-srs-gen-'));
  const dataFile = path.join(tmpDir, 'srs-in.json');
  const outFile = path.join(tmpDir, 'srs-v1.docx');
  const script = path.join(repoRoot, 'scripts', 'generate-srs-doc.js');

  const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

  const res = runNode(
    [script, '--data', dataFile, '--out', outFile, '--version', '1'],
    { cwd: repoRoot }
  );
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual((res.stdout || '').trim(), '');
  const buf = fs.readFileSync(outFile);
  assert.ok(buf.length > 200);
  assert.strictEqual(buf[0], 0x50);
  assert.strictEqual(buf[1], 0x4b);
});

test('generate-srs-doc exits 2 when --data or --out is missing', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const script = path.join(repoRoot, 'scripts', 'generate-srs-doc.js');

  const res = runNode([script], { cwd: repoRoot });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr || '', /Usage:/);
});

test('traceability-update fails when must requirements lack DC mapping', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const stateFixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-state.json');
  const reqFixture = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-requirement.json');
  const tmpState = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', '__tmp-state-trace.json');
  const script = path.join(repoRoot, 'scripts', 'traceability-update.js');

  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync(stateFixture, 'utf8'));
  // Ensure there is at least one must requirement and no design components.
  const req = JSON.parse(fs.readFileSync(reqFixture, 'utf8'));
  state.requirements = [{ ...req, priority: 'must' }];
  state.designComponents = [];
  fs.writeFileSync(tmpState, JSON.stringify(state, null, 2), 'utf8');

  const res = runNode([script, '--state', tmpState, '--enforceMustDcCoverage'], { cwd: repoRoot });
  assert.notStrictEqual(res.status, 0);
  assert.match((res.stderr || ''), /^ERR:must-dc-coverage:/m);
});

