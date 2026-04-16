#!/usr/bin/env node
/**
 * ECC-SDLC — Test Case Schema Validator
 *
 * Reads test cases from .sdlc/tmp/test-cases.json (or a standalone file) and
 * validates each one against schemas/test-case.schema.json using ajv
 * (JSON Schema Draft-07).
 *
 * Additionally validates cross-references:
 *   - All REQ-* IDs in linkedRequirements exist in state.json.requirements[]
 *   - All CMP-* IDs in linkedComponents exist in state.json.designComponents[]
 *   - testCaseId follows TC-NNN format (zero-padded 3-digit)
 *
 * Called by the /sts command as a hard block before any document generation.
 * A single invalid test case causes exit code 1 — no .docx is ever produced
 * from malformed data.
 *
 * Usage:
 *   node scripts/sdlc/validate-test-cases.js --file .sdlc/tmp/test-cases.json --state .sdlc/state.json
 *   node scripts/sdlc/validate-test-cases.js --file path/to/test-cases.json --state path/to/state.json
 *   node scripts/sdlc/validate-test-cases.js --json    (machine-readable output)
 *
 * --file   reads test cases from a standalone JSON file produced by the
 *          BA agent and written to .sdlc/tmp/test-cases.json by /sts Step 2.
 *          The file may be a bare array [] or an object { testCases: [] }.
 *          REQUIRED.
 *
 * --state  path to state.json for cross-reference validation. REQUIRED.
 *
 * Exit codes:
 *   0  all test cases valid — safe to proceed with STS generation
 *   1  one or more test cases failed validation (HARD BLOCK)
 *   2  test cases file, state.json, or schema file missing / unreadable (HARD BLOCK)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args        = process.argv.slice(2);
const jsonOutput  = args.includes('--json');
const fileIdx     = args.indexOf('--file');
const stateIdx    = args.indexOf('--state');
const customFile  = fileIdx  !== -1 ? args[fileIdx  + 1] : null;
const customState = stateIdx !== -1 ? args[stateIdx + 1] : null;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT   = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'test-case.schema.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Format a single ajv error object into a readable one-liner.
 */
