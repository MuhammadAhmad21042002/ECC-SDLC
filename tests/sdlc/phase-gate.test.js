const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function runNode(scriptPath, options = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: options.cwd,
    input: options.stdin || '',
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 5 * 1024 * 1024,
  });
}

function makeState({ currentPhase, artifacts }) {
  return {
    version: 1,
    projectName: 'Test Project',
    clientName: 'Test Client',
    currentPhase,
    phaseHistory: [],
    artifacts: artifacts || {},
    requirements: { items: [] },
    compliance: { flags: [] },
    traceability: { coverage: { must: 0, should: 0, could: 0, wont: 0 } },
  };
}

console.log('SDLC Phase Gate Hook Tests\n');

let passed = 0;
let failed = 0;

const hookPath = path.resolve(__dirname, '..', '..', 'hooks', 'sdlc', 'phase-gate.js');

if (
  test('enforcing blocks when currentPhase prerequisites missing', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(path.join(dir, '.sdlc', 'state.json'), makeState({ currentPhase: 'requirements' }));
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_MODE: 'enforcing' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 2);
    assert.ok(String(res.stderr || '').includes('SDLC:GATE:BLOCKED'));
  })
)
  passed++;
else failed++;

if (
  test('logging does not block when prerequisites missing', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(path.join(dir, '.sdlc', 'state.json'), makeState({ currentPhase: 'requirements' }));
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_MODE: 'logging' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 0);
  })
)
  passed++;
else failed++;

if (
  test('toggle OFF forces logging even if mode=enforcing', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(path.join(dir, '.sdlc', 'state.json'), makeState({ currentPhase: 'requirements' }));
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_ENABLED: 'OFF', ECC_PHASE_GATE_MODE: 'enforcing' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 0);
  })
)
  passed++;
else failed++;

if (
  test('toggle ON forces enforcing even if mode=logging', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(path.join(dir, '.sdlc', 'state.json'), makeState({ currentPhase: 'requirements' }));
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_ENABLED: 'ON', ECC_PHASE_GATE_MODE: 'logging' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 2);
  })
)
  passed++;
else failed++;

if (
  test('bypass allows even in enforcing mode', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(path.join(dir, '.sdlc', 'state.json'), makeState({ currentPhase: 'requirements' }));
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_MODE: 'enforcing', ECC_PHASE_GATE_BYPASS: 'true' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 0);
    assert.ok(String(res.stderr || '').includes('BYPASS enabled'));
  })
)
  passed++;
else failed++;

if (
  test('enforcing blocks when registered artifact path is missing on disk', () => {
    const dir = mkTmpDir('ecc-sdlc-phase-gate-');
    writeJson(
      path.join(dir, '.sdlc', 'state.json'),
      makeState({
        currentPhase: 'requirements',
        artifacts: { scope: { path: 'documents/scope.docx', version: 1, hash: 'sha256:deadbeef', createdAt: new Date().toISOString() } },
      })
    );
    const res = runNode(hookPath, {
      cwd: dir,
      env: { ECC_PHASE_GATE_MODE: 'enforcing' },
      stdin: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 'x.txt' } }),
    });
    assert.strictEqual(res.status, 2);
    assert.ok(String(res.stderr || '').includes('SDLC:ERROR:ARTIFACT_MISSING'));
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;

