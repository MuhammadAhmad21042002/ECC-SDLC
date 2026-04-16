#!/usr/bin/env node
/**
 * generate-sts-doc.js
 *
 * CLI entry point for STS document generation.
 * Called by /sts command after test case extraction and validation.
 *
 * Usage:
 *   node scripts/generate-sts-doc.js \
 *     --data .sdlc/tmp/sts-data.json \
 *     --out .sdlc/artifacts/sts-v1.docx \
 *     --template templates/sts-template.json \
 *     --version 1 \
 *     --state .sdlc/state.json
 *
 * Arguments:
 *   --data      Path to narrative data JSON from technical-writer agent
 *   --out       Output path for generated .docx file
 *   --template  Path to sts-template.json (optional, defaults to templates/sts-template.json)
 *   --version   Document version number (required)
 *   --state     Path to state.json for test cases and traceability (required)
 *
 * Exit codes:
 *   0  document generated successfully
 *   1  error during generation (file not found, invalid JSON, docx generation failed)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateStsDocument } = require('../lib/doc-generator/sts-doc');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const dataPath = getArg('--data');
const outPath = getArg('--out');
const templatePath = getArg('--template');
const versionStr = getArg('--version');
const statePath = getArg('--state');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!dataPath) {
  console.error('\nERR:MISSING_ARG:--data path/to/sts-data.json is required\n');
  process.exit(1);
}

if (!outPath) {
  console.error('\nERR:MISSING_ARG:--out path/to/output.docx is required\n');
  process.exit(1);
}

if (!versionStr) {
  console.error('\nERR:MISSING_ARG:--version <number> is required\n');
  process.exit(1);
}

if (!statePath) {
  console.error('\nERR:MISSING_ARG:--state path/to/state.json is required\n');
  process.exit(1);
}

const version = parseInt(versionStr, 10);
if (isNaN(version) || version < 1) {
  console.error('\nERR:INVALID_VERSION:--version must be a positive integer\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load data files
// ---------------------------------------------------------------------------

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`\nERR:FILE_NOT_FOUND:${label} not found at ${filePath}\n`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`\nERR:INVALID_JSON:${label} is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
}

const narrativeData = readJson(dataPath, 'Narrative data');
const stateData = readJson(statePath, 'State file');

// ---------------------------------------------------------------------------
// Unwrap stsData wrapper if present
// ---------------------------------------------------------------------------

// The technical writer may wrap output in { stsData: {...} }
// Unwrap if present, otherwise use the raw data
const stsData = narrativeData.stsData || narrativeData;

// ---------------------------------------------------------------------------
// Inject metadata
// ---------------------------------------------------------------------------

stsData._docVersion = version;

// Extract version history from state.json artifacts.sts.versionHistory
if (stateData.artifacts && stateData.artifacts.sts && Array.isArray(stateData.artifacts.sts.versionHistory)) {
  stsData._versionHistory = stateData.artifacts.sts.versionHistory;
} else {
  stsData._versionHistory = [];
}

// Inject project metadata from state if missing in narrative
if (!stsData.projectName && stateData.projectName) {
  stsData.projectName = stateData.projectName;
}
if (!stsData.clientName && stateData.clientName) {
  stsData.clientName = stateData.clientName;
}

// ---------------------------------------------------------------------------
// Generate document
// ---------------------------------------------------------------------------

console.log('\n┌─ ECC-SDLC STS Document Generator ─────────────────────────┐');
console.log('│                                                            │');
console.log(`│  Input (narrative) : ${path.basename(dataPath).padEnd(37)} │`);
console.log(`│  Input (state)     : ${path.basename(statePath).padEnd(37)} │`);
console.log(`│  Output            : ${path.basename(outPath).padEnd(37)} │`);
console.log(`│  Version           : ${String(version).padEnd(37)} │`);
console.log(`│  Template          : ${(templatePath ? path.basename(templatePath) : 'default').padEnd(37)} │`);
console.log('│                                                            │');
console.log('└────────────────────────────────────────────────────────────┘\n');

(async () => {
  try {
    await generateStsDocument(stsData, stateData, outPath, templatePath);
    
    const stats = fs.statSync(outPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    
    console.log('✓ STS document generated successfully\n');
    console.log(`  Output : ${outPath}`);
    console.log(`  Size   : ${sizeKb} KB\n`);
    
    process.exit(0);
  } catch (err) {
    console.error('\nERR:GENERATION_FAILED:', err.message);
    console.error('\nStack trace:');
    console.error(err.stack);
    console.error('');
    process.exit(1);
  }
})();
