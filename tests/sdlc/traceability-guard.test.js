'use strict';

/**
 * Tests for hooks/sdlc/traceability-guard.js
 *
 * Covers:
 *   Unit 1  — warning fires for SDS section with no REQ-* in body
 *   Unit 2  — silent pass when section body contains a REQ-* reference
 *   Unit 3  — non-SDLC file produces zero output
 *   Unit 4  — exit code is always 0 (warning and silent-pass scenarios)
 *   Unit 5  — regex matches valid IDs: REQ-FUNC-001, REQ-NFUNC-012, REQ-CON-099
 *   Unit 6  — regex rejects invalid strings: FUNC-001, REQ-001, REQ-FUNC-01, req-func-001
 *   Integration 1 — mixed SDS file: warns only for section without REQ-*, silent on section with it
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

/**
 * Write content to a file, creating parent directories as needed.
 * @param {string} filePath
 * @param {string} content
 */
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Run the traceability-guard hook via Node, feeding a JSON payload on stdin.
 *
 * @param {{ cwd: string, filePath: string }} opts
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runHook(opts) {
  const payload = JSON.stringify({
    cwd: opts.cwd,
    tool_name: opts.toolName || 'Write',
    tool_input: { file_path: opts.filePath },
  });

  const result = spawnSync(process.execPath, [HOOK_PATH], {
    cwd: opts.cwd,
    input: payload,
    encoding: 'utf8',
    env: { ...process.env },
    maxBuffer: 5 * 1024 * 1024,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// ---------------------------------------------------------------------------
// Inline extraction of isInScope and REQ_PATTERN for pure-unit regex tests.
// These replicate the exact logic from the hook without spawning a process.
// ---------------------------------------------------------------------------

const REQ_PATTERN = /REQ-(FUNC|NFUNC|CON)-[0-9]{3}/;

function isInScope(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  return /(^|\/)\.sdlc\/artifacts\/(sds|sts)-/.test(normalized);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const HOOK_PATH = path.resolve(__dirname, '..', '..', 'hooks', 'sdlc', 'traceability-guard.js');

console.log('SDLC Traceability Guard Hook Tests\n');

let passed = 0;
let failed = 0;

function record(result) {
  if (result) passed++;
  else failed++;
}

// ---------------------------------------------------------------------------
// Unit 1 — warning fires for SDS section with no REQ-* in body
// ---------------------------------------------------------------------------

record(test('Unit 1: warns for SDS section with no REQ-* reference', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-unit1-');
  const artifactDir = path.join(dir, '.sdlc', 'artifacts');
  const sdsFile = path.join(artifactDir, 'sds-v1.md');

  writeFile(sdsFile, [
    '# Software Design Specification',
    '',
    '## Component Architecture',
    '',
    'This section describes the component architecture of the system.',
    'It does not contain any requirement references.',
    '',
  ].join('\n'));

  const res = runHook({ cwd: dir, filePath: sdsFile });

  assert.strictEqual(res.status, 0, 'exit code must be 0');
  assert.ok(
    res.stderr.includes('[TRACEABILITY]'),
    `expected [TRACEABILITY] warning in stderr, got: ${res.stderr}`,
  );
  assert.ok(
    res.stderr.includes('Component Architecture'),
    `expected heading text in warning, got: ${res.stderr}`,
  );
  assert.ok(
    res.stderr.includes('sds-v1.md'),
    `expected filename in warning, got: ${res.stderr}`,
  );
  assert.ok(
    res.stderr.includes('traceability gap'),
    `expected 'traceability gap' in warning, got: ${res.stderr}`,
  );
}));

// ---------------------------------------------------------------------------
// Unit 2 — silent pass when section body contains REQ-FUNC-001
// ---------------------------------------------------------------------------

record(test('Unit 2: silent when section body contains REQ-* reference', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-unit2-');
  const artifactDir = path.join(dir, '.sdlc', 'artifacts');
  const sdsFile = path.join(artifactDir, 'sds-v1.md');

  writeFile(sdsFile, [
    '# Software Design Specification',
    '',
    '## Authentication Module',
    '',
    'Implements login flow per REQ-FUNC-001.',
    'Users must supply valid credentials.',
    '',
  ].join('\n'));

  const res = runHook({ cwd: dir, filePath: sdsFile });

  assert.strictEqual(res.status, 0, 'exit code must be 0');
  assert.strictEqual(
    res.stderr.trim(),
    '',
    `expected no stderr output, got: ${res.stderr}`,
  );
}));

// ---------------------------------------------------------------------------
// Unit 3 — non-SDLC file produces zero output
// ---------------------------------------------------------------------------

record(test('Unit 3: non-SDLC file (README.md) produces zero output', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-unit3-');
  const readmeFile = path.join(dir, 'README.md');

  writeFile(readmeFile, [
    '# My Project',
    '',
    '## Overview',
    '',
    'No REQ references here — but this file is out of scope.',
    '',
  ].join('\n'));

  const res = runHook({ cwd: dir, filePath: readmeFile });

  assert.strictEqual(res.status, 0, 'exit code must be 0');
  assert.strictEqual(
    res.stderr.trim(),
    '',
    `expected zero output for non-SDLC file, got: ${res.stderr}`,
  );
  assert.strictEqual(
    res.stdout.trim(),
    '',
    `expected zero stdout, got: ${res.stdout}`,
  );
}));

// ---------------------------------------------------------------------------
// Unit 4 — exit code always 0
// ---------------------------------------------------------------------------

record(test('Unit 4a: exit code 0 on warning scenario', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-unit4a-');
  const sdsFile = path.join(dir, '.sdlc', 'artifacts', 'sds-v1.md');

  writeFile(sdsFile, '## Missing Refs\n\nNo requirement references here.\n');

  const res = runHook({ cwd: dir, filePath: sdsFile });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}`);
}));

record(test('Unit 4b: exit code 0 on silent-pass scenario', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-unit4b-');
  const stsFile = path.join(dir, '.sdlc', 'artifacts', 'sts-v1.md');

  writeFile(stsFile, '## Login Test\n\nVerifies REQ-FUNC-001 acceptance criteria.\n');

  const res = runHook({ cwd: dir, filePath: stsFile });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}`);
}));