function formatAjvError(err) {
  const at    = err.instancePath || '(root)';
  const msg   = err.message || 'schema violation';
  const extra = err.params ? ` — ${JSON.stringify(err.params)}` : '';
  return `at ${at}: ${msg}${extra}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TC_ID_PATTERN = /^TC-\d{3}$/;

/**
 * Validate one test case object against the compiled ajv schema.
 * Also validates TC-NNN format and cross-references.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
function validateTestCase(tc, validate, reqIds, cmpIds) {
  const errors = [];

  // 1. Schema validation
  const ok = validate(tc);
  if (!ok) {
    errors.push(...(validate.errors || []).map(formatAjvError));
  }

  // 2. TC-NNN format validation
  if (tc.testCaseId && !TC_ID_PATTERN.test(tc.testCaseId)) {
    errors.push(`testCaseId "${tc.testCaseId}" does not match TC-NNN format (e.g., TC-001, TC-042)`);
  }

  // 3. linkedRequirements validation
  if (!Array.isArray(tc.linkedRequirements) || tc.linkedRequirements.length === 0) {
    errors.push('linkedRequirements must be a non-empty array — every test case must link to at least one REQ-*');
  } else {
    for (const reqId of tc.linkedRequirements) {
      if (!reqIds.has(reqId)) {
        errors.push(`linkedRequirements contains non-existent requirement: ${reqId}`);
      }
    }
  }

  // 4. linkedComponents validation (optional field, but must reference valid CMPs if present)
  if (Array.isArray(tc.linkedComponents) && tc.linkedComponents.length > 0) {
    for (const cmpId of tc.linkedComponents) {
      if (!cmpIds.has(cmpId)) {
        errors.push(`linkedComponents contains non-existent component: ${cmpId}`);
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

function buildHumanReport(results, sourcePath, statePath) {
  const failed = results.filter(r => !r.valid);
  const passed = results.filter(r => r.valid);
  const lines  = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════╗');
  lines.push('║       ECC-SDLC — Test Case Validation Report             ║');
  lines.push('╚══════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Source     : ${sourcePath}`);
  lines.push(`  State      : ${statePath}`);
  lines.push(`  Total      : ${results.length}`);
  lines.push(`  Passed     : ${passed.length}`);
  lines.push(`  Failed     : ${failed.length}`);
  lines.push('');

  if (failed.length === 0) {
    lines.push('  ✓ All test cases passed schema validation.');
    lines.push('  ✓ All TC-NNN IDs are correctly formatted.');
    lines.push('  ✓ All REQ-* and CMP-* cross-references are valid.');
    lines.push('  ✓ STS generation may proceed.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('  ✗ HARD BLOCK — Fix the errors below, then re-run /sts.');
  lines.push('');
  lines.push('─'.repeat(60));

  for (const result of failed) {
    lines.push('');
    lines.push(`  ✗ ${result.id || '(missing testCaseId)'}`);
    for (const err of result.errors) {
      lines.push(`      ${err}`);
    }
  }

  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('');
  lines.push('  Quick reference:');
  lines.push('  testCaseId         : TC-NNN (zero-padded 3-digit, e.g., TC-001, TC-042)');
  lines.push('  linkedRequirements : must be non-empty array of valid REQ-* IDs');
  lines.push('  linkedComponents   : optional array of valid CMP-* IDs');
  lines.push('  testType           : unit | integration | system | uat | performance | security');
  lines.push('  status             : not-run | passed | failed | blocked');
  lines.push('  Schema             : schemas/test-case.schema.json');
  lines.push('');

  return lines.join('\n');
}

function buildJsonReport(results, sourcePath, statePath, schemaId) {
  const failed = results.filter(r => !r.valid);
  return JSON.stringify({
    valid:    failed.length === 0,
    sourcePath,
    statePath,
    schemaId,
    total:    results.length,
    passed:   results.filter(r => r.valid).length,
    failed:   failed.length,
    failures: failed.map(r => ({ id: r.id, errors: r.errors })),
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Hard block helper
// ---------------------------------------------------------------------------

function hardBlock(msg) {
  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ valid: false, error: msg }));
  } else {
    process.stderr.write(`\n  HARD BLOCK: ${msg}\n\n`);
  }
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {

  // ── 1. Validate CLI arguments ─────────────────────────────────────────────
  if (!customFile) {
    hardBlock('Missing required argument: --file <path-to-test-cases.json>');
  }
  if (!customState) {
    hardBlock('Missing required argument: --state <path-to-state.json>');
  }

  // ── 2. Load and compile schema ────────────────────────────────────────────
  if (!fs.existsSync(SCHEMA_PATH)) {
    hardBlock(`Test case schema not found: ${SCHEMA_PATH}`);
  }

  let testCaseSchema;
  try {
    testCaseSchema = readJson(SCHEMA_PATH);
  } catch (err) {
    hardBlock(`Cannot parse test case schema: ${err.message}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: true });
  let validate;
  try {
    validate = ajv.compile(testCaseSchema);
  } catch (err) {
    hardBlock(`ajv failed to compile schema: ${err.message}`);
  }

  // ── 3. Load test cases from --file ────────────────────────────────────────
  const sourcePath = path.resolve(customFile);
  if (!fs.existsSync(sourcePath)) {
    hardBlock(`Test cases file not found: ${sourcePath}`);
  }

  let testCases;
  try {
    const raw = readJson(sourcePath);
    testCases = Array.isArray(raw) ? raw : raw.testCases;
  } catch (err) {
    hardBlock(`Cannot parse test cases file: ${err.message}`);
  }

  if (!Array.isArray(testCases)) {
    hardBlock(`Test cases file must contain an array or { testCases: [] } — got: ${typeof testCases}`);
  }

  if (testCases.length === 0) {
    hardBlock('testCases array is empty. At least one test case is needed to generate an STS.');
  }

  // ── 4. Load state.json for cross-reference validation ─────────────────────
  const statePath = path.resolve(customState);
  if (!fs.existsSync(statePath)) {
    hardBlock(`State file not found: ${statePath}`);
  }

  let state;
  try {
    state = readJson(statePath);
  } catch (err) {
    hardBlock(`state.json is not valid JSON: ${err.message}`);
  }

  // Build lookup sets for cross-reference validation
  const reqIds = new Set(
    Array.isArray(state.requirements)
      ? state.requirements.map(r => r.id).filter(Boolean)
      : []
  );

  const cmpIds = new Set(
    Array.isArray(state.designComponents)
      ? state.designComponents.map(c => c.id).filter(Boolean)
      : []
  );

  if (reqIds.size === 0) {
    hardBlock('state.json has no requirements. Run /srs first.');
  }

  // ── 5. Validate every test case ───────────────────────────────────────────
  const results = testCases.map(tc => ({
    id: tc.testCaseId || null,
    ...validateTestCase(tc, validate, reqIds, cmpIds),
  }));

  // ── 6. Output report ──────────────────────────────────────────────────────
  if (jsonOutput) {
    process.stdout.write(buildJsonReport(results, sourcePath, statePath, testCaseSchema.$id));
  } else {
    process.stdout.write(buildHumanReport(results, sourcePath, statePath));
  }

  // ── 7. Hard block on any failure ──────────────────────────────────────────
  const failCount = results.filter(r => !r.valid).length;
  process.exit(failCount > 0 ? 1 : 0);
}

main();
