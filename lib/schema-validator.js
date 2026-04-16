'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

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

function formatAjvErrors(errors, data) {
  if (!Array.isArray(errors) || errors.length === 0) return [];

  const idHint = (data && typeof data === 'object' && typeof data.id === 'string' && data.id.trim())
    ? ` (${data.id.trim()})`
    : '';

  return errors.map(err => {
    const at = err.instancePath && err.instancePath.length > 0 ? err.instancePath : '(root)';
    const msg = err.message || 'schema violation';
    const extra = err.params ? ` ${JSON.stringify(err.params)}` : '';
    return `${at}${idHint}: ${msg}${extra}`;
  });
}

function buildAjv() {
  return new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: true,
  });
}

function loadSchemas(repoRoot) {
  const schemasDir = path.join(repoRoot, 'schemas');

  const scopeSchema = readJson(path.join(schemasDir, 'scope.schema.json'));
  const sdsSchema = readJson(path.join(schemasDir, 'sds.schema.json'));
  const requirementSchema = readJson(path.join(schemasDir, 'requirement.schema.json'));
  const designComponentSchema = readJson(path.join(schemasDir, 'design-component.schema.json'));
  const stateSchema = normalizeSchemaRefs(readJson(path.join(schemasDir, 'sdlc-state.schema.json')));
  const complianceSchema = readJson(path.join(schemasDir, 'compliance.schema.json'));

  return {
    scope: scopeSchema,
    sds: sdsSchema,
    requirement: requirementSchema,
    designComponent: designComponentSchema,
    state: stateSchema,
    compliance: complianceSchema,
  };
}

function createSchemaValidator(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const ajv = buildAjv();
  const schemas = loadSchemas(repoRoot);

  // Register schemas for $ref resolution
  for (const schema of Object.values(schemas)) {
    if (schema && schema.$id) {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validators = new Map();

  function getSchema(schemaName) {
    if (schemaName === 'scope') return schemas.scope;
    if (schemaName === 'sds') return schemas.sds;
    if (schemaName === 'requirement') return schemas.requirement;
    if (schemaName === 'design-component') return schemas.designComponent;
    if (schemaName === 'state') return schemas.state;
    if (schemaName === 'compliance') return schemas.compliance;
    throw new Error(`Unknown schema name: ${schemaName}`);
  }

  function getValidator(schemaName) {
    if (validators.has(schemaName)) return validators.get(schemaName);
    const schema = getSchema(schemaName);
    const validator = schema.$id
      ? (ajv.getSchema(schema.$id) || ajv.compile(schema))
      : ajv.compile(schema);
    validators.set(schemaName, validator);
    return validator;
  }

  function validate(data, schemaName) {
    const validator = getValidator(schemaName);
    const ok = validator(data);
    if (ok) return { valid: true };
    return {
      valid: false,
      errors: formatAjvErrors(validator.errors || [], data),
    };
  }

  function assertValid(data, schemaName) {
    const result = validate(data, schemaName);
    if (result.valid) return;
    const messages = Array.isArray(result.errors) ? result.errors : [];
    throw new Error(`Schema validation failed for "${schemaName}":\n${messages.map(m => `- ${m}`).join('\n')}`);
  }

  return {
    validate,
    assertValid,
  };
}

module.exports = {
  createSchemaValidator,
};

