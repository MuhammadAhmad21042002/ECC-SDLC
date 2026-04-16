'use strict';

/**
 * scope-render-data.js
 *
 * Maps BA scope JSON → flat render-data for scope-template.json.
 *
 * Version history:
 *   `_docVersion`    (number)  — the version number being generated (e.g. 5)
 *   `_versionHistory` (array) — prior rows passed in by generate-scope-doc.js from state.json
 *     Each entry: { version, date, author, changes }
 *   If _versionHistory is provided, we use those real rows for prior versions and
 *   append the new row for the current version with today's date.
 *   If not provided, prior rows show "—" for dates (graceful fallback).
 *
 * Timeline:
 *   timelineMilestones is set to null when no real timeline is present.
 *   The template section uses renderCondition so it is omitted from the doc.
 */

function buildScopeRenderData(scopeData) {
  const now = new Date();
  const yyyyMmDd = now.toISOString().slice(0, 10);

  // ── Document version number ───────────────────────────────────────────────
  let docVersionNum = 1;
  if (typeof scopeData._docVersion === 'number' && scopeData._docVersion >= 1) {
    docVersionNum = scopeData._docVersion;
  } else if (typeof scopeData.documentVersion === 'string') {
    const parsed = parseInt(scopeData.documentVersion, 10);
    if (!isNaN(parsed) && parsed >= 1) docVersionNum = parsed;
  }
  const documentVersion = `${docVersionNum}.0`;

  // ── Version history table rows ─────────────────────────────────────────────
  // _versionHistory contains real prior rows (version, date, author, changes)
  // passed in by generate-scope-doc.js from state.json artifacts history.
  const priorRows = Array.isArray(scopeData._versionHistory) ? scopeData._versionHistory : [];

  // Build the full history: prior rows + current version row
  const versionHistory = [];

  // Prior versions — use real data if available, fallback to placeholders
  for (let v = 1; v < docVersionNum; v++) {
    const prior = priorRows.find(r => {
      const num = parseInt(String(r.version).split('.')[0], 10);
      return num === v;
    });
    if (prior) {
      versionHistory.push({
        version: `${v}.0`,
        date: prior.date || '—',
        author: prior.author || 'ECC-SDLC',
        changes: prior.changes || 'Scope document updated'
      });
    } else {
      versionHistory.push({
        version: `${v}.0`,
        date: '—',
        author: 'ECC-SDLC',
        changes: 'Prior revision'
      });
    }
  }

  // Current version row
  const preparedBy = typeof scopeData.preparedBy === 'string' && scopeData.preparedBy.trim() ? scopeData.preparedBy.trim() : 'ECC-SDLC';

  versionHistory.push({
    version: `${docVersionNum}.0`,
    date: yyyyMmDd,
    author: preparedBy,
    changes: docVersionNum === 1 ? 'Initial draft — scope extracted from RFP/brief' : 'Scope document regenerated — updated requirements and analysis'
  });

  // ── Timeline — null when not provided ────────────────────────────────────
  // null signals the template's renderCondition to skip the section entirely.
  let timelineMilestones = null;
  if (scopeData.timeline && Array.isArray(scopeData.timeline.milestones) && scopeData.timeline.milestones.length > 0) {
    timelineMilestones = scopeData.timeline.milestones;
  }

  // ── Section arrays ────────────────────────────────────────────────────────
  const projectOverviewParagraphs =
    typeof scopeData.projectOverview === 'string'
      ? scopeData.projectOverview
          .split(/\n\s*\n/)
          .map(s => s.trim())
          .filter(Boolean)
      : ['TBD'];

  const objectivesNumbered = Array.isArray(scopeData.objectives) && scopeData.objectives.length > 0 ? scopeData.objectives : ['TBD'];

  const outOfScopeBullets = Array.isArray(scopeData.outOfScope) && scopeData.outOfScope.length > 0 ? scopeData.outOfScope : ['TBD'];

  const assumptionsBullets = Array.isArray(scopeData.assumptions) && scopeData.assumptions.length > 0 ? scopeData.assumptions : ['TBD'];

  const deliverablesNumbered = Array.isArray(scopeData.deliverables) && scopeData.deliverables.length > 0 ? scopeData.deliverables : ['TBD'];

  // ── Data object ───────────────────────────────────────────────────────────
  const data = {
    projectName: 'TBD',
    clientName: 'TBD',
    preparedBy,
    generatedDate: yyyyMmDd,
    documentVersion,
    versionHistory,

    projectOverviewParagraphs,
    objectivesNumbered,
    inScope: Array.isArray(scopeData.inScope) ? scopeData.inScope : [],
    outOfScopeBullets,
    stakeholders: Array.isArray(scopeData.stakeholders) ? scopeData.stakeholders : [],
    assumptionsBullets,
    constraints: Array.isArray(scopeData.constraints) ? scopeData.constraints : [],
    risks: Array.isArray(scopeData.risks) ? scopeData.risks : [],
    deliverablesNumbered,
    timelineMilestones, // null = section skipped; array = section rendered
    complianceFlags: Array.isArray(scopeData.complianceFlags) ? scopeData.complianceFlags : [],

    // Populated by scope-doc.js after async diagram generation
    systemContextPng: null,
    scopeBoundaryPng: null
  };

  // Explicit string overrides from input
  for (const field of ['projectName', 'clientName', 'generatedDate']) {
    if (typeof scopeData[field] === 'string' && scopeData[field].trim()) {
      data[field] = scopeData[field].trim();
    }
  }

  return data;
}

module.exports = { buildScopeRenderData };
