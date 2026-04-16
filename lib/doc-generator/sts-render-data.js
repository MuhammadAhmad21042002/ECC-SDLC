'use strict';

/**
 * sts-render-data.js
 *
 * Maps the business-analyst + technical-writer STS JSON → flat render-data for sts-template.json.
 *
 * Mirrors the srs-render-data.js and sds-render-data.js pattern:
 *   - _docVersion    (number)  injected by generate-sts-doc.js via --version
 *   - _versionHistory (array) injected from state.json artifacts.sts.versionHistory
 *
 * Test cases, traceability matrix, and coverage summary:
 *   These are sourced directly from state.json by generate-sts-doc.js and merged
 *   into the render data before calling this function. The technical writer only
 *   produces narrative sections — test case data comes from state.json.testCases.
 */

function buildStsRenderData(stsData, stateData) {
  const now = new Date();
  const yyyyMmDd = now.toISOString().slice(0, 10);

  // ── Document version ──────────────────────────────────────────────────────
  let docVersionNum = 1;
  if (typeof stsData._docVersion === 'number' && stsData._docVersion >= 1) {
    docVersionNum = stsData._docVersion;
  } else if (typeof stsData.documentVersion === 'string') {
    const parsed = parseInt(stsData.documentVersion, 10);
    if (!isNaN(parsed) && parsed >= 1) docVersionNum = parsed;
  }
  const documentVersion = `${docVersionNum}.0`;

  // ── Version history ────────────────────────────────────────────────────────
  const priorRows = Array.isArray(stsData._versionHistory) ? stsData._versionHistory : [];
  const versionHistory = [];

  for (let v = 1; v < docVersionNum; v++) {
    const prior = priorRows.find(r => parseInt(String(r.version).split('.')[0], 10) === v);
    if (prior) {
      versionHistory.push({
        version: `${v}.0`,
        date: prior.date || '—',
        author: prior.author || 'ECC-SDLC',
        changes: prior.changes || 'STS updated',
        status: prior.status || 'Approved'
      });
    } else {
      versionHistory.push({
        version: `${v}.0`,
        date: '—',
        author: 'ECC-SDLC',
        changes: 'Prior revision',
        status: 'Approved'
      });
    }
  }

  const preparedBy = typeof stsData.preparedBy === 'string' && stsData.preparedBy.trim() ? stsData.preparedBy.trim() : 'ECC-SDLC';

  const testCaseCount = Array.isArray(stateData.testCases) ? stateData.testCases.length : 0;
  const requirementCount = Array.isArray(stateData.requirements) ? stateData.requirements.length : 0;

  versionHistory.push({
    version: `${docVersionNum}.0`,
    date: yyyyMmDd,
    author: preparedBy,
    changes: docVersionNum === 1 
      ? `Initial STS with ${testCaseCount} test cases covering ${requirementCount} requirements` 
      : 'STS updated — test cases revised',
    status: 'Draft'
  });

  // ── Helper: convert to array of strings (paragraphs/bullets) ──────────────
  function toLines(val) {
    if (Array.isArray(val)) return val.length > 0 ? val : ['—'];
    if (typeof val === 'string' && val.trim()) return [val];
    return ['—'];
  }

  // ── Test cases from state.json (already validated) ────────────────────────
  const testCases = Array.isArray(stateData.testCases) ? stateData.testCases.map(tc => ({
    ...tc,
    // Normalize arrays to comma-separated strings for table rendering
    linkedRequirements: Array.isArray(tc.linkedRequirements) 
      ? tc.linkedRequirements.join(', ') 
      : String(tc.linkedRequirements || '—'),
    linkedComponents: Array.isArray(tc.linkedComponents) 
      ? tc.linkedComponents.join(', ') 
      : String(tc.linkedComponents || '—'),
    steps: Array.isArray(tc.steps) ? tc.steps : [String(tc.steps || '—')],
    preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : []
  })) : [];

  // ── Traceability matrix from state.json ────────────────────────────────────
  // Build from requirements with forward trace links
  const traceabilityMatrix = Array.isArray(stateData.requirements)
    ? stateData.requirements.map(req => {
        const traceForward = req.traceForward || {};
        const designCoverage = Array.isArray(traceForward.designComponentIds)
          ? traceForward.designComponentIds.join(', ')
          : '—';
        const testCoverage = Array.isArray(traceForward.testCaseIds)
          ? traceForward.testCaseIds.join(', ')
          : '—';
        const costCoverage = Array.isArray(traceForward.costLineItemIds)
          ? traceForward.costLineItemIds.join(', ')
          : '—';

        // Calculate overall coverage status
        const hasDesign = traceForward.designComponentIds && traceForward.designComponentIds.length > 0;
        const hasTest = traceForward.testCaseIds && traceForward.testCaseIds.length > 0;
        const hasCost = traceForward.costLineItemIds && traceForward.costLineItemIds.length > 0;
        
        let coveragePercent = 0;
        if (hasDesign) coveragePercent += 33.3;
        if (hasTest) coveragePercent += 33.3;
        if (hasCost) coveragePercent += 33.4;

        return {
          reqId: req.id || '—',
          title: req.title || '—',
          designCoverage,
          testCoverage,
          costCoverage,
          overallStatus: `${Math.round(coveragePercent)}%`
        };
      })
    : [];

  // ── Coverage summary from state.json ───────────────────────────────────────
  const coverageSummary = stateData.testCoverageSummary && stateData.testCoverageSummary.byRequirementType
    ? Object.entries(stateData.testCoverageSummary.byRequirementType).map(([type, stats]) => ({
        requirementType: type.charAt(0).toUpperCase() + type.slice(1),
        totalCount: stats.total || 0,
        coveredCount: stats.covered || 0,
        coveragePercent: `${stats.percent || 0}%`,
        status: (stats.percent || 0) >= 100 ? 'Complete' : (stats.percent || 0) >= 80 ? 'Good' : 'Needs Work'
      }))
    : [
        { requirementType: 'Functional', totalCount: 0, coveredCount: 0, coveragePercent: '0%', status: 'Not Run' },
        { requirementType: 'Non-Functional', totalCount: 0, coveredCount: 0, coveragePercent: '0%', status: 'Not Run' },
        { requirementType: 'Constraint', totalCount: 0, coveredCount: 0, coveragePercent: '0%', status: 'Not Run' }
      ];

  // ── Build the flat render data object ────────────────────────────────────
  const data = {
    // Cover / header / footer
    projectName: 'TBD',
    clientName: 'TBD',
    preparedBy,
    generatedDate: yyyyMmDd,
    documentVersion,
    versionHistory,

    // Section 1 — Introduction
    purposeParagraphs: toLines(stsData.purposeParagraphs),
    testScopeParagraphs: toLines(stsData.testScopeParagraphs),
    definitionsTable: Array.isArray(stsData.definitionsTable) ? stsData.definitionsTable : [],
    referencesBullets: toLines(stsData.referencesBullets),
    overviewParagraphs: toLines(stsData.overviewParagraphs),

    // Section 2 — Test Scope
    itemsToBeTestedBullets: toLines(stsData.itemsToBeTestedBullets),
    itemsNotToBeTestedBullets: toLines(stsData.itemsNotToBeTestedBullets),
    testLevelsParagraphs: toLines(stsData.testLevelsParagraphs),

    // Section 3 — Test Strategy
    testingApproachParagraphs: toLines(stsData.testingApproachParagraphs),
    testAutomationParagraphs: toLines(stsData.testAutomationParagraphs),
    entryCriteriaBullets: toLines(stsData.entryCriteriaBullets),
    exitCriteriaBullets: toLines(stsData.exitCriteriaBullets),
    suspensionCriteriaParagraphs: toLines(stsData.suspensionCriteriaParagraphs),

    // Section 4 — Test Environment
    hardwareRequirementsParagraphs: toLines(stsData.hardwareRequirementsParagraphs),
    softwareRequirementsParagraphs: toLines(stsData.softwareRequirementsParagraphs),
    networkConfigParagraphs: toLines(stsData.networkConfigParagraphs),
    testDataRequirementsParagraphs: toLines(stsData.testDataRequirementsParagraphs),
    environmentSetupParagraphs: toLines(stsData.environmentSetupParagraphs),

    // Section 5 — Test Cases (from state.json)
    testCases,
    testCaseId: 'TC-001', // Placeholder for template compatibility
    description: 'Test case description', // Placeholder for template compatibility

    // Section 6 — Traceability Matrix (from state.json)
    traceabilityMatrix,
    coverageGapsParagraphs: toLines(stsData.coverageGapsParagraphs),
    coverageSummary,

    // Section 7 — Test Schedule and Resources
    testSchedule: Array.isArray(stsData.testSchedule) ? stsData.testSchedule : [],
    resourceAllocation: Array.isArray(stsData.resourceAllocation) ? stsData.resourceAllocation : [],
    testDeliverablesBullets: toLines(stsData.testDeliverablesBullets),

    // Section 8 — Defect Management
    defectReportingParagraphs: toLines(stsData.defectReportingParagraphs),
    defectSeverityClassification: Array.isArray(stsData.defectSeverityClassification) 
      ? stsData.defectSeverityClassification 
      : [],
    defectTrackingParagraphs: toLines(stsData.defectTrackingParagraphs),

    // Section 9 — Risk Management
    testRisks: Array.isArray(stsData.testRisks) ? stsData.testRisks : [],
    mitigationStrategiesParagraphs: toLines(stsData.mitigationStrategiesParagraphs),

    // Appendices
    testDataSpecificationsParagraphs: toLines(stsData.testDataSpecificationsParagraphs),
    testToolsParagraphs: toLines(stsData.testToolsParagraphs),
    signOffRows: Array.isArray(stsData.signOffRows) ? stsData.signOffRows : [],
    indexEntries: Array.isArray(stsData.indexEntries) ? stsData.indexEntries : []
  };

  // Explicit string overrides from input
  for (const field of ['projectName', 'clientName', 'generatedDate']) {
    if (typeof stsData[field] === 'string' && stsData[field].trim()) {
      data[field] = stsData[field].trim();
    }
  }

  return data;
}

module.exports = { buildStsRenderData };
