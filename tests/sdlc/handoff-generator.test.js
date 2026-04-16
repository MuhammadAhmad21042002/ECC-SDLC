'use strict';

/**
 * Tests for hooks/sdlc/handoff-generator.js
 *
 * Tests:
 *  1. Generation test — complete fixture → CLAUDE.md created with all 6 sections
 *  2. STS-null test   — sts: null → no CLAUDE.md, stderr names "STS"
 *  3. SDS-null test   — sds: null → no CLAUDE.md, stderr names "SDS"
 *  4. SRS-null test   — srs: null → no CLAUDE.md, stderr names "SRS"
 *  5. CMP reference   — Architecture section contains CMP- pattern
 *  6. REQ reference   — Requirements section has ≥ 3 REQ-* IDs
 *  7. Atomic write    — pre-existing .tmp is cleaned up, final CLAUDE.md exists
 *  8. Exit code       — always 0 in both generation and non-generation cases
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '../../hooks/sdlc/handoff-generator.js');
const FIXTURE = path.resolve(__dirname, '../../test-fixtures/mock-complete-state.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}\n    ${err.message}`);
    return false;
  }
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function runHook(projectRoot) {
  const stdin = JSON.stringify({ cwd: projectRoot });
  return spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env },
    maxBuffer: 5 * 1024 * 1024
  });
}

/** Load the fixture and write it into a temp .sdlc/state.json */
function setupProject(overrides) {
  const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const state = mergeDeep(base, overrides || {});
  const projectRoot = mkTmpDir();
  writeJson(path.join(projectRoot, '.sdlc', 'state.json'), state);
  return projectRoot;
}

