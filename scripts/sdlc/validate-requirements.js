#!/usr/bin/env node
/**
 * ECC-SDLC — Requirement Schema Validator
 *
 * Reads every requirement from .sdlc/state.json (or a standalone file) and
 * validates each one against schemas/requirement.schema.json using ajv
 * (JSON Schema Draft-07).
 *
 * Called by the /srs command as a hard block before any document generation.
 * A single invalid requirement causes exit code 1 — no .docx is ever produced
 * from malformed data.
 *
 * Usage:
 *   node scripts/sdlc/validate-requirements.js
 *   node scripts/sdlc/validate-requirements.js --state path/to/state.json
 *   node scripts/sdlc/validate-requirements.js --file path/to/requirements.json
 *   node scripts/sdlc/validate-requirements.js --json    (machine-readable output)
 *
 * --state  reads requirements from state.json.requirements array (default)
 * --file   reads requirements from a standalone JSON file produced by the
 *          BA agent and written to .sdlc/tmp/requirements.json by /srs Step 2.
 *          The file may be a bare array [] or an object { requirements: [] }.
 *          Use this flag in /srs Step 3 to validate before touching state.json.
 *
 * Exit codes:
 *   0  all requirements valid — safe to proceed with SRS generation
 *   1  one or more requirements failed validation (HARD BLOCK)
 *   2  state.json or schema file missing / unreadable (HARD BLOCK)
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
const stateIdx    = args.indexOf('--state');
const fileIdx     = args.indexOf('--file');
const customState = stateIdx !== -1 ? args[stateIdx + 1] : null;
const customFile  = fileIdx  !== -1 ? args[fileIdx  + 1] : null;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT   = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'requirement.schema.json');
const SDLC_DIR    = '.sdlc';
const STATE_FILE  = 'state.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Walk up from cwd up to 6 levels to find the nearest .sdlc/state.json.
 * Returns the resolved absolute path, or null if not found.
 */
function findStateFile() {
  if (customState) return path.resolve(customState);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, SDLC_DIR, STATE_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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

/**
 * Validate one requirement object against the compiled ajv schema.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
function validateRequirement(req, validate) {
  const ok = validate(req);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors || []).map(formatAjvError),
  };
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

function buildHumanReport(results, sourcePath) {
  const failed = results.filter(r => !r.valid);
  const passed = results.filter(r => r.valid);
  const lines  = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════╗');
  lines.push('║       ECC-SDLC — Requirement Validation Report           ║');
  lines.push('╚══════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Source     : ${sourcePath}`);
  lines.push(`  Total      : ${results.length}`);
  lines.push(`  Passed     : ${passed.length}`);
  lines.push(`  Failed     : ${failed.length}`);
  lines.push('');

  if (failed.length === 0) {
    lines.push('  ✓ All requirements passed schema validation.');
    lines.push('  ✓ SRS generation may proceed.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('  ✗ HARD BLOCK — Fix the errors below, then re-run /srs.');
  lines.push('');
  lines.push('─'.repeat(60));

  for (const result of failed) {
    lines.push('');
    lines.push(`  ✗ ${result.id || '(missing id)'}`);
    for (const err of result.errors) {
      lines.push(`      ${err}`);
    }
  }

  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('');
  lines.push('  Quick reference:');
  lines.push('  ID format   : REQ-FUNC-NNN | REQ-NFUNC-NNN | REQ-CON-NNN');
  lines.push('  priority    : must | should | could | wont');
  lines.push('  status      : draft | validated | approved | deferred | rejected');
  lines.push('  type        : functional | non-functional | constraint');
  lines.push('  category    : required when type is non-functional');
  lines.push('                (performance | security | scalability | usability |');
  lines.push('                 compliance | availability)');
  lines.push('  Schema      : schemas/requirement.schema.json');
  lines.push('');

  return lines.join('\n');
}

function buildJsonReport(results, sourcePath, schemaId) {
  const failed = results.filter(r => !r.valid);
  return JSON.stringify({
    valid:    failed.length === 0,
    sourcePath,
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

  // ── 1. Load and compile schema ────────────────────────────────────────────
  if (!fs.existsSync(SCHEMA_PATH)) {
    hardBlock(`Requirement schema not found: ${SCHEMA_PATH}`);
  }

  let requirementSchema;
  try {
    requirementSchema = readJson(SCHEMA_PATH);
  } catch (err) {
    hardBlock(`Cannot parse requirement schema: ${err.message}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: true });
  let validate;
  try {
    validate = ajv.compile(requirementSchema);
  } catch (err) {
    hardBlock(`ajv failed to compile schema: ${err.message}`);
  }

  // ── 2. Load requirements — from --file or --state ─────────────────────────
  let requirements;
  let sourcePath;

  if (customFile) {
    // --file mode: validate a standalone requirements file produced by BA agent
    // Supports both bare array [] and object { requirements: [] }
    sourcePath = path.resolve(customFile);
    if (!fs.existsSync(sourcePath)) {
      hardBlock(`Requirements file not found: ${sourcePath}`);
    }
    let raw;
    try {
      raw = readJson(sourcePath);
    } catch (err) {
      hardBlock(`Cannot parse requirements file: ${err.message}`);
    }
    requirements = Array.isArray(raw) ? raw : raw.requirements;

  } else {
    // --state mode (default): read from state.json.requirements
    const statePath = findStateFile();
    if (!statePath || !fs.existsSync(statePath)) {
      hardBlock('.sdlc/state.json not found. Run /scope first to initialise the project.');
    }
    sourcePath = statePath;
    let state;
    try {
      state = readJson(statePath);
    } catch (err) {
      hardBlock(`state.json is not valid JSON: ${err.message}`);
    }
    requirements = state.requirements;
  }

  // ── 3. Guard: requirements must be a non-empty array ─────────────────────
  if (!Array.isArray(requirements)) {
    const msg = customFile
      ? `Requirements file must contain an array or { requirements: [] } — got: ${typeof requirements}`
      : 'state.json has no "requirements" array. Run /srs after requirements have been extracted.';
    hardBlock(msg);
  }

  if (requirements.length === 0) {
    const msg = 'requirements array is empty. At least one requirement is needed to generate an SRS.';
    if (jsonOutput) {
      process.stdout.write(JSON.stringify({ valid: false, error: msg, sourcePath }));
    } else {
      process.stderr.write(`\n  HARD BLOCK: ${msg}\n\n`);
    }
    process.exit(1);
  }

  // ── 4. Validate every requirement ─────────────────────────────────────────
  const results = requirements.map(req => ({
    id: req.id || null,
    ...validateRequirement(req, validate),
  }));

  // ── 5. Output report ──────────────────────────────────────────────────────
  if (jsonOutput) {
    process.stdout.write(buildJsonReport(results, sourcePath, requirementSchema.$id));
  } else {
    process.stdout.write(buildHumanReport(results, sourcePath));
  }

  // ── 6. Hard block on any failure ──────────────────────────────────────────
  const failCount = results.filter(r => !r.valid).length;
  process.exit(failCount > 0 ? 1 : 0);
}

main();
