const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stateManager = require('../../lib/state-manager');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => { console.log(`  ✓ ${name}`); return true; })
        .catch(err => { console.log(`  ✗ ${name}\n    Error: ${err.message}`); return false; });
    }
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

function main() {
  console.log('\n=== Testing SDLC state-manager ===\n');

  let passed = 0;
  let failed = 0;

  const projectRoot = mkTmpDir('ecc-sdlc-state-');
  const statePath = path.join(projectRoot, '.sdlc', 'state.json');

  if (test('initProject creates .sdlc/state.json with valid defaults', () => {
    const state = stateManager.initProject('Demo Project', 'Demo Client', { projectRoot });
    assert.ok(fs.existsSync(statePath), 'state.json was not created');
    assert.strictEqual(state.projectName, 'Demo Project');
    assert.strictEqual(state.clientName, 'Demo Client');
    assert.strictEqual(state.currentPhase, 'discovery');
    assert.ok(state.projectId && typeof state.projectId === 'string');
    assert.ok(state.artifacts && typeof state.artifacts === 'object');
  })) passed++; else failed++;

  if (test('loadState reads created state.json', () => {
    const loaded = stateManager.loadState({ projectRoot });
    assert.strictEqual(loaded.projectName, 'Demo Project');
    assert.strictEqual(loaded.clientName, 'Demo Client');
  })) passed++; else failed++;

  if (test('saveState rejects invalid state (missing required field)', () => {
    const bad = readJson(statePath);
    delete bad.projectId;
    assert.throws(() => stateManager.saveState(bad, { projectRoot }), /Schema validation failed|Invalid/);
  })) passed++; else failed++;

  if (test('updatePhase appends phaseHistory and updates currentPhase', () => {
    const current = stateManager.loadState({ projectRoot });
    const updated = stateManager.updatePhase(current, 'requirements');
    assert.strictEqual(updated.currentPhase, 'requirements');
    assert.ok(Array.isArray(updated.phaseHistory));
    assert.ok(updated.phaseHistory.some(p => p.phase === 'requirements'));
  })) passed++; else failed++;

  if (test('registerArtifact computes sha256 hash and increments version', () => {
    const artifactFile = path.join(projectRoot, 'documents', 'scope-v1.docx');
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, Buffer.from('test-artifact-bytes'));

    const current = stateManager.loadState({ projectRoot });
    const s1 = stateManager.registerArtifact(current, 'scope', artifactFile);
    assert.ok(s1.artifacts.scope);
    assert.strictEqual(s1.artifacts.scope.version, 1);
    assert.ok(String(s1.artifacts.scope.hash).startsWith('sha256:'), 'hash should start with sha256:');

    const s2 = stateManager.registerArtifact(s1, 'scope', artifactFile);
    assert.strictEqual(s2.artifacts.scope.version, 2);
  })) passed++; else failed++;

  if (test('loadOrInit loads existing state, does not overwrite', () => {
    const loaded = stateManager.loadOrInit('Ignored', 'Ignored', { projectRoot });
    assert.strictEqual(loaded.projectName, 'Demo Project');
    assert.strictEqual(loaded.clientName, 'Demo Client');
  })) passed++; else failed++;

  if (test('saveState can overwrite existing state.json (Windows-safe replace)', () => {
    const s1 = stateManager.loadState({ projectRoot });
    const s2 = { ...s1, clientName: 'Demo Client Updated' };
    stateManager.saveState(s2, { projectRoot });
    const s3 = stateManager.loadState({ projectRoot });
    assert.strictEqual(s3.clientName, 'Demo Client Updated');
  })) passed++; else failed++;

  if (test('registerArtifact rejects invalid artifact types', () => {
    const artifactFile = path.join(projectRoot, 'documents', 'dummy.bin');
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, Buffer.from('x'));
    const current = stateManager.loadState({ projectRoot });
    assert.throws(() => stateManager.registerArtifact(current, 'bogus', artifactFile), /Artifact type must be one of/);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

