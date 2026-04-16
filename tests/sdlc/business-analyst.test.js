

'use strict';

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

// ─── Paths ────────────────────────────────────────────────────────────────────

const SCHEMA_PATH = path.resolve(__dirname, '..', 'requirement.schema.json');
const OUTPUT_PATH = path.resolve(__dirname, 'fixtures', 'ba-output.json');
const RFP_PATH    = path.resolve(__dirname, 'fixtures', 'sample-banking-rfp.txt');

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

// ─── Load fixtures ────────────────────────────────────────────────────────────

console.log('\nBusiness Analyst Agent — Output Validation Tests\n');

// Guard: output file must exist before running
if (!fs.existsSync(OUTPUT_PATH)) {
  console.error(
    '  ERROR: tests/fixtures/ba-output.json not found.\n' +
    '  Run the business-analyst agent on sample-banking-rfp.txt first,\n' +
    '  then save its output as tests/fixtures/ba-output.json\n'
  );
  process.exit(1);
}

const schema     = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const rawOutput  = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));

// Output may be a single requirement object or an array — normalise to array
const requirements = Array.isArray(rawOutput) ? rawOutput : [rawOutput];

// ─── Constants ────────────────────────────────────────────────────────────────

const BANNED_PHRASES = [
  'should be able to',
  'as fast as possible',
  'easy to use',
  'industry standard',
  'appropriate',
];

// Keywords from user story technical notes that must trigger compliance tags
const COMPLIANCE_KEYWORD_RULES = [
  {
    // SBP-2024: encryption + customer data/PII keywords
    description : 'AES encryption + customer PII → SBP-2024 and ISO-27001',
    matchPhrase : ['encryption', 'customer data', 'pii', 'customer pii', 'aes'],
    requiredTags: ['SBP-2024', 'ISO-27001'],
  },
  {
    // SBP-2024: audit log + MFA
    description : 'audit log + MFA → SBP-2024',
    matchPhrase : ['audit log', 'mfa'],
    requiredTags: ['SBP-2024'],
  },
  {
    // PPRA-2024: tender + procurement keywords
    description : 'tender/procurement → PPRA-2024',
    matchPhrase : ['tender', 'procurement', 'evaluation committee', 'single-source'],
    requiredTags: ['PPRA-2024'],
  },
];

// ─── Test Suite ───────────────────────────────────────────────────────────────

// ── 1. AJV Validation ─────────────────────────────────────────────────────────
console.log('── 1. AJV Validation ──────────────────────────────────────────');

const ajv      = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

test('output file parses as valid JSON', () => {
  // Already parsed above — if we reached here it's valid JSON
  assert(Array.isArray(requirements), 'Normalised output must be an array');
});

test('at least one requirement present in output', () => {
  assert(requirements.length > 0, 'Agent produced zero requirements');
});

requirements.forEach((req, i) => {
  test(`requirement[${i}] (${req.id || 'no-id'}) passes AJV schema`, () => {
    const valid = validate(req);
    if (!valid) {
      const errors = validate.errors
        .map(e => `  ${e.instancePath || '/'} — ${e.message}`)
        .join('\n');
      throw new Error(`Schema validation failed:\n${errors}`);
    }
  });
});

// ── 2. Banned Phrase Check ────────────────────────────────────────────────────
console.log('\n── 2. Banned Phrase Check ─────────────────────────────────────');

BANNED_PHRASES.forEach(phrase => {
  test(`no acceptance criteria contain banned phrase: "${phrase}"`, () => {
    const hits = [];
    requirements.forEach(req => {
      if (!Array.isArray(req.acceptanceCriteria)) return;
      req.acceptanceCriteria.forEach((ac, acIdx) => {
        if (ac.toLowerCase().includes(phrase.toLowerCase())) {
          hits.push(`${req.id} acceptanceCriteria[${acIdx}]: "${ac}"`);
        }
      });
    });
    assert(
      hits.length === 0,
      `Found banned phrase in:\n    ${hits.join('\n    ')}`
    );
  });
});

// ── 3. Compliance Tagging Check ───────────────────────────────────────────────
console.log('\n── 3. Compliance Tagging Check ────────────────────────────────');

COMPLIANCE_KEYWORD_RULES.forEach(rule => {
  test(`compliance rule: ${rule.description}`, () => {
    // Find requirements whose description or title contains any of the match phrases
    const relevantReqs = requirements.filter(req => {
      const text = `${req.title || ''} ${req.description || ''}`.toLowerCase();
      return rule.matchPhrase.some(kw => text.includes(kw.toLowerCase()));
    });

    if (relevantReqs.length === 0) {
      // Not necessarily a failure — fixture may not have triggered this rule
      console.log(`    (no requirements matched keywords — skipped)`);
      return;
    }

    relevantReqs.forEach(req => {
      const tags = req.complianceFrameworks || [];
      rule.requiredTags.forEach(expectedTag => {
        assert(
          tags.includes(expectedTag),
          `${req.id} is missing complianceFrameworks tag "${expectedTag}". ` +
          `Current tags: [${tags.join(', ') || 'none'}]`
        );
      });
    });
  });
});

// ── 4. Extraction Count Report (informational — manual pass/fail) ─────────────
console.log('\n── 4. Extraction Count (manual confirmation required) ──────────');

const RFP_TOTAL = 10; // total requirements in sample-banking-rfp.txt
test(`extraction count reported (target ≥ ${Math.ceil(RFP_TOTAL * 0.9)} of ${RFP_TOTAL})`, () => {
  const count = requirements.length;
  console.log(`    Extracted: ${count} / ${RFP_TOTAL} requirements`);
  console.log(`    Recall: ${((count / RFP_TOTAL) * 100).toFixed(1)}%`);
  assert(
    count >= Math.ceil(RFP_TOTAL * 0.9),
    `Extraction recall below 90%: got ${count}, need at least ${Math.ceil(RFP_TOTAL * 0.9)}`
  );
});

// ── 5. ID Format Check ────────────────────────────────────────────────────────
console.log('\n── 5. ID Format Check ─────────────────────────────────────────');

test('all requirement IDs match REQ-(FUNC|NFUNC|CON)-NNN format', () => {
  const pattern = /^REQ-(FUNC|NFUNC|CON)-\d{3}$/;
  const bad = requirements.filter(r => !pattern.test(r.id || ''));
  assert(
    bad.length === 0,
    `Invalid IDs: ${bad.map(r => r.id || '(missing)').join(', ')}`
  );
});

test('all requirement IDs are unique', () => {
  const ids  = requirements.map(r => r.id);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(dups.length === 0, `Duplicate IDs found: ${[...new Set(dups)].join(', ')}`);
});

// ── 6. Must-Priority Acceptance Criteria Count ────────────────────────────────
console.log('\n── 6. Must-Priority AC Count ──────────────────────────────────');

test('every must-priority requirement has at least 2 acceptance criteria', () => {
  const violations = requirements.filter(
    r => r.priority === 'must' &&
         (!Array.isArray(r.acceptanceCriteria) || r.acceptanceCriteria.length < 2)
  );
  assert(
    violations.length === 0,
    `Must-priority requirements with < 2 ACs: ${violations.map(r => r.id).join(', ')}`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
console.log(`${'─'.repeat(60)}\n`);

process.exitCode = failed > 0 ? 1 : 0;
