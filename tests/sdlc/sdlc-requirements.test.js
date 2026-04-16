
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const SKILL_PATH  = path.resolve(__dirname, '..', 'skills', 'sdlc-requirements', 'SKILL.md');
const SCHEMA_PATH = path.resolve(__dirname, '..', 'sdlc-state.schema.json');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    results.push({ name, ok: true });
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    → ${err.message}`);
    results.push({ name, ok: false, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Load file ────────────────────────────────────────────────────────────────

console.log('\nSDLC Requirements SKILL.md — Validation Tests\n');

if (!fs.existsSync(SKILL_PATH)) {
  console.error(
    '  ERROR: skills/sdlc-requirements/SKILL.md not found.\n' +
    '  Create the file first, then re-run this test.\n'
  );
  process.exit(1);
}

const content = fs.readFileSync(SKILL_PATH, 'utf8');
const lines   = content.split('\n');

// ─── 1. File Structure ────────────────────────────────────────────────────────
console.log('── 1. File Structure ──────────────────────────────────────────');

test('first line is "# SDLC Requirements Skill"', () => {
  assert(
    lines[0].trim() === '# SDLC Requirements Skill',
    `Expected "# SDLC Requirements Skill", got "${lines[0].trim()}"`
  );
});

test('second section header is "## Purpose"', () => {
  // Find the first ## heading anywhere in the file
  const firstH2 = lines.find(l => /^## /.test(l));
  assert(
    firstH2 && firstH2.trim() === '## Purpose',
    `Expected first ## header to be "## Purpose", got "${firstH2 || '(none found)'}"`
  );
});

test('file is non-empty (at least 200 lines)', () => {
  assert(
    lines.length >= 200,
    `File has only ${lines.length} lines — target is 200–350`
  );
});

test('file does not exceed 420 lines', () => {
  assert(
    lines.length <= 420,
    `File has ${lines.length} lines — trim to stay within target`
  );
});

test('file contains no YAML frontmatter (no --- on line 1)', () => {
  assert(
    lines[0].trim() !== '---',
    'File must not start with YAML frontmatter (---)'
  );
});

// ─── 2. IEEE 830 Structure Section ───────────────────────────────────────────
console.log('\n── 2. IEEE 830 Structure ──────────────────────────────────────');

