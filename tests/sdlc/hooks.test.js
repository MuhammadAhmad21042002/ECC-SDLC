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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function main() {
  console.log('\n=== Testing SDLC hooks ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const sessionStartHook = path.join(repoRoot, 'hooks', 'sdlc', 'sdlc-session-start.js');
  const sessionEndHook = path.join(repoRoot, 'hooks', 'sdlc', 'sdlc-session-end.js');

  const projectRoot = mkTmpDir('ecc-sdlc-hooks-');
  const statePath = path.join(projectRoot, '.sdlc', 'state.json');
  const logPath = path.join(projectRoot, '.sdlc', 'sessions.log');

  if (test('SessionStart no-ops when state.json does not exist', () => {
    const res = runNode(sessionStartHook, { cwd: projectRoot });
    assert.strictEqual(res.status, 0);
    assert.strictEqual((res.stdout || '').trim(), '');
  })) passed++; else failed++;

  if (test('SessionStart outputs JSON payload when state.json exists', () => {
    const validStateFixture = readJson(path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-state.json'));
    writeJson(statePath, validStateFixture);

    const res = runNode(sessionStartHook, { cwd: projectRoot });
    assert.strictEqual(res.status, 0);
    const out = (res.stdout || '').trim();
    assert.ok(out.startsWith('{') && out.endsWith('}'), 'Expected JSON payload on stdout');
    const payload = JSON.parse(out);
    assert.ok(payload.hookSpecificOutput);
    assert.strictEqual(payload.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.ok(String(payload.hookSpecificOutput.additionalContext || '').includes('Demo Project'));
  })) passed++; else failed++;

  if (test('Stop hook flushes lastSavedAt and appends sessions.log', () => {
    const before = readJson(statePath);
    assert.ok(before && typeof before === 'object');

    const res = runNode(sessionEndHook, { cwd: projectRoot, stdin: '{}' });
    assert.strictEqual(res.status, 0);

    const after = readJson(statePath);
    assert.ok(typeof after.lastSavedAt === 'string' && after.lastSavedAt.length > 0, 'Expected lastSavedAt to be set');

    assert.ok(fs.existsSync(logPath), 'Expected sessions.log to exist');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, 'Expected at least one log entry');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(entry.projectName, 'Demo Project');
  })) passed++; else failed++;

  const phaseGateHook = path.join(repoRoot, 'hooks', 'sdlc', 'phase-gate.js');

  if (test('phase-gate fires in logging mode and does not block (AC6)', () => {
    // Write a fresh project dir with discovery-phase state (no artifact files on disk)
    const gateRoot = mkTmpDir('ecc-sdlc-phase-gate-');
    const gateStatePath = path.join(gateRoot, '.sdlc', 'state.json');
    const gateLogPath = path.join(gateRoot, '.sdlc', 'sessions.log');

    const discoveryState = readJson(path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-state.json'));
    writeJson(gateStatePath, discoveryState);

    // Run phase-gate without ECC_PHASE_GATE_ENABLED — defaults to logging mode
    const res = runNode(phaseGateHook, {
      cwd: gateRoot,
      stdin: JSON.stringify({ cwd: gateRoot }),
      env: { ECC_PHASE_GATE_ENABLED: '' },
    });

    // Must not block (exit 0)
    assert.strictEqual(res.status, 0, `Expected exit 0 but got ${res.status}. stderr: ${res.stderr}`);

    // Must log current phase and mode
    const stderr = res.stderr || '';
    assert.ok(stderr.includes('mode=logging'), `Expected stderr to contain "mode=logging". Got: ${stderr}`);
    assert.ok(stderr.includes('currentPhase=discovery'), `Expected stderr to contain "currentPhase=discovery". Got: ${stderr}`);

    // Must append an allowed entry to sessions.log
    assert.ok(fs.existsSync(gateLogPath), 'Expected sessions.log to be created by phase-gate');
    const lines = fs.readFileSync(gateLogPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, 'Expected at least one sessions.log entry');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(entry.type, 'phase-gate');
    assert.strictEqual(entry.result, 'allowed');
    assert.strictEqual(entry.mode, 'logging');
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

