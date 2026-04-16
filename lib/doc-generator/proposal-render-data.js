'use strict';

/**
 * proposal-render-data.js
 *
 * Mirrors srs-render-data.js.
 * Accepts the raw JSON object returned by the proposal-writer agent and
 * normalises it into the exact shape expected by proposal-template.json.
 *
 * Rules:
 *  - Never produces banned phrases (TBD / N/A / placeholder / etc.)
 *  - Falls back to empty strings / empty arrays rather than sentinel text
 *  - Reads cost figures ONLY from data already supplied — never calculates
 *
 * CHANGELOG
 *  - Added: documentPurposeParagraphs, intendedAudienceParagraphs
 *  - Added: assumptionsConstraintsParagraphs, assumptionsBullets, constraintsBullets
 *  - Added: integrationFlowsParagraphs
 *  - Added: dataFlowDiagramLines, deploymentDiagramLines,
 *           processFlowchartLines, sequenceDiagramLines
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BANNED = ['tbd', 'n/a', 'to be determined', 'not available', 'placeholder', 'insert here', 'coming soon'];

function hasBanned(str) {
  if (typeof str !== 'string') return false;
  const lower = str.toLowerCase().trim();
  return BANNED.some(b => lower === b);
}

function clean(value, fallback = '') {
  return hasBanned(value) ? fallback : value || fallback;
}

function toStringArray(value, fallback = []) {
  if (Array.isArray(value) && value.length > 0) {
    const filtered = value.map(v => String(v)).filter(v => !hasBanned(v));
    return filtered.length > 0 ? filtered : fallback;
  }
  if (typeof value === 'string' && value.trim() && !hasBanned(value)) {
    return [value.trim()];
  }
  return fallback;
}

function toTableArray(value, fallbackRow) {
  if (Array.isArray(value) && value.length > 0) return value;
  return fallbackRow ? [fallbackRow] : [];
}

function parseVersionNumber(data) {
  if (typeof data._docVersion === 'number' && data._docVersion >= 1) return data._docVersion;
  if (typeof data.documentVersion === 'string') {
    const n = parseInt(data.documentVersion, 10);
    if (!Number.isNaN(n) && n >= 1) return n;
  }
  return 1;
}

function buildVersionHistory(data, docVersionNum, generatedDate, preparedBy) {
  const priorRows = Array.isArray(data._versionHistory) ? data._versionHistory : [];
  const rows = [];

  for (let v = 1; v < docVersionNum; v++) {
    const prior = priorRows.find(r => parseInt(String(r.version).split('.')[0], 10) === v);
    rows.push(
      prior
        ? { version: `${v}.0`, date: prior.date || '—', author: prior.author || 'ECC-SDLC', changes: prior.changes || 'Proposal updated', status: prior.status || 'Approved' }
        : { version: `${v}.0`, date: '—', author: 'ECC-SDLC', changes: 'Prior revision', status: 'Approved' }
    );
  }

  rows.push({
    version: `${docVersionNum}.0`,
    date: generatedDate,
    author: preparedBy,
    changes: docVersionNum === 1 ? 'Initial proposal assembled from SDLC artifacts' : 'Proposal updated from revised artifacts',
    status: 'Draft'
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Team profile normalisation
// ---------------------------------------------------------------------------

function normalizeTeamProfile(tp) {
  return {
    name: clean(tp.name || tp.fullName || ''),
    role: clean(tp.role || tp.title || tp.position || ''),
    yearsExperience: clean(String(tp.yearsExperience || tp.years || tp.experience || '')),
    relevantProjects: clean(Array.isArray(tp.relevantProjects) ? tp.relevantProjects.join('; ') : tp.relevantProjects || tp.projects || '')
  };
}

// ---------------------------------------------------------------------------
// Cost / payment normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a single cost breakdown row.
 *
 * Rate semantics:
 *   - Effort-based rows (Architecture, Senior Dev, Junior Dev) carry a real
 *     hourly rate supplied by the agent — preserved as-is.
 *   - Aggregate/summary rows (Total Effort Cost, Contingency Reserve, Grand Total)
 *     have no meaningful per-hour rate because they are derived values (sums or
 *     percentages). The agent correctly omits rate for these rows.
 *     We render '—' instead of blank so the cell is not visually empty.
 */
function normalizeCostRow(row) {
  const rawRate = row.rate || row.ratePerHour || row.hourlyRate || row.blendedRate || row.rateUSD || '';
  const isSummaryRow = !rawRate || String(rawRate).trim() === '0';
  return {
    item: clean(row.item || row.description || row.lineItem || row.component || row.taskName || ''),
    hours: clean(String(row.hours || row.effort || row.effortHours || row.manHours || row.totalHours || row.estimatedHours || '')),
    rate: isSummaryRow ? '—' : clean(String(rawRate)),
    total: clean(row.total || row.totalCost || row.amount || row.cost || row.lineTotal || row.subtotal || row.totalAmount || '')
  };
}

