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
  console.log('\n=== Testing ECC-SDLC sts-template.json ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const templatePath = path.join(repoRoot, 'templates', 'sts-template.json');

  // Tokens excluded from data-contract checks:
  // pageNumber, pageCount — injected by docx-js at render time
  const runtimeTokens = new Set(['pageNumber', 'pageCount']);

  let template;
  if (!test('sts-template.json exists and parses as valid JSON', () => {
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

  if (test('templateId is "ecc-sdlc.sts.v1"', () => {
    assert.strictEqual(template.templateId, 'ecc-sdlc.sts.v1');
  })) passed++; else failed++;

  if (test('documentType is "sts"', () => {
    assert.strictEqual(template.documentType, 'sts');
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

  console.log('\nRequired sections (acceptance criteria):');

  const sectionIds = template.sections.map(s => s && s.id);
  const requiredSections = [
    'testScope',
    'testEnvironment',
    'testCases',
    'traceabilityMatrixSection',
    'appendixSignOff',
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
  if (test('toc appears before introduction', () => assertBefore('toc', 'introduction'))) passed++; else failed++;
  if (test('introduction appears before testScope', () => assertBefore('introduction', 'testScope'))) passed++; else failed++;
  if (test('testScope appears before testStrategy', () => assertBefore('testScope', 'testStrategy'))) passed++; else failed++;
  if (test('testStrategy appears before testEnvironment', () => assertBefore('testStrategy', 'testEnvironment'))) passed++; else failed++;
  if (test('testEnvironment appears before testCases', () => assertBefore('testEnvironment', 'testCases'))) passed++; else failed++;
  if (test('testCases appears before traceabilityMatrixSection', () => assertBefore('testCases', 'traceabilityMatrixSection'))) passed++; else failed++;

  console.log('\nTest Cases table validation (acceptance criteria):');

  const testCasesSection = template.sections.find(s => s.id === 'testCases');
  
  if (test('testCases section exists and is type "table"', () => {
    assert.ok(testCasesSection, 'testCases section must exist');
    assert.strictEqual(testCasesSection.type, 'table', 'testCases must be type "table"');
  })) passed++; else failed++;

  const requiredTestCaseColumns = [
    'testCaseId',
    'linkedRequirements',
    'testType',
    'description',
    'steps',
    'expectedResult',
    'status'
  ];

  if (test('testCases table has all 7 required columns', () => {
    assert.ok(testCasesSection && testCasesSection.content && testCasesSection.content.columns,
      'testCases section must have content.columns');
    const columnKeys = testCasesSection.content.columns.map(c => c.key);
    for (const requiredCol of requiredTestCaseColumns) {
      assert.ok(columnKeys.includes(requiredCol),
        `testCases table missing required column: ${requiredCol}`);
    }
    assert.strictEqual(testCasesSection.content.columns.length, 7,
      'testCases table must have exactly 7 columns');
  })) passed++; else failed++;

  if (test('linkedRequirements column has required: true', () => {
    const linkedReqCol = testCasesSection.content.columns.find(c => c.key === 'linkedRequirements');
    assert.ok(linkedReqCol, 'linkedRequirements column must exist');
    assert.strictEqual(linkedReqCol.required, true,
      'linkedRequirements.required must be true');
  })) passed++; else failed++;

  if (test('linkedRequirements column has correct description text', () => {
    const linkedReqCol = testCasesSection.content.columns.find(c => c.key === 'linkedRequirements');
    assert.ok(linkedReqCol, 'linkedRequirements column must exist');
    assert.strictEqual(
      linkedReqCol.description,
      'At least one REQ-* ID required — format: REQ-FUNC-NNN or REQ-NFUNC-NNN or REQ-CON-NNN',
      'linkedRequirements.description text must match exactly'
    );
  })) passed++; else failed++;

  if (test('testCaseId column has pattern field with TC-NNN format', () => {
    const testCaseIdCol = testCasesSection.content.columns.find(c => c.key === 'testCaseId');
    assert.ok(testCaseIdCol, 'testCaseId column must exist');
    assert.ok(testCaseIdCol.pattern, 'testCaseId must have a pattern field');
    assert.ok(testCaseIdCol.pattern.includes('TC-NNN'),
      'testCaseId.pattern must reference TC-NNN format');
  })) passed++; else failed++;

  if (test('testCases table columns sum to 100', () => {
    assert.strictEqual(sumWidths(testCasesSection.content.columns), 100,
      'testCases table column widths must sum to 100%');
  })) passed++; else failed++;

  console.log('\nTraceability Matrix validation (acceptance criteria):');

  const traceMatrixSection = template.sections.find(s => s.id === 'traceabilityMatrixSection');

  if (test('traceabilityMatrixSection exists and is type "table"', () => {
    assert.ok(traceMatrixSection, 'traceabilityMatrixSection must exist');
    assert.strictEqual(traceMatrixSection.type, 'table',
      'traceabilityMatrixSection must be type "table"');
  })) passed++; else failed++;

  const requiredTraceColumns = [
    'reqId',
    'title',
    'designCoverage',
    'testCoverage',
    'costCoverage',
    'overallStatus'
  ];

  if (test('traceabilityMatrixSection has all required columns matching /traceability output', () => {
    assert.ok(traceMatrixSection && traceMatrixSection.content && traceMatrixSection.content.columns,
      'traceabilityMatrixSection must have content.columns');
    const columnKeys = traceMatrixSection.content.columns.map(c => c.key);
    for (const requiredCol of requiredTraceColumns) {
      assert.ok(columnKeys.includes(requiredCol),
        `traceabilityMatrixSection missing required column: ${requiredCol}`);
    }
    assert.strictEqual(traceMatrixSection.content.columns.length, 6,
      'traceabilityMatrixSection must have exactly 6 columns');
  })) passed++; else failed++;

  if (test('traceabilityMatrixSection columns match /traceability command output format exactly', () => {
    const columnKeys = traceMatrixSection.content.columns.map(c => c.key);
    assert.deepStrictEqual(columnKeys, requiredTraceColumns,
      'traceabilityMatrixSection column order must match /traceability output format');
  })) passed++; else failed++;

  if (test('traceabilityMatrixSection table columns sum to 100', () => {
    assert.strictEqual(sumWidths(traceMatrixSection.content.columns), 100,
      'traceabilityMatrixSection column widths must sum to 100%');
  })) passed++; else failed++;

  console.log('\nAdditional key table checks:');

  const coverageSummaryTable = template.sections.find(s => s.id === 'coverageSummaryTable');
  if (test('coverageSummaryTable columns sum to 100', () => {
    assert.ok(coverageSummaryTable && coverageSummaryTable.type === 'table',
      'coverageSummaryTable must exist and be type "table"');
    assert.strictEqual(sumWidths(coverageSummaryTable.content.columns), 100);
  })) passed++; else failed++;

  const testScheduleTable = template.sections.find(s => s.id === 'testScheduleTable');
  if (test('testScheduleTable columns sum to 100', () => {
    assert.ok(testScheduleTable && testScheduleTable.type === 'table',
      'testScheduleTable must exist and be type "table"');
    assert.strictEqual(sumWidths(testScheduleTable.content.columns), 100);
  })) passed++; else failed++;

  const defectSeverityTable = template.sections.find(s => s.id === 'defectSeverityTable');
  if (test('defectSeverityTable columns sum to 100', () => {
    assert.ok(defectSeverityTable && defectSeverityTable.type === 'table',
      'defectSeverityTable must exist and be type "table"');
    assert.strictEqual(sumWidths(defectSeverityTable.content.columns), 100);
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
