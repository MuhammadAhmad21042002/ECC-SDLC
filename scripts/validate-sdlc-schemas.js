const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return 'No errors.';
  return errors
    .map(e => {
      const at = e.instancePath || '(root)';
      const msg = e.message || 'schema violation';
      const extra = e.params ? ` ${JSON.stringify(e.params)}` : '';
      return `- ${at}: ${msg}${extra}`;
    })
    .join('\n');
}

function normalizeSchemaRefs(schema) {
  // Our state schema references relative schema files (e.g. "./requirement.schema.json").
  // AJV resolves $ref via $id/URIs; easiest is to rewrite it to the requirement schema $id.
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

function validateWith(schema, data, ajv) {
  const validate = ajv.compile(schema);
  const ok = validate(data);
  return { ok, errors: validate.errors };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const schemasDir = path.join(repoRoot, 'schemas');
  const fixturesDir = path.join(repoRoot, 'tests', 'sdlc', 'fixtures');

  const scopeSchemaPath = path.join(schemasDir, 'scope.schema.json');
  const sdsSchemaPath = path.join(schemasDir, 'sds.schema.json');
  const requirementSchemaPath = path.join(schemasDir, 'requirement.schema.json');
  const designComponentSchemaPath = path.join(schemasDir, 'design-component.schema.json');
  const stateSchemaPath = path.join(schemasDir, 'sdlc-state.schema.json');

  const validScopePath = path.join(fixturesDir, 'valid-scope.json');
  const validSdsPath = path.join(fixturesDir, 'valid-sds.json');
  const validRequirementPath = path.join(fixturesDir, 'valid-requirement.json');
  const validDesignComponentPath = path.join(fixturesDir, 'valid-design-component.json');
  const validStatePath = path.join(fixturesDir, 'valid-state.json');

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: true
  });

  const scopeSchema = readJson(scopeSchemaPath);
  const sdsSchema = readJson(sdsSchemaPath);
  const requirementSchema = readJson(requirementSchemaPath);
  const designComponentSchema = readJson(designComponentSchemaPath);
  const stateSchema = normalizeSchemaRefs(readJson(stateSchemaPath));

  ajv.addSchema(scopeSchema, scopeSchema.$id);
  ajv.addSchema(sdsSchema, sdsSchema.$id);
  ajv.addSchema(requirementSchema, requirementSchema.$id);
  ajv.addSchema(designComponentSchema, designComponentSchema.$id);
  ajv.addSchema(stateSchema, stateSchema.$id);

  const validScope = readJson(validScopePath);
  const validSds = readJson(validSdsPath);
  const validRequirement = readJson(validRequirementPath);
  const validDesignComponent = readJson(validDesignComponentPath);
  const validState = readJson(validStatePath);

  console.log('ECC-SDLC schema validation\n');

  {
    const { ok, errors } = validateWith(scopeSchema, validScope, ajv);
    console.log(`[scope.schema.json] valid-scope.json -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(formatAjvErrors(errors));
    console.log('');
  }

  {
    const { ok, errors } = validateWith(sdsSchema, validSds, ajv);
    console.log(`[sds.schema.json] valid-sds.json -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(formatAjvErrors(errors));
    console.log('');
  }

  {
    const { ok, errors } = validateWith(requirementSchema, validRequirement, ajv);
    console.log(`[requirement.schema.json] valid-requirement.json -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(formatAjvErrors(errors));
    console.log('');
  }

  {
    const { ok, errors } = validateWith(designComponentSchema, validDesignComponent, ajv);
    console.log(`[design-component.schema.json] valid-design-component.json -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(formatAjvErrors(errors));
    console.log('');
  }

  {
    const { ok, errors } = validateWith(stateSchema, validState, ajv);
    console.log(`[sdlc-state.schema.json] valid-state.json -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(formatAjvErrors(errors));
    console.log('');
  }

  if (process.exitCode && process.exitCode !== 0) return;
}

main();
