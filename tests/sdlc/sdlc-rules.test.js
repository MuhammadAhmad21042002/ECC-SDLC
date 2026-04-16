

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const RULES_DIR      = path.resolve(__dirname, '..', 'rules', 'sdlc');
const REQUIREMENTS   = path.join(RULES_DIR, 'requirements.md');
const TRACEABILITY   = path.join(RULES_DIR, 'traceability.md');
const PHASE_GATES    = path.join(RULES_DIR, 'phase-gates.md');
const DOCUMENTATION  = path.join(RULES_DIR, 'documentation.md');

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadFile(filePath) {
  const label = path.relative(path.resolve(__dirname, '..'), filePath);
  if (!fs.existsSync(filePath)) {
    console.error(`\n  ERROR: ${label} not found.\n  Create the file first, then re-run.\n`);
    process.exit(1);
  }
  return {
    content : fs.readFileSync(filePath, 'utf8'),
    lines   : fs.readFileSync(filePath, 'utf8').split('\n'),
    label,
  };
}

function sharedStructureTests(label, content, lines, expectedH1) {
  test(`${label}: first line is "${expectedH1}"`, () => {
    assert(
      lines[0].trim() === expectedH1,
      `Expected "${expectedH1}", got "${lines[0].trim()}"`
    );
  });

  test(`${label}: no YAML frontmatter (line 1 is not ---)`, () => {
    assert(lines[0].trim() !== '---', 'File must not start with YAML frontmatter');
  });

  test(`${label}: contains at least one ## section header`, () => {
    const hasH2 = lines.some(l => /^## /.test(l));
    assert(hasH2, 'No ## section headers found');
  });

  test(`${label}: file is non-empty (at least 20 lines)`, () => {
    assert(lines.length >= 20, `File has only ${lines.length} lines`);
  });
}

function markdownLintTest(filePath) {
  const label = path.basename(filePath);
  test(`markdownlint: ${label} reports zero errors`, () => {
    try {
      const configPath = path.resolve(__dirname, '..', '.markdownlint');
      const configFlag = fs.existsSync(configPath) ? `--config "${configPath}"` : '';
      execSync(`npx markdownlint "${filePath}" ${configFlag} 2>&1`, { encoding: 'utf8' });
    } catch (err) {
      const output = (err.stdout || err.stderr || err.message)
        .split('\n').filter(l => !l.startsWith('npm error')).join('\n').trim();
      throw new Error(`markdownlint errors:\n    ${output.split('\n').join('\n    ')}`);
    }
  });
}

// ─── Load all 4 files ─────────────────────────────────────────────────────────

console.log('\nSDLC Rule Files — Validation Tests\n');

const req   = loadFile(REQUIREMENTS);
const trace = loadFile(TRACEABILITY);
const gates = loadFile(PHASE_GATES);
const docs  = loadFile(DOCUMENTATION);

// ─── 1. requirements.md ───────────────────────────────────────────────────────
console.log('── 1. rules/sdlc/requirements.md ──────────────────────────────');

sharedStructureTests(req.label, req.content, req.lines, '# Requirements Rules');

// REQ-ID format
test('requirements.md: defines REQ-FUNC-NNN pattern', () => {
  assert(req.content.includes('REQ-FUNC-NNN') || req.content.includes('REQ-FUNC-'),
    'REQ-FUNC-NNN pattern not found');
});

test('requirements.md: defines REQ-NFUNC-NNN pattern', () => {
  assert(req.content.includes('REQ-NFUNC-NNN') || req.content.includes('REQ-NFUNC-'),
    'REQ-NFUNC-NNN pattern not found');
});

test('requirements.md: defines REQ-CON-NNN pattern', () => {
  assert(req.content.includes('REQ-CON-NNN') || req.content.includes('REQ-CON-'),
    'REQ-CON-NNN pattern not found');
});

test('requirements.md: NNN described as zero-padded', () => {
  assert(/zero.?padded/i.test(req.content) || /3.?digit/i.test(req.content),
    'No mention of zero-padded NNN format');
});

// MoSCoW
const MOSCOW_LEVELS = ['must', 'should', 'could', 'wont'];
MOSCOW_LEVELS.forEach(level => {
  test(`requirements.md: MoSCoW level "${level}" defined`, () => {
    assert(req.content.toLowerCase().includes(level),
      `MoSCoW level "${level}" not found`);
  });
});

test('requirements.md: MoSCoW section present', () => {
  assert(/MoSCoW/i.test(req.content), 'No MoSCoW section found');
});

// Banned phrases
const BANNED = [
  'should be able to',
  'as fast as possible',
  'easy to use',
  'industry standard',
  'appropriate',
];

BANNED.forEach(phrase => {
  test(`requirements.md: banned phrase listed — "${phrase}"`, () => {
    assert(req.content.toLowerCase().includes(phrase.toLowerCase()),
      `Banned phrase "${phrase}" not listed`);
  });
});

// Source attribution
test('requirements.md: source attribution format covered', () => {
  assert(/source/i.test(req.content), 'No mention of source attribution');
});

test('requirements.md: source attribution includes document reference format', () => {
  const hasDocRef = /section|page|RFP|meeting|stakeholder/i.test(req.content);
  assert(hasDocRef, 'No document/stakeholder reference format example found');
});

// Status lifecycle
const STATUSES = ['draft', 'validated', 'approved', 'deferred', 'rejected'];
STATUSES.forEach(status => {
  test(`requirements.md: status lifecycle includes "${status}"`, () => {
    assert(req.content.includes(status), `Status "${status}" not found`);
  });
});

test('requirements.md: status lifecycle shows progression (→ arrow)', () => {
  assert(req.content.includes('→'), 'No lifecycle progression arrow found');
});

// ─── 2. traceability.md ───────────────────────────────────────────────────────
console.log('\n── 2. rules/sdlc/traceability.md ──────────────────────────────');

sharedStructureTests(trace.label, trace.content, trace.lines, '# Traceability Rules');

test('traceability.md: forward-link obligation defined', () => {
  assert(/forward.?link|traceForward/i.test(trace.content),
    'No forward-link obligation found');
});

test('traceability.md: design component forward link required', () => {
  assert(/design.?component|designComponent/i.test(trace.content),
    'Design component forward link not mentioned');
});

test('traceability.md: test case forward link required', () => {
  assert(/test.?case|testCase/i.test(trace.content),
    'Test case forward link not mentioned');
});

test('traceability.md: cost line item forward link required', () => {
  assert(/cost.?line|costLine/i.test(trace.content),
    'Cost line item forward link not mentioned');
});

test('traceability.md: traceability-guard.js named explicitly', () => {
  assert(trace.content.includes('traceability-guard.js'),
    'traceability-guard.js not named — must be the named enforcing hook');
});

test('traceability.md: REQ-* pattern mentioned', () => {
  assert(/REQ-\*|REQ-FUNC|REQ-NFUNC|REQ-CON/.test(trace.content),
    'REQ-* pattern not referenced');
});

test('traceability.md: forward links required before phase gate approval', () => {
  assert(/phase.?gate|approval/i.test(trace.content),
    'No mention of phase gate approval requirement');
});

// ─── 3. phase-gates.md ────────────────────────────────────────────────────────
console.log('\n── 3. rules/sdlc/phase-gates.md ───────────────────────────────');

sharedStructureTests(gates.label, gates.content, gates.lines, '# Phase Gate Rules');

// All 6 phases must be present
const PHASES = [
  'discovery',
  'requirements',
  'design',
  'test-planning',
  'estimation',
  'proposal',
];

PHASES.forEach(phase => {
  test(`phase-gates.md: phase "${phase}" defined`, () => {
    assert(gates.content.toLowerCase().includes(phase),
      `Phase "${phase}" not found`);
  });
});

// Artifact keys from state.json
const ARTIFACT_KEYS = ['scope', 'srs', 'sds', 'estimate'];
ARTIFACT_KEYS.forEach(key => {
  test(`phase-gates.md: artifact key "${key}" referenced`, () => {
    assert(gates.content.includes(key),
      `Artifact key "${key}" not found`);
  });
});

// Exact prerequisite pattern per technical notes
test('phase-gates.md: uses exact prerequisite pattern "state.json.artifacts"', () => {
  assert(gates.content.includes('state.json.artifacts'),
    'Missing exact pattern "state.json.artifacts" — phase-gate.js needs this to parse');
});

test('phase-gates.md: discovery phase has no prerequisites', () => {
  const discoveryBlock = gates.content
    .toLowerCase()
    .substring(gates.content.toLowerCase().indexOf('discovery'));
  const windowText = discoveryBlock.substring(0, 300);
  assert(
    /none|no prerequisite|no artifact|not required/i.test(windowText),
    'Discovery phase should state no prerequisites are required'
  );
});

test('phase-gates.md: requirements phase requires scope artifact', () => {
  const lower = gates.content.toLowerCase();
  const reqIdx = lower.indexOf('requirements');
  const window = gates.content.substring(reqIdx, reqIdx + 400);
  assert(/scope/i.test(window), 'Requirements phase must reference scope artifact');
});

test('phase-gates.md: design phase requires srs artifact', () => {
  const lower = gates.content.toLowerCase();
  const designIdx = lower.indexOf('design');
  const window = gates.content.substring(designIdx, designIdx + 400);
  assert(/srs/i.test(window), 'Design phase must reference srs artifact');
});

test('phase-gates.md: proposal phase requires srs + sds + estimate', () => {
  const lower = gates.content.toLowerCase();
  const proposalIdx = lower.indexOf('proposal');
  const window = gates.content.substring(proposalIdx, proposalIdx + 500);
  assert(/srs/i.test(window),      'Proposal phase must reference srs');
  assert(/sds/i.test(window),      'Proposal phase must reference sds');
  assert(/estimate/i.test(window), 'Proposal phase must reference estimate');
});

test('phase-gates.md: non-null condition stated for artifacts', () => {
  assert(/non.?null/i.test(gates.content),
    'No "non-null" condition found — required for phase-gate.js boolean check');
});

// ─── 4. documentation.md ─────────────────────────────────────────────────────
console.log('\n── 4. rules/sdlc/documentation.md ─────────────────────────────');

sharedStructureTests(docs.label, docs.content, docs.lines, '# Documentation Rules');

// Version numbering
test('documentation.md: version format v1 (major integer) defined', () => {
  assert(/v1\b/.test(docs.content), 'Version format "v1" not found');
});

test('documentation.md: version format v1.1 (minor decimal) defined', () => {
  assert(/v1\.1/.test(docs.content), 'Version format "v1.1" not found');
});

test('documentation.md: version format v2 (major increment) defined', () => {
  assert(/v2\b/.test(docs.content), 'Version format "v2" not found');
});

test('documentation.md: major vs minor version distinction explained', () => {
  assert(/major/i.test(docs.content) && /minor/i.test(docs.content),
    'No major/minor version distinction explained');
});

// SHA-256
test('documentation.md: SHA-256 hashing rules mentioned', () => {
  assert(/SHA-256|SHA256/i.test(docs.content), 'SHA-256 hashing not mentioned');
});

// Artifact naming conventions
const ARTIFACT_NAMES = ['SRS-v1.docx', 'SDS-v1.docx'];
ARTIFACT_NAMES.forEach(name => {
  test(`documentation.md: artifact naming example "${name}" present`, () => {
    assert(docs.content.includes(name),
      `Artifact naming example "${name}" not found`);
  });
});

test('documentation.md: artifact naming convention section present', () => {
  assert(/naming/i.test(docs.content), 'No artifact naming section found');
});

// Template compliance
test('documentation.md: required: true template compliance rule present', () => {
  assert(
    docs.content.includes('required: true') || /required.*section|skip.*required/i.test(docs.content),
    'No "required: true" template compliance rule found'
  );
});

test('documentation.md: never skip required sections rule stated', () => {
  assert(/never skip|must.*include|required.*section/i.test(docs.content),
    'No rule about never skipping required sections');
});

// ─── 5. Markdown Lint — all 4 files ──────────────────────────────────────────
console.log('\n── 5. Markdown Lint ───────────────────────────────────────────');

[REQUIREMENTS, TRACEABILITY, PHASE_GATES, DOCUMENTATION].forEach(markdownLintTest);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
console.log(`${'─'.repeat(60)}\n`);

process.exitCode = failed > 0 ? 1 : 0;