test('contains an IEEE 830 section header', () => {
  const hasIEEE = lines.some(l => /IEEE 830/i.test(l) && /^#/.test(l));
  assert(hasIEEE, 'No section header mentioning IEEE 830 found');
});

test('covers system scope', () => {
  const hasScopeHeader = lines.some(l => /scope/i.test(l));
  assert(hasScopeHeader, 'No mention of "scope" found — system scope section required');
});

test('covers functional requirements format', () => {
  const hasFunctional = lines.some(l => /functional/i.test(l) && /requirement/i.test(l));
  assert(hasFunctional, 'No functional requirements format coverage found');
});

test('covers non-functional requirements format', () => {
  const hasNonFunctional = lines.some(l => /non.?functional/i.test(l));
  assert(hasNonFunctional, 'No non-functional requirements format coverage found');
});

test('covers constraints format', () => {
  const hasConstraints = lines.some(l => /constraint/i.test(l));
  assert(hasConstraints, 'No constraints format coverage found');
});

// ─── 3. REQ-ID Format Section ─────────────────────────────────────────────────
console.log('\n── 3. REQ-ID Format ───────────────────────────────────────────');

test('defines REQ-FUNC-NNN pattern for functional requirements', () => {
  assert(
    content.includes('REQ-FUNC-NNN') || content.includes('REQ-FUNC-'),
    'REQ-FUNC-NNN pattern not found'
  );
});

test('defines REQ-NFUNC-NNN pattern for non-functional requirements', () => {
  assert(
    content.includes('REQ-NFUNC-NNN') || content.includes('REQ-NFUNC-'),
    'REQ-NFUNC-NNN pattern not found'
  );
});

test('defines REQ-CON-NNN pattern for constraints', () => {
  assert(
    content.includes('REQ-CON-NNN') || content.includes('REQ-CON-'),
    'REQ-CON-NNN pattern not found'
  );
});

test('NNN described as zero-padded 3-digit integer', () => {
  const hasZeroPad = /zero.?padded/i.test(content) || /3.?digit/i.test(content);
  assert(hasZeroPad, 'No mention of zero-padded 3-digit NNN format found');
});

test('NNN counter starts at 001', () => {
  assert(content.includes('001'), 'Counter start value 001 not mentioned');
});

test('each type has an independent counter', () => {
  const hasIndependent = /independent/i.test(content);
  assert(hasIndependent, 'No mention of independent counters per type');
});

test('IDs are permanent and never reused', () => {
  const hasPermanent = /never reused/i.test(content) || /permanent/i.test(content);
  assert(hasPermanent, 'No rule stating IDs are permanent and never reused');
});

test('shows concrete examples: REQ-FUNC-001, REQ-NFUNC-001, REQ-CON-001', () => {
  assert(content.includes('REQ-FUNC-001'), 'Missing example REQ-FUNC-001');
  assert(content.includes('REQ-NFUNC-001'), 'Missing example REQ-NFUNC-001');
  assert(content.includes('REQ-CON-001'), 'Missing example REQ-CON-001');
});

// ─── 4. MoSCoW Decision Table ─────────────────────────────────────────────────
console.log('\n── 4. MoSCoW Decision Table ───────────────────────────────────');

test('contains a MoSCoW section header', () => {
  const hasMoSCoW = lines.some(l => /MoSCoW/i.test(l) && /^#/.test(l));
  assert(hasMoSCoW, 'No section header mentioning MoSCoW found');
});

test('defines "must" priority level with one-sentence definition', () => {
  const hasMust = /\bmust\b/i.test(content);
  assert(hasMust, '"must" priority level not found');
});

test('defines "should" priority level with one-sentence definition', () => {
  const hasShould = /\bshould\b/i.test(content);
  assert(hasShould, '"should" priority level not found');
});

test('defines "could" priority level with one-sentence definition', () => {
  const hasCould = /\bcould\b/i.test(content);
  assert(hasCould, '"could" priority level not found');
});

test('defines "wont" / "won\'t" priority level with one-sentence definition', () => {
  const hasWont = /\bwon'?t\b/i.test(content) || /\bwont\b/i.test(content);
  assert(hasWont, '"wont" priority level not found');
});

test('contains a concrete "must" example', () => {
  // Expect a line that mentions both must and an example context
  const hasMustExample = /must.*login|must.*auth|must.*cannot launch|must.*mandatory/i.test(content);
  assert(hasMustExample, 'No concrete "must" example found (e.g., authentication / cannot launch)');
});

test('contains a concrete "should" example', () => {
  const hasShouldExample = /should.*report|should.*schedule|should.*workaround/i.test(content);
  assert(hasShouldExample, 'No concrete "should" example found (e.g., report scheduling)');
});

test('contains a concrete "could" example', () => {
  const hasCouldExample = /could.*dashboard|could.*analytics|could.*nice/i.test(content);
  assert(hasCouldExample, 'No concrete "could" example found (e.g., analytics dashboard)');
});

test('contains a concrete "wont" example', () => {
  const hasWontExample = /wont.*phase|won'?t.*phase|wont.*defer|biometric/i.test(content);
  assert(hasWontExample, 'No concrete "wont" example found (e.g., deferred to Phase 2)');
});

// ─── 5. Banned Phrases ────────────────────────────────────────────────────────
console.log('\n── 5. Banned Phrases ──────────────────────────────────────────');

const BANNED_PHRASES = [
  'should be able to',
  'as fast as possible',
  'easy to use',
  'industry standard',
  'appropriate',
];

BANNED_PHRASES.forEach(phrase => {
  test(`banned phrase listed: "${phrase}"`, () => {
    assert(
      content.toLowerCase().includes(phrase.toLowerCase()),
      `Banned phrase "${phrase}" not found in SKILL.md — must be listed explicitly`
    );
  });
});

BANNED_PHRASES.forEach(phrase => {
  test(`rewrite example provided for: "${phrase}"`, () => {
    // Find the index of the banned phrase, then check that a corrected line
    // appears nearby (within 10 lines)
    const lowerContent = content.toLowerCase();
    const phraseIdx    = lowerContent.indexOf(phrase.toLowerCase());
    assert(phraseIdx !== -1, `Phrase "${phrase}" not found`);

    // Look for a "Correct:" or corrected example in a window around the phrase
    const window = content.substring(
      Math.max(0, phraseIdx - 200),
      Math.min(content.length, phraseIdx + 500)
    );
    const hasRewrite = /correct|shall|rewrite|instead/i.test(window);
    assert(
      hasRewrite,
      `No rewrite example found near banned phrase "${phrase}"`
    );
  });
});

// ─── 6. Markdown Lint ─────────────────────────────────────────────────────────
console.log('\n── 6. Markdown Lint ───────────────────────────────────────────');

test('markdownlint reports zero errors', () => {
  try {
    const configPath = path.resolve(__dirname, '..', '.markdownlint');
    const configFlag = fs.existsSync(configPath) ? `--config "${configPath}"` : '';
    execSync(`npx markdownlint "${SKILL_PATH}" ${configFlag} 2>&1`, { encoding: 'utf8' });
    // If command exits 0, no errors
  } catch (err) {
    const output = (err.stdout || err.stderr || err.message)
      .split('\n').filter(l => !l.startsWith('npm error')).join('\n').trim();
    throw new Error(`markdownlint errors:\n    ${output.split('\n').join('\n    ')}`);
  }
});

// ─── 7. Schema Field Cross-Check ─────────────────────────────────────────────
console.log('\n── 7. Schema Field Cross-Check ────────────────────────────────');

// Known field names that SKILL.md references and must exist in the schema
const EXPECTED_SCHEMA_FIELDS = [
  'id',
  'title',
  'description',
  'priority',
  'status',
  'source',
  'acceptanceCriteria',
  'complianceFrameworks',
  'traceForward',
  'deferralReason',
];

if (!fs.existsSync(SCHEMA_PATH)) {
  console.log('  (skipped — sdlc-state.schema.json not found at project root)');
} else {
  const schema     = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const schemaText = JSON.stringify(schema);

  EXPECTED_SCHEMA_FIELDS.forEach(fieldName => {
    test(`schema field "${fieldName}" exists in sdlc-state.schema.json`, () => {
      assert(
        schemaText.includes(`"${fieldName}"`),
        `Field "${fieldName}" referenced in SKILL.md not found in sdlc-state.schema.json`
      );
    });
  });

  // Also check that SKILL.md doesn't reference fields that do NOT exist in schema
  const SKILL_FIELD_PATTERN = /`([a-zA-Z][a-zA-Z0-9_]+)`/g;
  const candidateFields     = [...content.matchAll(SKILL_FIELD_PATTERN)]
    .map(m => m[1])
    .filter(f => /^[a-z]/.test(f)); // only camelCase identifiers

  const unknownFields = candidateFields.filter(
    f => !schemaText.includes(`"${f}"`) && EXPECTED_SCHEMA_FIELDS.includes(f)
  );

  test('no SKILL.md field references are missing from schema', () => {
    assert(
      unknownFields.length === 0,
      `Field(s) in SKILL.md not found in schema: ${unknownFields.join(', ')}`
    );
  });
}

// ─── 8. Status Lifecycle ─────────────────────────────────────────────────────
console.log('\n── 8. Status Lifecycle ────────────────────────────────────────');

const EXPECTED_STATUSES = ['draft', 'validated', 'approved', 'deferred', 'rejected'];

EXPECTED_STATUSES.forEach(status => {
  test(`status lifecycle includes "${status}"`, () => {
    assert(
      content.includes(status),
      `Status "${status}" not mentioned in SKILL.md`
    );
  });
});

test('deferralReason field mentioned for deferred requirements', () => {
  assert(
    content.includes('deferralReason'),
    'deferralReason field not mentioned — required for deferred requirements'
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
console.log(`${'─'.repeat(60)}\n`);

process.exitCode = failed > 0 ? 1 : 0;