record(test('Unit 4c: exit code 0 when no file_path in payload', () => {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ cwd: process.cwd(), tool_name: 'Write', tool_input: {} }),
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}`);
}));

// ---------------------------------------------------------------------------
// Unit 5 — regex matches valid REQ IDs
// ---------------------------------------------------------------------------

record(test('Unit 5: REQ-FUNC-001 matches', () => {
  assert.ok(REQ_PATTERN.test('REQ-FUNC-001'), 'REQ-FUNC-001 should match');
}));

record(test('Unit 5: REQ-NFUNC-012 matches', () => {
  assert.ok(REQ_PATTERN.test('REQ-NFUNC-012'), 'REQ-NFUNC-012 should match');
}));

record(test('Unit 5: REQ-CON-099 matches', () => {
  assert.ok(REQ_PATTERN.test('REQ-CON-099'), 'REQ-CON-099 should match');
}));

// ---------------------------------------------------------------------------
// Unit 6 — regex rejects invalid strings
// ---------------------------------------------------------------------------

record(test('Unit 6: FUNC-001 does not match (missing REQ- prefix)', () => {
  assert.ok(!REQ_PATTERN.test('FUNC-001'), 'FUNC-001 should not match');
}));

record(test('Unit 6: REQ-001 does not match (missing type segment)', () => {
  assert.ok(!REQ_PATTERN.test('REQ-001'), 'REQ-001 should not match');
}));

record(test('Unit 6: REQ-FUNC-01 does not match (only 2 digits)', () => {
  assert.ok(!REQ_PATTERN.test('REQ-FUNC-01'), 'REQ-FUNC-01 should not match');
}));

record(test('Unit 6: req-func-001 does not match (lowercase)', () => {
  assert.ok(!REQ_PATTERN.test('req-func-001'), 'req-func-001 should not match');
}));

// ---------------------------------------------------------------------------
// Integration 1 — mixed SDS: warn for section without REQ-*, silent on one with it
// ---------------------------------------------------------------------------

record(test('Integration 1: warns only for section missing REQ-*, silent on section with REQ-FUNC-005', () => {
  const dir = mkTmpDir('ecc-sdlc-tg-int1-');
  const sdsFile = path.join(dir, '.sdlc', 'artifacts', 'sds-v2.md');

  writeFile(sdsFile, [
    '# Software Design Specification',
    '',
    '## Data Model',
    '',
    'This section has no requirement references — should trigger a warning.',
    '',
    '## API Gateway',
    '',
    'Implements the public API endpoints per REQ-FUNC-005.',
    'Handles request routing and authentication.',
    '',
  ].join('\n'));

  const res = runHook({ cwd: dir, filePath: sdsFile });

  assert.strictEqual(res.status, 0, 'exit code must be 0');

  // Warning for "Data Model" (no REQ-*)
  assert.ok(
    res.stderr.includes('Data Model'),
    `expected warning for 'Data Model' section, got: ${res.stderr}`,
  );

  // No warning for "API Gateway" (has REQ-FUNC-005)
  assert.ok(
    !res.stderr.includes('API Gateway'),
    `expected no warning for 'API Gateway' section, got: ${res.stderr}`,
  );

  // Exactly one warning line
  const warningLines = res.stderr.split('\n').filter(l => l.includes('[TRACEABILITY]'));
  assert.strictEqual(
    warningLines.length,
    1,
    `expected exactly 1 warning, got ${warningLines.length}: ${res.stderr}`,
  );
}));

// ---------------------------------------------------------------------------
// Scope function unit tests (fast, no subprocess)
// ---------------------------------------------------------------------------

record(test('Scope: .sdlc/artifacts/sds-v1.md is in scope (relative)', () => {
  assert.ok(isInScope('.sdlc/artifacts/sds-v1.md'));
}));

record(test('Scope: /project/.sdlc/artifacts/sts-v2.md is in scope (absolute)', () => {
  assert.ok(isInScope('/project/.sdlc/artifacts/sts-v2.md'));
}));

record(test('Scope: README.md is not in scope', () => {
  assert.ok(!isInScope('README.md'));
}));

record(test('Scope: src/components/App.js is not in scope', () => {
  assert.ok(!isInScope('src/components/App.js'));
}));

record(test('Scope: .sdlc/artifacts/scope-v1.docx is not in scope (not sds/sts)', () => {
  assert.ok(!isInScope('.sdlc/artifacts/scope-v1.docx'));
}));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
