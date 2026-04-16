const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

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

function normalizeSchemaRefs(schema) {
  // Rewrite relative $ref paths to schema $id values for AJV resolution.
  const cloned = JSON.parse(JSON.stringify(schema));
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      if (node.$ref === './requirement.schema.json') node.$ref = 'ecc-sdlc.requirement.v1';
      if (node.$ref === './design-component.schema.json') node.$ref = 'ecc-sdlc.design-component.v1';
    }
    for (const v of Object.values(node)) visit(v);
  };
  visit(cloned);
  return cloned;
}

function runTests() {
  console.log('\n=== Testing ECC-SDLC schemas ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const schemasDir = path.join(repoRoot, 'schemas');
  const fixturesDir = path.join(repoRoot, 'tests', 'sdlc', 'fixtures');

  const scopeSchema = readJson(path.join(schemasDir, 'scope.schema.json'));
  const sdsSchema = readJson(path.join(schemasDir, 'sds.schema.json'));
  const requirementSchema = readJson(path.join(schemasDir, 'requirement.schema.json'));
  const designComponentSchema = readJson(path.join(schemasDir, 'design-component.schema.json'));
  const stateSchema = normalizeSchemaRefs(readJson(path.join(schemasDir, 'sdlc-state.schema.json')));

  const validScope = readJson(path.join(fixturesDir, 'valid-scope.json'));
  const invalidScope = readJson(path.join(fixturesDir, 'invalid-scope.json'));
  const validSds = readJson(path.join(fixturesDir, 'valid-sds.json'));
  const invalidSds = readJson(path.join(fixturesDir, 'invalid-sds.json'));
  const validRequirement = readJson(path.join(fixturesDir, 'valid-requirement.json'));
  const validDesignComponent = readJson(path.join(fixturesDir, 'valid-design-component.json'));
  const validState = readJson(path.join(fixturesDir, 'valid-state.json'));

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: true
  });

  if (
    test('schemas compile in AJV', () => {
      assert.ok(scopeSchema.$id, 'scope schema missing $id');
      assert.ok(sdsSchema.$id, 'sds schema missing $id');
      assert.ok(requirementSchema.$id, 'requirement schema missing $id');
      assert.ok(designComponentSchema.$id, 'design-component schema missing $id');
      assert.ok(stateSchema.$id, 'state schema missing $id');

      ajv.addSchema(scopeSchema, scopeSchema.$id);
      ajv.addSchema(sdsSchema, sdsSchema.$id);
      ajv.addSchema(requirementSchema, requirementSchema.$id);
      ajv.addSchema(designComponentSchema, designComponentSchema.$id);
      ajv.addSchema(stateSchema, stateSchema.$id);

      // Compile to ensure no invalid schema definitions
      ajv.compile(scopeSchema);
      ajv.compile(sdsSchema);
      ajv.compile(requirementSchema);
      ajv.compile(designComponentSchema);
      ajv.compile(stateSchema);
    })
  )
    passed++;
  else failed++;

  if (
    test('valid scope fixture passes scope schema', () => {
      const validate = ajv.getSchema(scopeSchema.$id) || ajv.compile(scopeSchema);
      const ok = validate(validScope);
      if (!ok) {
        throw new Error(`AJV errors: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('invalid scope fixture fails scope schema', () => {
      const validate = ajv.getSchema(scopeSchema.$id) || ajv.compile(scopeSchema);
      const ok = validate(invalidScope);
      if (ok) {
        throw new Error('Expected invalid scope fixture to fail validation, but it passed.');
      }
      assert.ok(Array.isArray(validate.errors) && validate.errors.length > 0, 'Expected AJV errors for invalid scope fixture.');
    })
  )
    passed++;
  else failed++;

  if (
    test('valid sds fixture passes sds schema', () => {
      const validate = ajv.getSchema(sdsSchema.$id) || ajv.compile(sdsSchema);
      const ok = validate(validSds);
      if (!ok) {
        throw new Error(`AJV errors: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('invalid sds fixture fails sds schema', () => {
      const validate = ajv.getSchema(sdsSchema.$id) || ajv.compile(sdsSchema);
      const ok = validate(invalidSds);
      if (ok) {
        throw new Error('Expected invalid sds fixture to fail validation, but it passed.');
      }
      assert.ok(Array.isArray(validate.errors) && validate.errors.length > 0, 'Expected AJV errors for invalid sds fixture.');
    })
  )
    passed++;
  else failed++;

  if (
    test('valid requirement fixture passes requirement schema', () => {
      const validate = ajv.getSchema(requirementSchema.$id) || ajv.compile(requirementSchema);
      const ok = validate(validRequirement);
      if (!ok) {
        throw new Error(`AJV errors: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('valid design component fixture passes design-component schema', () => {
      const validate = ajv.getSchema(designComponentSchema.$id) || ajv.compile(designComponentSchema);
      const ok = validate(validDesignComponent);
      if (!ok) {
        throw new Error(`AJV errors: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('valid state fixture passes sdlc-state schema', () => {
      const validate = ajv.getSchema(stateSchema.$id) || ajv.compile(stateSchema);
      const ok = validate(validState);
      if (!ok) {
        throw new Error(`AJV errors: ${JSON.stringify(validate.errors, null, 2)}`);
      }
    })
  )
    passed++;
  else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
