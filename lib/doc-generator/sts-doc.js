'use strict';

/**
 * sts-doc.js
 *
 * Orchestrates the full STS document generation pipeline, mirroring srs-doc.js and sds-doc.js:
 *   1. Build flat render data from technical-writer STS JSON.
 *   2. Merge test cases directly from state.json (not from technical writer).
 *   3. Build traceability matrix from state.json requirements with forward trace links.
 *   4. Merge coverage summary from state.json.
 *   5. Call generateFromTemplate to produce the .docx file.
 *
 * The STS template contains:
 *   - Narrative sections (purpose, scope, strategy, environment) from technical writer
 *   - Test cases table sourced from state.json.testCases
 *   - Traceability matrix built from state.json.requirements with traceForward links
 *   - Coverage analysis from state.json.testCoverageSummary
 *
 * This ensures test case data is always sourced from validated state, not re-extracted.
 */

const path = require('path');
const { generateFromTemplate } = require('./generic-doc');
const { buildStsRenderData } = require('./sts-render-data');

async function generateStsDocument(stsData, stateData, outputPath, templatePath) {
  const resolvedTemplate = templatePath || path.join(__dirname, '..', '..', 'templates', 'sts-template.json');

  // Step 1 — flat render data from narrative + state
  // The technical writer provides narrative sections only
  // Test cases, traceability matrix, and coverage come from state.json
  const data = buildStsRenderData(stsData || {}, stateData || {});

  // Step 2 — render docx
  return generateFromTemplate({
    templatePath: resolvedTemplate,
    data,
    outputPath
  });
}

module.exports = { generateStsDocument };
