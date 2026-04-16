const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v);
      return;
    }
    if (typeof value !== 'string') return;
    const regex = /\{([a-zA-Z0-9_]+)\}/g;
    let match;
    while ((match = regex.exec(value)) !== null) placeholders.add(match[1]);
  };
  visit(template);
  return placeholders;
}

function sumWidths(columns) {
  return columns.reduce((sum, c) => sum + (typeof c.widthPct === 'number' ? c.widthPct : 0), 0);
}

function runTests() {
  console.log('\n=== Testing ECC-SDLC sds-template.json ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const templatePath = path.join(repoRoot, 'templates', 'sds-template.json');

  // Tokens excluded from data-contract checks:
  // pageNumber, pageCount — injected by docx-js at render time
  const runtimeTokens = new Set(['pageNumber', 'pageCount']);

  let template;
  if (!test('sds-template.json exists and parses as valid JSON', () => {
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

  console.log('Metadata:');

  if (test('templateSchema is "ecc-sdlc.template.v1"', () => {
    assert.strictEqual(template.templateSchema, 'ecc-sdlc.template.v1');
  })) passed++; else failed++;

  if (test('templateId is "ecc-sdlc.sds.v1"', () => {
    assert.strictEqual(template.templateId, 'ecc-sdlc.sds.v1');
  })) passed++; else failed++;

  if (test('documentType is "sds"', () => {
    assert.strictEqual(template.documentType, 'sds');
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

  console.log('\nRequired sections:');

  const sectionIds = template.sections.map(s => s && s.id);
  const requiredSections = [
    'cover',
    'versionHistory',
    'toc',
    'architectureOverview',
    'componentSpecifications',
    'databaseSchema',
    'databaseTables',
    'apiContracts',
    'integrationPoints',
    'securityArchitecture',
    'traceabilityMatrix',
  ];

  for (const id of requiredSections) {
    if (test(`section "${id}" exists`, () => {
      assert.ok(sectionIds.includes(id), `Missing section with id "${id}"`);
    })) passed++; else failed++;
  }

  console.log('\nSection ordering:');

  function assertBefore(a, b) {
    assert.ok(sectionIds.indexOf(a) < sectionIds.indexOf(b), `${a} must appear before ${b}`);
  }

  if (test('cover appears before versionHistory', () => assertBefore('cover', 'versionHistory'))) passed++; else failed++;
  if (test('versionHistory appears before toc', () => assertBefore('versionHistory', 'toc'))) passed++; else failed++;
  if (test('toc appears before architectureOverview', () => assertBefore('toc', 'architectureOverview'))) passed++; else failed++;
  if (test('architectureOverview appears before componentSpecifications', () => assertBefore('architectureOverview', 'componentSpecifications'))) passed++; else failed++;
  if (test('componentSpecifications appears before databaseSchema', () => assertBefore('componentSpecifications', 'databaseSchema'))) passed++; else failed++;
  if (test('databaseSchema appears before databaseTables', () => assertBefore('databaseSchema', 'databaseTables'))) passed++; else failed++;
  if (test('databaseTables appears before apiContracts', () => assertBefore('databaseTables', 'apiContracts'))) passed++; else failed++;
  if (test('apiContracts appears before integrationPoints', () => assertBefore('apiContracts', 'integrationPoints'))) passed++; else failed++;
  if (test('integrationPoints appears before securityArchitecture', () => assertBefore('integrationPoints', 'securityArchitecture'))) passed++; else failed++;
  if (test('securityArchitecture appears before traceabilityMatrix', () => assertBefore('securityArchitecture', 'traceabilityMatrix'))) passed++; else failed++;

  console.log('\nKey table checks:');

  const componentSpecs = template.sections.find(s => s.id === 'componentSpecifications');
  if (test('componentSpecifications table columns sum to 100', () => {
    assert.ok(componentSpecs && componentSpecs.type === 'table', 'componentSpecifications must exist and be type "table"');
    assert.strictEqual(sumWidths(componentSpecs.content.columns), 100);
  })) passed++; else failed++;

  const apiContracts = template.sections.find(s => s.id === 'apiContracts');
  if (test('apiContracts table columns sum to 100', () => {
    assert.ok(apiContracts && apiContracts.type === 'table', 'apiContracts must exist and be type "table"');
    assert.strictEqual(sumWidths(apiContracts.content.columns), 100);
  })) passed++; else failed++;

  const traceMatrix = template.sections.find(s => s.id === 'traceabilityMatrix');
  if (test('traceabilityMatrix table columns sum to 100', () => {
    assert.ok(traceMatrix && traceMatrix.type === 'table', 'traceabilityMatrix must exist and be type "table"');
    assert.strictEqual(sumWidths(traceMatrix.content.columns), 100);
  })) passed++; else failed++;

  console.log('\nData contract coverage:');

  if (test('dataContract.requiredFields contains no duplicates', () => {
    const fields = template.dataContract.requiredFields;
    const uniqueSet = new Set(fields);
    assert.strictEqual(fields.length, uniqueSet.size,
      `dataContract.requiredFields has duplicates: ${fields.filter((f, i) => fields.indexOf(f) !== i).join(', ')}`);
  })) passed++; else failed++;

  if (test('every {placeholder} in the template is covered by dataContract.requiredFields', () => {
    const placeholders = extractPlaceholders(template);
    for (const token of runtimeTokens) placeholders.delete(token);
    const requiredSet = new Set(template.dataContract.requiredFields);
    const missing = [...placeholders].filter(token => !requiredSet.has(token));
    assert.deepStrictEqual(missing, [],
      `These placeholders are used in the template but missing from dataContract.requiredFields: ${missing.join(', ')}`);
  })) passed++; else failed++;

  if (test('every dataContract field has a corresponding {placeholder} in the template', () => {
    const placeholders = extractPlaceholders(template);
    const orphans = template.dataContract.requiredFields.filter(f => !placeholders.has(f));
    assert.deepStrictEqual(orphans, [],
      `These dataContract fields have no matching placeholder in the template: ${orphans.join(', ')}`);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

