const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ---------------------------------------------------------------------------
// Test harness (matches the pattern used throughout this repo)
// ---------------------------------------------------------------------------

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Walk every string value in the template and collect all {placeholder} tokens.
 * Ignores runtime-only tokens that are not data-contract fields.
 */
function extractPlaceholders(template) {
  const placeholders = new Set();
  const visit = (value, key) => {
    if (Array.isArray(value))               { for (const item of value) visit(item); return; }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
      return;
    }
    if (typeof value !== 'string')          return;
    // mermaidBlock sections reference their data by a string-valued `dataKey`
    // rather than by a braced {token} — treat those values as placeholders too.
    if (key === 'dataKey' && /^[a-zA-Z0-9_]+$/.test(value)) {
      placeholders.add(value);
    }
    const regex = /\{([a-zA-Z0-9_]+)\}/g;
    let match;
    while ((match = regex.exec(value)) !== null) placeholders.add(match[1]);
  };
  visit(template);
  return placeholders;
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

function runTests() {
  console.log('\n=== Testing ECC-SDLC srs-template.json ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot     = path.resolve(__dirname, '..', '..');
  const templatePath = path.join(repoRoot, 'templates', 'srs-template.json');

  // Tokens excluded from data-contract checks:
  //   pageNumber, pageCount            — injected by docx-js at render time
  //   id, title, sectionNumber, name   — per-item fields used in repeatingBlock
  //                                      titleFormat, resolved from row data at
  //                                      render time, not top-level data contract fields
  const runtimeTokens = new Set(['pageNumber', 'pageCount', 'id', 'title', 'sectionNumber', 'name']);

  let template;
  // Guard: if the file can't be parsed, all subsequent tests would throw
  // misleading errors — fail early with a clear message.
  if (!test('srs-template.json exists and parses as valid JSON', () => {
    assert.ok(fs.existsSync(templatePath), `File not found: ${templatePath}`);
    template = readJson(templatePath);
    assert.ok(template !== null && typeof template === 'object', 'Parsed value is not an object');
  })) {
    failed++;
    console.log('\n  Cannot continue — template file is missing or invalid JSON.\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(1);
  } else {
    passed++;
  }

  // ── Top-level metadata ───────────────────────────────────────────────────
  console.log('Metadata:');

  if (test('templateSchema is "ecc-sdlc.template.v1"', () => {
    assert.strictEqual(template.templateSchema, 'ecc-sdlc.template.v1',
      `Expected "ecc-sdlc.template.v1", got "${template.templateSchema}"`);
  })) passed++; else failed++;

  if (test('templateId is "ecc-sdlc.srs.v1"', () => {
    assert.strictEqual(template.templateId, 'ecc-sdlc.srs.v1',
      `Expected "ecc-sdlc.srs.v1", got "${template.templateId}"`);
  })) passed++; else failed++;

  if (test('documentType is "srs"', () => {
    assert.strictEqual(template.documentType, 'srs',
      `Expected "srs", got "${template.documentType}"`);
  })) passed++; else failed++;

  if (test('sections is a non-empty array', () => {
    assert.ok(Array.isArray(template.sections), 'template.sections must be an array');
    assert.ok(template.sections.length > 0, 'template.sections must not be empty');
  })) passed++; else failed++;

  if (test('dataContract.requiredFields is an array of strings', () => {
    assert.ok(
      template.dataContract && Array.isArray(template.dataContract.requiredFields),
      'dataContract.requiredFields is missing or not an array'
    );
    for (const field of template.dataContract.requiredFields) {
      assert.strictEqual(typeof field, 'string', 'Each requiredField must be a string');
      assert.ok(field.length > 0, 'requiredFields must not contain empty strings');
    }
  })) passed++; else failed++;

  // ── Required section IDs (IEEE 830 / guideline-aligned) ─────────────────
  console.log('\nRequired sections:');

  const sectionIds = template.sections.map(s => s && s.id);

  const requiredSections = [
    // Front matter
    'cover',
    'versionHistory',
    'toc',
    // Section 1 — Introduction
    'introduction',
    'definitionsTable',
    // Section 2 — Overall Description
    'overallDescription',
    'userClassesTable',
    // Section 3 — Specific Requirements
    'specificRequirements',
    'externalInterfaces',
    'functionalRequirementsTable',
    'functionalRequirementsDetail',
    'nonFunctionalRequirementsTable',
    'nonFunctionalRequirementsDetail',
    'designConstraints',
    'logicalDatabaseRequirements',
    'softwareQualityAttributes',
    'otherRequirements',
    // Appendices
    'appendixSupportingInfo',
    'appendixSignOff',
    // Index
    'index'
  ];

  for (const id of requiredSections) {
    if (test(`section "${id}" exists`, () => {
      assert.ok(sectionIds.includes(id), `Missing section with id "${id}"`);
    })) passed++; else failed++;
  }

  // ── Section ordering ─────────────────────────────────────────────────────
  console.log('\nSection ordering:');

  if (test('cover appears before versionHistory', () => {
    assert.ok(sectionIds.indexOf('cover') < sectionIds.indexOf('versionHistory'),
      'cover must appear before versionHistory');
  })) passed++; else failed++;

  if (test('toc appears before versionHistory', () => {
    assert.ok(sectionIds.indexOf('toc') < sectionIds.indexOf('versionHistory'),
      'toc must appear before versionHistory');
  })) passed++; else failed++;

  if (test('versionHistory appears before introduction', () => {
    assert.ok(sectionIds.indexOf('versionHistory') < sectionIds.indexOf('introduction'),
      'versionHistory must appear before introduction');
  })) passed++; else failed++;

  if (test('introduction appears before overallDescription', () => {
    assert.ok(sectionIds.indexOf('introduction') < sectionIds.indexOf('overallDescription'),
      'introduction must appear before overallDescription');
  })) passed++; else failed++;

  if (test('externalInterfaces appears before specificRequirements', () => {
    assert.ok(
      sectionIds.indexOf('externalInterfaces') < sectionIds.indexOf('specificRequirements'),
      'externalInterfaces (Section 3) must appear before specificRequirements (Section 5) in the Wiegers IEEE layout'
    );
  })) passed++; else failed++;

  if (test('functionalRequirementsTable appears before functionalRequirementsDetail', () => {
    assert.ok(
      sectionIds.indexOf('functionalRequirementsTable') < sectionIds.indexOf('functionalRequirementsDetail'),
      'functionalRequirementsTable (3.2.1) must appear before functionalRequirementsDetail (3.2.2)'
    );
  })) passed++; else failed++;

  if (test('functionalRequirementsTable appears before nonFunctionalRequirementsTable', () => {
    assert.ok(
      sectionIds.indexOf('functionalRequirementsTable') < sectionIds.indexOf('nonFunctionalRequirementsTable'),
      'functionalRequirementsTable (3.2) must appear before nonFunctionalRequirementsTable (3.3)'
    );
  })) passed++; else failed++;

  if (test('nonFunctionalRequirementsTable appears before nonFunctionalRequirementsDetail', () => {
    assert.ok(
      sectionIds.indexOf('nonFunctionalRequirementsTable') < sectionIds.indexOf('nonFunctionalRequirementsDetail'),
      'nonFunctionalRequirementsTable (3.3.1) must appear before nonFunctionalRequirementsDetail (3.3.2)'
    );
  })) passed++; else failed++;

  if (test('otherRequirements appears before appendixSupportingInfo', () => {
    assert.ok(
      sectionIds.indexOf('otherRequirements') < sectionIds.indexOf('appendixSupportingInfo'),
      'otherRequirements (3.7) must appear before appendices'
    );
  })) passed++; else failed++;

  if (test('appendixSupportingInfo appears before appendixSignOff', () => {
    assert.ok(
      sectionIds.indexOf('appendixSupportingInfo') < sectionIds.indexOf('appendixSignOff'),
      'Appendix A must appear before Appendix B'
    );
  })) passed++; else failed++;

  if (test('appendixSignOff appears before index', () => {
    assert.ok(
      sectionIds.indexOf('appendixSignOff') < sectionIds.indexOf('index'),
      'Appendix B must appear before Index'
    );
  })) passed++; else failed++;

  // ── Functional requirements table columns (3.2.1) ────────────────────────
  console.log('\nFunctional requirements table (3.2.1):');

  const funcSection = template.sections.find(s => s.id === 'functionalRequirementsTable');

  if (test('functionalRequirementsTable has required columns (id, title, priority, description, acceptanceCriteria)', () => {
    assert.ok(funcSection, 'functionalRequirementsTable section not found');
    const keys = funcSection.content.columns.map(c => c.key);
    for (const k of ['id', 'title', 'priority', 'description', 'acceptanceCriteria']) {
      assert.ok(keys.includes(k), `functionalRequirementsTable missing column "${k}"`);
    }
  })) passed++; else failed++;

  if (test('functionalRequirementsTable column widths sum to 100', () => {
    const total = funcSection.content.columns.reduce((sum, c) => sum + c.widthPct, 0);
    assert.strictEqual(total, 100, `Expected column widths to sum to 100, got ${total}`);
  })) passed++; else failed++;

  // ── Functional requirements detail block (3.2.2) ─────────────────────────
  console.log('\nFunctional requirements detail (3.2.2):');

  const funcDetailSection = template.sections.find(s => s.id === 'functionalRequirementsDetail');

  if (test('functionalRequirementsDetail is type "repeatingBlock"', () => {
    assert.ok(funcDetailSection, 'functionalRequirementsDetail section not found');
    assert.strictEqual(funcDetailSection.type, 'repeatingBlock',
      'functionalRequirementsDetail must be type "repeatingBlock"');
  })) passed++; else failed++;

  if (test('functionalRequirementsDetail itemTemplate has required fields (type, priority, status, source, description, acceptanceCriteria)', () => {
    const fieldKeys = funcDetailSection.content.itemTemplate.fields.map(f => f.key);
    for (const k of ['type', 'priority', 'status', 'source', 'description', 'acceptanceCriteria']) {
      assert.ok(fieldKeys.includes(k), `functionalRequirementsDetail missing field "${k}"`);
    }
  })) passed++; else failed++;

  // ── Non-functional requirements table columns (3.3.1) ────────────────────
  console.log('\nNon-functional requirements table (3.3.1):');

  const nonFuncSection = template.sections.find(s => s.id === 'nonFunctionalRequirementsTable');

  if (test('nonFunctionalRequirementsTable has required columns (id, category, title, priority, description, acceptanceCriteria)', () => {
    assert.ok(nonFuncSection, 'nonFunctionalRequirementsTable section not found');
    const keys = nonFuncSection.content.columns.map(c => c.key);
    for (const k of ['id', 'category', 'title', 'priority', 'description', 'acceptanceCriteria']) {
      assert.ok(keys.includes(k), `nonFunctionalRequirementsTable missing column "${k}"`);
    }
  })) passed++; else failed++;

  if (test('nonFunctionalRequirementsTable column widths sum to 100', () => {
    const total = nonFuncSection.content.columns.reduce((sum, c) => sum + c.widthPct, 0);
    assert.strictEqual(total, 100, `Expected column widths to sum to 100, got ${total}`);
  })) passed++; else failed++;

  // ── Non-functional requirements detail block (3.3.2) ─────────────────────
  console.log('\nNon-functional requirements detail (3.3.2):');

  const nonFuncDetailSection = template.sections.find(s => s.id === 'nonFunctionalRequirementsDetail');

  if (test('nonFunctionalRequirementsDetail is type "repeatingBlock"', () => {
    assert.ok(nonFuncDetailSection, 'nonFunctionalRequirementsDetail section not found');
    assert.strictEqual(nonFuncDetailSection.type, 'repeatingBlock',
      'nonFunctionalRequirementsDetail must be type "repeatingBlock"');
  })) passed++; else failed++;

  if (test('nonFunctionalRequirementsDetail itemTemplate has required fields (category, priority, status, source, description, acceptanceCriteria)', () => {
    const fieldKeys = nonFuncDetailSection.content.itemTemplate.fields.map(f => f.key);
    for (const k of ['category', 'priority', 'status', 'source', 'description', 'acceptanceCriteria']) {
      assert.ok(fieldKeys.includes(k), `nonFunctionalRequirementsDetail missing field "${k}"`);
    }
  })) passed++; else failed++;

  // ── Definitions table (1.3 — Definitions, Acronyms, and Abbreviations) ───
  console.log('\nDefinitions table (1.3):');

  const definitionsSection = template.sections.find(s => s.id === 'definitionsTable');

  if (test('definitionsTable section exists and is type "table"', () => {
    assert.ok(definitionsSection, 'definitionsTable section missing');
    assert.strictEqual(definitionsSection.type, 'table',
      'definitionsTable section must be type "table"');
  })) passed++; else failed++;

  if (test('definitionsTable has term, definition, source columns', () => {
    const keys = definitionsSection.content.columns.map(c => c.key);
    for (const k of ['term', 'definition', 'source']) {
      assert.ok(keys.includes(k), `definitionsTable missing column "${k}"`);
    }
  })) passed++; else failed++;

  if (test('definitionsTable rows source is {definitionsTable}', () => {
    assert.strictEqual(definitionsSection.content.rows, '{definitionsTable}',
      'definitionsTable rows must reference {definitionsTable}');
  })) passed++; else failed++;

  // ── Software quality attributes (IEEE 830 Wiegers variant) ───────────────
  console.log('\nSoftware quality attributes:');

  const softwareAttrsSection = template.sections.find(s => s.id === 'softwareQualityAttributes');

  if (test('softwareQualityAttributes has all five IEEE 830 attribute subsections', () => {
    assert.ok(softwareAttrsSection, 'softwareQualityAttributes section not found');
    const headings = softwareAttrsSection.content.subsections.map(s => s.heading);
    for (const h of ['Reliability', 'Availability', 'Maintainability', 'Portability', 'Usability']) {
      assert.ok(
        headings.some(hd => hd.includes(h)),
        `softwareQualityAttributes missing subsection containing "${h}"`
      );
    }
  })) passed++; else failed++;

  // ── Appendix A renderCondition ───────────────────────────────────────────
  console.log('\nAppendix A:');

  const appendixA = template.sections.find(s => s.id === 'appendixSupportingInfo');

  if (test('appendixSupportingInfo has a renderCondition (optional appendix)', () => {
    assert.ok(
      typeof appendixA.renderCondition === 'string' && appendixA.renderCondition.length > 0,
      'appendixSupportingInfo must have a renderCondition so it is skipped when empty'
    );
  })) passed++; else failed++;

  // ── Data contract coverage ───────────────────────────────────────────────
  console.log('\nData contract coverage:');

  if (test('dataContract.requiredFields contains no duplicates', () => {
    const fields    = template.dataContract.requiredFields;
    const uniqueSet = new Set(fields);
    assert.strictEqual(fields.length, uniqueSet.size,
      `dataContract.requiredFields has duplicates: ${fields.filter((f, i) => fields.indexOf(f) !== i).join(', ')}`);
  })) passed++; else failed++;

  if (test('every {placeholder} in the template is covered by dataContract.requiredFields', () => {
    const placeholders = extractPlaceholders(template);
    for (const token of runtimeTokens) placeholders.delete(token);

    const requiredSet = new Set(template.dataContract.requiredFields);
    const missing     = [...placeholders].filter(token => !requiredSet.has(token));
    assert.deepStrictEqual(missing, [],
      `These placeholders are used in the template but missing from dataContract.requiredFields: ${missing.join(', ')}`);
  })) passed++; else failed++;

  if (test('every dataContract field has a corresponding {placeholder} in the template', () => {
    const placeholders = extractPlaceholders(template);
    const orphans      = template.dataContract.requiredFields.filter(f => !placeholders.has(f));
    assert.deepStrictEqual(orphans, [],
      `These dataContract fields have no matching placeholder in the template: ${orphans.join(', ')}`);
  })) passed++; else failed++;

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