/** Deep merge — only plain objects are merged; arrays are replaced */
function mergeDeep(target, source) {
  const result = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = mergeDeep(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function claudeMdPath(projectRoot) {
  return path.join(projectRoot, 'CLAUDE.md');
}

function tmpPath(projectRoot) {
  return path.join(projectRoot, 'CLAUDE.md.tmp');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

console.log('\nhandoff-generator.js');

let passed = 0;
let failed = 0;

function run(name, fn) {
  const ok = test(name, fn);
  if (ok) passed++; else failed++;
}

// ---------------------------------------------------------------------------
// Test 1: Generation — complete fixture produces CLAUDE.md with all 6 sections
// ---------------------------------------------------------------------------
run('Generation: CLAUDE.md created from complete fixture', () => {
  const projectRoot = setupProject();
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, `Exit code should be 0, got ${result.status}`);
  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should exist');

  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');
  const requiredSections = [
    '# Project Overview',
    '## Architecture',
    '## Requirements',
    '## Testing Strategy',
    '## Compliance Status',
    '## Open Items'
  ];
  for (const section of requiredSections) {
    assert.ok(content.includes(section), `Missing section: "${section}"`);
  }
});

// ---------------------------------------------------------------------------
// Test 2: STS-null — no CLAUDE.md, stderr mentions "STS"
// ---------------------------------------------------------------------------
run('Non-generation (STS null): no CLAUDE.md created, stderr names STS', () => {
  const projectRoot = setupProject({ artifacts: { sts: null } });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code should be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(
    result.stderr.toUpperCase().includes('STS'),
    `stderr should name "STS", got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Test 3: SDS-null — no CLAUDE.md, stderr mentions "SDS"
// ---------------------------------------------------------------------------
run('Non-generation (SDS null): no CLAUDE.md created, stderr names SDS', () => {
  const projectRoot = setupProject({ artifacts: { sds: null } });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code should be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(
    result.stderr.toUpperCase().includes('SDS'),
    `stderr should name "SDS", got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Test 4: SRS-null — no CLAUDE.md, stderr mentions "SRS"
// ---------------------------------------------------------------------------
run('Non-generation (SRS null): no CLAUDE.md created, stderr names SRS', () => {
  const projectRoot = setupProject({ artifacts: { srs: null } });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code should be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(
    result.stderr.toUpperCase().includes('SRS'),
    `stderr should name "SRS", got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Test 5a: Component ID reference — Architecture section contains actual IDs
//          from state.designComponents (CMP-NNN convention in fixture)
// ---------------------------------------------------------------------------
run('CMP reference: Architecture section contains actual component IDs (CMP-NNN)', () => {
  const projectRoot = setupProject();
  runHook(projectRoot);

  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should exist');
  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');

  const archStart = content.indexOf('## Architecture');
  assert.ok(archStart !== -1, 'Architecture section not found');

  const afterArch = content.slice(archStart);
  const nextSection = afterArch.search(/\n## /);
  const archBody = nextSection === -1 ? afterArch : afterArch.slice(0, nextSection);

  assert.ok(
    /CMP-\d+/.test(archBody),
    'Architecture section must contain at least one CMP-NNN reference'
  );
});

// ---------------------------------------------------------------------------
// Test 5b: checkQuality enforces CMP-NNN — DC-NNN IDs do not satisfy the
//          Architecture threshold, so the write is aborted (no CLAUDE.md).
// ---------------------------------------------------------------------------
run('DC-NNN reference: quality check works when designComponents use DC-NNN IDs', () => {
  const projectRoot = setupProject({
    designComponents: [
      {
        id: 'DC-001',
        name: 'Search Engine',
        type: 'service',
        description: 'Vector search service.',
        technology: 'Node.js, Pinecone',
        tracesTo: ['REQ-FUNC-001']
      },
      {
        id: 'DC-002',
        name: 'Auth Service',
        type: 'service',
        description: 'JWT-based authentication.',
        technology: 'Node.js, Redis',
        tracesTo: ['REQ-FUNC-002']
      }
    ]
  });
  const result = runHook(projectRoot);

  // checkQuality requires at least one CMP-NNN reference in the Architecture
  // section. DC-NNN IDs do not match that pattern, so the write is aborted.
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should NOT exist with DC-NNN IDs');
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED') && result.stderr.includes('Architecture'),
    `stderr must name Architecture and [HANDOFF] ABORTED, got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Test 6: REQ reference — Requirements section has ≥ 3 REQ-* IDs
// ---------------------------------------------------------------------------
run('REQ reference: Requirements section contains ≥ 3 REQ-* IDs', () => {
  const projectRoot = setupProject();
  runHook(projectRoot);

  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should exist');
  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');

  const reqStart = content.indexOf('## Requirements');
  assert.ok(reqStart !== -1, 'Requirements section not found');

  const afterReq = content.slice(reqStart);
  const nextSection = afterReq.search(/\n## /);
  const reqBody = nextSection === -1 ? afterReq : afterReq.slice(0, nextSection);

  const matches = reqBody.match(/REQ-(?:FUNC|NFUNC|CON)-\d{3}/g) || [];
  const unique = new Set(matches);
  assert.ok(
    unique.size >= 3,
    `Requirements section must have ≥ 3 REQ-* IDs, found ${unique.size}: ${[...unique].join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Test 7: Atomic write — pre-existing .tmp removed, no partial file left
// ---------------------------------------------------------------------------
run('Atomic write: no CLAUDE.md.tmp remains after completion', () => {
  const projectRoot = setupProject();

  // Simulate a leftover .tmp from a prior interrupted write
  fs.writeFileSync(tmpPath(projectRoot), 'partial content from interrupted prior write', 'utf8');

  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, 'Exit code should be 0');

  // .tmp must be gone (either overwritten-then-renamed, or cleaned up)
  assert.ok(
    !fs.existsSync(tmpPath(projectRoot)),
    'CLAUDE.md.tmp must not exist after hook completes'
  );

  // Final CLAUDE.md must exist and be valid
  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must exist');
  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');
  assert.ok(content.includes('# Project Overview'), 'CLAUDE.md should have valid content');
  assert.ok(
    !content.includes('partial content from interrupted prior write'),
    'CLAUDE.md must not contain leftover .tmp content'
  );
});

// ---------------------------------------------------------------------------
// Test 8: Exit code — always 0 in both generation and non-generation
// ---------------------------------------------------------------------------
run('Exit code: always 0 for generation case', () => {
  const projectRoot = setupProject();
  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
});

run('Exit code: always 0 for non-generation case (all artifacts null)', () => {
  const projectRoot = setupProject({
    artifacts: { srs: null, sds: null, sts: null }
  });
  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
});

run('Exit code: always 0 when no state.json exists', () => {
  const projectRoot = mkTmpDir(); // no .sdlc dir at all
  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
});

// ---------------------------------------------------------------------------
// Gap 1: Quality check failure path — .tmp deleted, no CLAUDE.md produced
// ---------------------------------------------------------------------------
run('Quality check failure: .tmp deleted, no CLAUDE.md when requirements < 3', () => {
  // Provide fewer than MIN_REQ_IDS (3) requirements so qualityCheck fails
  const projectRoot = setupProject({
    requirements: [
      {
        id: 'REQ-FUNC-001',
        title: 'Only requirement',
        priority: 'must',
        status: 'approved'
      }
    ]
  });

  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, 'Exit code must be 0 even on quality check failure');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT be created when quality check fails');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'CLAUDE.md.tmp must not remain after quality check failure');
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED'),
    `stderr should report [HANDOFF] ABORTED, got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Gap 2 (updated): Zero designComponents — checkQuality now aborts
// Architecture section fails ≥100 char threshold + no CMP-NNN when empty
// ---------------------------------------------------------------------------
run('Zero designComponents: write aborted (Architecture fails ≥100 chars + no CMP-NNN)', () => {
  const projectRoot = setupProject({ designComponents: [] });

  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, 'Exit code must be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT be created');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'CLAUDE.md.tmp must not remain');
  assert.ok(
    result.stderr.includes('Architecture'),
    `stderr should name "Architecture" section, got: ${result.stderr}`
  );
});

// ---------------------------------------------------------------------------
// Gap 3: Corrupted / invalid JSON in state.json
// ---------------------------------------------------------------------------
run('Corrupted state.json: exit 0, no CLAUDE.md created', () => {
  const projectRoot = mkTmpDir();
  fs.mkdirSync(path.join(projectRoot, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.sdlc', 'state.json'), '{ this is not valid json !!!', 'utf8');

  const result = runHook(projectRoot);
  assert.strictEqual(result.status, 0, 'Exit code must be 0 on corrupted state.json');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT be created');
});

// ---------------------------------------------------------------------------
// Gap 4: Compliance section shows "not yet run" when complianceFlags is empty
// ---------------------------------------------------------------------------
run('Compliance section: shows "not yet run" when complianceFlags is empty', () => {
  const projectRoot = setupProject({ complianceFlags: [] });
  runHook(projectRoot);

  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should exist');
  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');

  const compStart = content.indexOf('## Compliance Status');
  assert.ok(compStart !== -1, 'Compliance Status section not found');
  const afterComp = content.slice(compStart);
  const nextSection = afterComp.search(/\n## /);
  const compBody = nextSection === -1 ? afterComp : afterComp.slice(0, nextSection);

  assert.ok(
    compBody.includes('/compliance not yet run'),
    `Compliance section should show fallback text when empty, got body: ${compBody.trim()}`
  );
});

// ---------------------------------------------------------------------------
// Gap 5: Open Items section handles empty openQuestions gracefully
// ---------------------------------------------------------------------------
run('Open Items section: shows fallback when openQuestions is empty', () => {
  const projectRoot = setupProject({ openQuestions: [] });
  runHook(projectRoot);

  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md should exist');
  const content = fs.readFileSync(claudeMdPath(projectRoot), 'utf8');

  const openStart = content.indexOf('## Open Items');
  assert.ok(openStart !== -1, 'Open Items section not found');
  const afterOpen = content.slice(openStart);
  const openBody = afterOpen; // last section — no next ## to cut at

  assert.ok(
    openBody.includes('No open items recorded.'),
    `Open Items section should show fallback text when empty, got: ${openBody.trim()}`
  );
});

// ---------------------------------------------------------------------------
// Gap 6: Section bodies are non-empty (quality check enforces it)
// ---------------------------------------------------------------------------
run('Section body check: quality check detects and blocks empty section body', () => {
  // Force Requirements section to be empty by removing all requirements and
  // providing fewer than MIN_REQ_IDS — this also triggers REQ count failure,
  // confirming the quality check path runs and blocks generation.
  const projectRoot = setupProject({ requirements: [] });

  runHook(projectRoot);

  // The quality check should have failed and blocked CLAUDE.md creation
  // because: (a) Requirements section body is empty, (b) < 3 REQ-* IDs
  assert.ok(
    !fs.existsSync(claudeMdPath(projectRoot)),
    'CLAUDE.md must NOT be created when section body is empty'
  );
  assert.ok(
    !fs.existsSync(tmpPath(projectRoot)),
    'CLAUDE.md.tmp must not remain'
  );
});

// ---------------------------------------------------------------------------
// checkQuality tests (TDD — written before implementation)
// ---------------------------------------------------------------------------

// CQ-1: Pass — complete fixture meets all thresholds → CLAUDE.md written, no .tmp
run('checkQuality pass: complete fixture — CLAUDE.md written, no .tmp remaining', () => {
  const projectRoot = setupProject();
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code should be 0');
  assert.ok(fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'No .tmp file should remain');
  assert.ok(!result.stderr.includes('ABORTED'), 'No ABORTED message on success');
});

// CQ-2: Architecture fail — empty components → section < 100 chars and no CMP-NNN
run('checkQuality Architecture fail: empty designComponents aborts with specific log', () => {
  const projectRoot = setupProject({ designComponents: [] });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code must always be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'No .tmp must remain');
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED') && result.stderr.includes('Architecture'),
    `stderr must contain [HANDOFF] ABORTED and name Architecture, got: ${result.stderr}`
  );
});

// CQ-3: Architecture fail — DC-NNN IDs only (no CMP-NNN pattern)
run('checkQuality Architecture fail: DC-NNN IDs fail CMP-NNN check', () => {
  const projectRoot = setupProject({
    designComponents: [
      { id: 'DC-001', name: 'Search Engine', type: 'service',
        description: 'Vector-based semantic search service handling document indexing, query processing, ranked result retrieval, and bilingual support.',
        technology: 'Node.js, Pinecone', tracesTo: ['REQ-FUNC-001'] },
      { id: 'DC-002', name: 'Auth Service', type: 'service',
        description: 'Stateless JWT-based auth service with MFA enforcement via TOTP and account lockout after 5 failed attempts.',
        technology: 'Node.js, Redis', tracesTo: ['REQ-FUNC-002'] }
    ]
  });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code must be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'No .tmp must remain');
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED') && result.stderr.includes('Architecture'),
    `stderr must name Architecture section, got: ${result.stderr}`
  );
});

// CQ-4: Requirements fail — 2 requirements → fewer than 3 REQ-* refs
run('checkQuality Requirements fail: 2 requirements → abort with exact AC log message', () => {
  const projectRoot = setupProject({
    requirements: [
      { id: 'REQ-FUNC-001', title: 'Search', priority: 'must', status: 'approved' },
      { id: 'REQ-FUNC-002', title: 'Auth',   priority: 'must', status: 'approved' }
    ]
  });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code must be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'No .tmp must remain');
  // AC specifies the exact log message for the Requirements failure
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED') &&
    result.stderr.includes('Requirements') &&
    result.stderr.includes('3'),
    `stderr must name Requirements and threshold 3, got: ${result.stderr}`
  );
});

// CQ-5: Testing Strategy fail — empty testCases → section < 50 chars
run('checkQuality Testing Strategy fail: empty testCases aborts with specific log', () => {
  const projectRoot = setupProject({ testCases: [] });
  const result = runHook(projectRoot);

  assert.strictEqual(result.status, 0, 'Exit code must be 0');
  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must NOT exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'No .tmp must remain');
  assert.ok(
    result.stderr.includes('[HANDOFF] ABORTED') && result.stderr.includes('Testing Strategy'),
    `stderr must name Testing Strategy section, got: ${result.stderr}`
  );
});

// CQ-6: Clean abort — verify both CLAUDE.md and .tmp are absent after each abort
run('checkQuality clean abort: neither CLAUDE.md nor .tmp present after Architecture abort', () => {
  const projectRoot = setupProject({ designComponents: [] });
  runHook(projectRoot);

  assert.ok(!fs.existsSync(claudeMdPath(projectRoot)), 'CLAUDE.md must not exist');
  assert.ok(!fs.existsSync(tmpPath(projectRoot)), 'CLAUDE.md.tmp must not exist');
});

// CQ-7: Log specificity — each abort names the section AND the specific threshold
run('checkQuality log specificity: Architecture log names section and threshold', () => {
  const projectRoot = setupProject({ designComponents: [] });
  const result = runHook(projectRoot);

  // Must not be a generic error — must name the section
  assert.ok(!result.stderr.includes('Quality check failed'), 'Must not use generic old message');
  assert.ok(result.stderr.includes('Architecture'), 'Must name Architecture section');
  assert.ok(
    result.stderr.includes('100') || result.stderr.includes('CMP-'),
    'Must state the specific threshold (100 chars or CMP-NNN)'
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
if (failed === 0) {
  console.log(`  All ${passed} tests passed.\n`);
} else {
  console.log(`  ${passed} passed, ${failed} failed.\n`);
  process.exit(1);
}