function normalizePaymentRow(row) {
  return {
    milestone: clean(row.milestone || row.milestoneName || row.name || row.stage || ''),
    deliverable: clean(row.deliverable || row.deliverableTrigger || row.trigger || row.triggerEvent || row.deliverableDescription || row.condition || row.deliverables || ''),
    percentage: clean(String(row.percentage || row.percent || row.pct || row.share || '')),
    amount: clean(row.amount || row.payment || row.value || row.total || row.amountUSD || '')
  };
}

// ---------------------------------------------------------------------------
// Timeline normalisation
// ---------------------------------------------------------------------------

function normalizeTimelineRow(row) {
  const deliverables = row.deliverables || row.deliverableList || row.outputs || row.artifacts || row.keyDeliverables || '';
  const dependencies = row.dependencies || row.prerequisite || row.prereqs || row.dependsOn || row.dependsUpon || '';
  return {
    phase: clean(row.phase || row.phaseName || row.name || ''),
    deliverables: clean(Array.isArray(deliverables) ? deliverables.join('; ') : deliverables),
    duration: clean(String(row.duration || row.durationWeeks || row.weeks || row.timeWeeks || row.durationInWeeks || '')),
    milestonePayment: clean(row.milestonePayment || row.payment || row.milestonePaymentPercent || row.paymentPercent || row.paymentAmount || ''),
    dependencies: clean(Array.isArray(dependencies) ? dependencies.join('; ') : dependencies)
  };
}

// ---------------------------------------------------------------------------
// Compliance matrix normalisation
// ---------------------------------------------------------------------------

function normalizeComplianceRow(row) {
  return {
    controlId: clean(row.controlId || row.controlID || row.id || row.ref || row.referenceId || row.control || row.controlRef || row.clauseId || ''),
    framework: clean(row.framework || row.standard || row.regulation || row.frameworkName || ''),
    requirement: clean(row.requirement || row.requirementText || row.description || row.control || ''),
    evidence: clean(row.evidence || row.evidenceLocation || row.evidenceRef || row.mappedTo || row.traceability || ''),
    status: clean(row.status || row.complianceStatus || 'Compliant')
  };
}

// ---------------------------------------------------------------------------
// Architecture / diagram lines normalisation
// Shared by all five diagram fields (architecture, dataFlow, deployment,
// processFlowchart, sequence).
// ---------------------------------------------------------------------------

function normalizeDiagramLines(value) {
  if (Array.isArray(value) && value.length > 0) return value.map(String);
  if (typeof value === 'string' && value.trim()) return value.split('\n');
  return [];
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

function buildProposalRenderData(rawData) {
  const data = rawData || {};

  const now = new Date();
  const yyyyMmDd = now.toISOString().slice(0, 10);
  const docVersionNum = parseVersionNumber(data);
  const documentVersion = `${docVersionNum}.0`;
  const preparedBy = clean(data.preparedBy, 'ECC-SDLC');
  const projectName = clean(data.projectName, 'Project');
  const clientName = clean(data.clientName, 'Client');
  const currency = clean(data.currency, 'PKR');
  const generatedDate = clean(data.generatedDate, yyyyMmDd);

  return {
    // ── Meta ──────────────────────────────────────────────────────────────
    projectName,
    clientName,
    preparedBy,
    generatedDate,
    documentVersion,
    currency,

    versionHistory: buildVersionHistory(data, docVersionNum, generatedDate, preparedBy),

    // ── Document Purpose & Intended Audience (pre-section headings) ───────
    documentPurposeParagraphs: toStringArray(data.documentPurposeParagraphs),
    intendedAudienceParagraphs: toStringArray(data.intendedAudienceParagraphs),

    // ── Section 1: Executive Summary ──────────────────────────────────────
    executiveSummaryParagraphs: toStringArray(data.executiveSummaryParagraphs),

    // ── Section 2: Understanding of Requirement ───────────────────────────
    understandingOfRequirementParagraphs: toStringArray(data.understandingOfRequirementParagraphs),
    clientObjectivesParagraphs: toStringArray(data.clientObjectivesParagraphs),
    regulatoryContextParagraphs: toStringArray(data.regulatoryContextParagraphs),
    keySuccessCriteriaBullets: toStringArray(data.keySuccessCriteriaBullets),

    // 2.4 Assumptions & Constraints
    assumptionsConstraintsParagraphs: toStringArray(data.assumptionsConstraintsParagraphs),
    assumptionsBullets: toStringArray(data.assumptionsBullets),
    constraintsBullets: toStringArray(data.constraintsBullets),

    // ── Section 3: Proposed Solution ──────────────────────────────────────
    proposedSolutionParagraphs: toStringArray(data.proposedSolutionParagraphs),
    solutionOverviewParagraphs: toStringArray(data.solutionOverviewParagraphs),
    keyFeaturesNumbered: toStringArray(data.keyFeaturesNumbered),
    winThemesParagraphs: toStringArray(data.winThemesParagraphs),

    // ── Section 4: Technical Approach ─────────────────────────────────────
    technicalApproachParagraphs: toStringArray(data.technicalApproachParagraphs),
    systemArchitectureParagraphs: toStringArray(data.systemArchitectureParagraphs),
    technologyStackParagraphs: toStringArray(data.technologyStackParagraphs),
    developmentMethodologyParagraphs: toStringArray(data.developmentMethodologyParagraphs),
    qualityAssuranceParagraphs: toStringArray(data.qualityAssuranceParagraphs),

    // 4.5 Integration Flows (new subsection)
    integrationFlowsParagraphs: toStringArray(data.integrationFlowsParagraphs),

    // Architecture diagram
    architecturePng: data.architecturePng || null,
    architectureDims: data.architectureDims || null,
    architectureDiagramLines: normalizeDiagramLines(data.architectureDiagramLines),

    // All SDS diagrams — loaded from saved PNGs when available (no re-render needed)
    erDiagramPng: data.erDiagramPng || null,
    erDiagramDims: data.erDiagramDims || null,
    sequencePng: data.sequencePng || null,
    sequenceDims: data.sequenceDims || null,
    dataFlowPng: data.dataFlowPng || null,
    dataFlowDims: data.dataFlowDims || null,
    networkPng: data.networkPng || null,
    networkDims: data.networkDims || null,
    flowchartPng: data.flowchartPng || null,
    flowchartDims: data.flowchartDims || null,
    useCasePng: data.useCasePng || null,
    useCaseDims: data.useCaseDims || null,
    useCaseDiagrams: Array.isArray(data.useCaseDiagrams) ? data.useCaseDiagrams : [],
    sequenceDiagrams: Array.isArray(data.sequenceDiagrams) ? data.sequenceDiagrams : [],
    deploymentPng: data.deploymentPng || null,
    deploymentDims: data.deploymentDims || null,

    // ── Section 5: Team Profiles ───────────────────────────────────────────
    teamProfiles: toTableArray(Array.isArray(data.teamProfiles) ? data.teamProfiles.map(normalizeTeamProfile) : null, { name: '', role: '', yearsExperience: '', relevantProjects: '' }),

    // ── Section 6: Project Timeline ───────────────────────────────────────
    projectTimelineParagraphs: toStringArray(data.projectTimelineParagraphs),
    projectTimelineRows: toTableArray(Array.isArray(data.projectTimelineRows) ? data.projectTimelineRows.map(normalizeTimelineRow) : null, {
      phase: '',
      deliverables: '',
      duration: '',
      milestonePayment: '',
      dependencies: ''
    }),

    // ── Section 7: Cost Breakdown ─────────────────────────────────────────
    costBreakdownParagraphs: toStringArray(data.costBreakdownParagraphs),
    costBreakdown: toTableArray(Array.isArray(data.costBreakdown) ? data.costBreakdown.map(normalizeCostRow) : null, { item: '', hours: '', rate: '—', total: '' }),
    paymentSchedule: toTableArray(Array.isArray(data.paymentSchedule) ? data.paymentSchedule.map(normalizePaymentRow) : null, { milestone: '', deliverable: '', percentage: '', amount: '' }),

    // ── Section 8: Compliance Statement ───────────────────────────────────
    complianceStatementParagraphs: toStringArray(data.complianceStatementParagraphs),
    regulatoryFrameworkParagraphs: toStringArray(data.regulatoryFrameworkParagraphs),
    complianceGapsParagraphs: toStringArray(data.complianceGapsParagraphs),
    organizationalCertificationsBullets: toStringArray(data.organizationalCertificationsBullets),
    complianceMatrix: toTableArray(Array.isArray(data.complianceMatrix) ? data.complianceMatrix.map(normalizeComplianceRow) : null, {
      controlId: '',
      framework: '',
      requirement: '',
      evidence: '',
      status: ''
    }),

    // ── Section 9: Appendices ─────────────────────────────────────────────
    appendicesParagraphs: toStringArray(data.appendicesParagraphs),
    companyProfileParagraphs: toStringArray(data.companyProfileParagraphs),
    pastPerformanceBullets: toStringArray(data.pastPerformanceBullets),
    certificationsBullets: toStringArray(data.certificationsBullets),
    keyPersonnelCVsParagraphs: toStringArray(data.keyPersonnelCVsParagraphs),
    technicalSpecificationsBullets: toStringArray(data.technicalSpecificationsBullets)
  };
}

// ---------------------------------------------------------------------------
// Banned-phrase grep helper (used by orchestrator for acceptance test)
// ---------------------------------------------------------------------------

function grepBannedPhrases(renderData) {
  const hits = [];
  const json = JSON.stringify(renderData).toLowerCase();
  for (const phrase of BANNED) {
    if (json.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

module.exports = { buildProposalRenderData, grepBannedPhrases, BANNED };
