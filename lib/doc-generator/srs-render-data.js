'use strict';

function toStringArray(value, fallback = 'TBD') {
  if (Array.isArray(value) && value.length > 0) return value.map(v => String(v));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [fallback];
}

function toTableArray(value, fallbackRow) {
  if (Array.isArray(value) && value.length > 0) return value;
  return [fallbackRow];
}

function parseVersionNumber(srsData) {
  if (typeof srsData._docVersion === 'number' && srsData._docVersion >= 1) {
    return srsData._docVersion;
  }
  if (typeof srsData.documentVersion === 'string') {
    const n = parseInt(srsData.documentVersion, 10);
    if (!Number.isNaN(n) && n >= 1) return n;
  }
  return 1;
}

function buildVersionHistory(srsData, docVersionNum, generatedDate, preparedBy) {
  const priorRows = Array.isArray(srsData._versionHistory) ? srsData._versionHistory : [];
  const rows = [];

  for (let v = 1; v < docVersionNum; v++) {
    const prior = priorRows.find(r => parseInt(String(r.version).split('.')[0], 10) === v);
    if (prior) {
      rows.push({
        version: `${v}.0`,
        date: prior.date || '—',
        author: prior.author || 'ECC-SDLC',
        changes: prior.changes || 'SRS updated',
        status: prior.status || 'Approved'
      });
    } else {
      rows.push({
        version: `${v}.0`,
        date: '—',
        author: 'ECC-SDLC',
        changes: 'Prior revision',
        status: 'Approved'
      });
    }
  }

  rows.push({
    version: `${docVersionNum}.0`,
    date: generatedDate,
    author: preparedBy,
    changes: docVersionNum === 1 ? 'Initial SRS extracted from validated requirements' : 'SRS updated from revised requirements',
    status: 'Draft'
  });

  return rows;
}

function byReqId(a, b) {
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function normalizeReq(req) {
  return {
    id: req.id || 'REQ-FUNC-000',
    type: req.type || 'functional',
    category: req.category || '',
    title: req.title || 'TBD',
    priority: req.priority || 'should',
    description: req.description || 'TBD',
    acceptanceCriteria: Array.isArray(req.acceptanceCriteria) && req.acceptanceCriteria.length > 0 ? req.acceptanceCriteria.map(v => String(v)) : ['TBD'],
    status: req.status || 'draft',
    source: req.source || 'TBD',
    dependencies: Array.isArray(req.dependencies) && req.dependencies.length > 0 ? req.dependencies : ['N/A'],
    complianceFrameworks: Array.isArray(req.complianceFrameworks) && req.complianceFrameworks.length > 0 ? req.complianceFrameworks : ['N/A'],
    rationale: req.rationale || ''
  };
}

/**
 * Normalize a userClass row to the exact keys the template expects.
 * The technical writer may use different key names — we handle all common variants.
 *
 * Template expects: { role, description, accessLevel, frequency }
 */
function normalizeSystemFeature(f, idx) {
  return {
    sectionNumber: typeof f.sectionNumber === 'number' ? f.sectionNumber : idx + 2, // 4.1 is the intro heading, features start at 4.2
    featureId: f.featureId || f.id || `FEAT-${String(idx + 1).padStart(2, '0')}`,
    name: f.name || f.title || 'TBD',
    descriptionPriority: f.descriptionPriority || f.description || 'TBD',
    stimulusResponse:
      Array.isArray(f.stimulusResponse) && f.stimulusResponse.length > 0
        ? f.stimulusResponse.map(String)
        : f.stimulusResponse
          ? [String(f.stimulusResponse)]
          : ['TBD — to be defined during design review'],
    functionalRequirementIds:
      Array.isArray(f.functionalRequirementIds) && f.functionalRequirementIds.length > 0
        ? f.functionalRequirementIds
        : Array.isArray(f.requirementIds) && f.requirementIds.length > 0
          ? f.requirementIds
          : ['N/A'],
    useCaseIds: Array.isArray(f.useCaseIds) && f.useCaseIds.length > 0 ? f.useCaseIds : ['N/A'],
    primaryActors: Array.isArray(f.primaryActors) && f.primaryActors.length > 0 ? f.primaryActors : f.primaryActor ? [f.primaryActor] : ['N/A'],
    preconditions: Array.isArray(f.preconditions) && f.preconditions.length > 0 ? f.preconditions : ['N/A'],
    postconditions: Array.isArray(f.postconditions) && f.postconditions.length > 0 ? f.postconditions : ['N/A'],
    businessRuleIds: Array.isArray(f.businessRuleIds) && f.businessRuleIds.length > 0 ? f.businessRuleIds : ['N/A'],
    notes: f.notes || 'N/A'
  };
}

function normalizeUseCase(uc, idx) {
  return {
    id: uc.id || `UC-${String(idx + 1).padStart(2, '0')}`,
    name: uc.name || uc.title || 'TBD',
    primaryActor: uc.primaryActor || 'N/A',
    secondaryActors: Array.isArray(uc.secondaryActors) && uc.secondaryActors.length > 0 ? uc.secondaryActors : ['N/A'],
    stakeholders: Array.isArray(uc.stakeholders) && uc.stakeholders.length > 0 ? uc.stakeholders : ['N/A'],
    preconditions: Array.isArray(uc.preconditions) && uc.preconditions.length > 0 ? uc.preconditions : ['N/A'],
    trigger: uc.trigger || 'N/A',
    mainFlow: Array.isArray(uc.mainFlow) && uc.mainFlow.length > 0 ? uc.mainFlow : Array.isArray(uc.mainSuccessScenario) && uc.mainSuccessScenario.length > 0 ? uc.mainSuccessScenario : ['N/A'],
    alternateFlows: Array.isArray(uc.alternateFlows) && uc.alternateFlows.length > 0 ? uc.alternateFlows : ['N/A'],
    exceptionFlows: Array.isArray(uc.exceptionFlows) && uc.exceptionFlows.length > 0 ? uc.exceptionFlows : ['N/A'],
    postconditions: Array.isArray(uc.postconditions) && uc.postconditions.length > 0 ? uc.postconditions : ['N/A'],
    requirementIds: Array.isArray(uc.requirementIds) && uc.requirementIds.length > 0 ? uc.requirementIds : ['N/A'],
    featureId: uc.featureId || 'N/A'
  };
}

function normalizeBusinessRule(br, idx) {
  return {
    id: br.id || `BR-${String(idx + 1).padStart(2, '0')}`,
    statement: br.statement || br.description || 'TBD',
    enforcedBy: br.enforcedBy || 'TBD',
    references: Array.isArray(br.references) ? br.references.join(', ') : br.references || ''
  };
}

function normalizeTbdItem(t, idx) {
  return {
    id: t.id || `TBD-${String(idx + 1).padStart(2, '0')}`,
    description: t.description || 'TBD',
    owner: t.owner || 'TBD',
    deadline: t.deadline || 'TBD',
    references: Array.isArray(t.references) ? t.references.join(', ') : t.references || ''
  };
}

function normalizeUserClass(uc) {
  return {
    role: uc.role || uc.userRole || uc.name || uc.userClass || 'TBD',
    description: uc.description || uc.desc || 'TBD',
    accessLevel: uc.accessLevel || uc.access || uc.accessLevelDescription || uc.permissions || 'TBD',
    frequency: uc.frequency || uc.usageFrequency || uc.accessFrequency || uc.usagePattern || 'TBD'
  };
}

/**
 * Resolve a field from srsData handling both flat and nested shapes.
 *
 * The technical writer may output either:
 *   Shape A (flat):   { purposeParagraphs: [...] }
 *   Shape B (nested): { introduction: { purpose: "..." } }
 *
 * We check the flat key first, then fall back to the nested path.
 */
function resolve(srsData, flatKey, ...nestedPath) {
  if (srsData[flatKey] !== undefined && srsData[flatKey] !== null) {
    return srsData[flatKey];
  }
  let current = srsData;
  for (const key of nestedPath) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function buildSrsRenderData(srsData) {
  const now = new Date();
  const yyyyMmDd = now.toISOString().slice(0, 10);
  const docVersionNum = parseVersionNumber(srsData || {});
  const documentVersion = `${docVersionNum}.0`;
  const preparedBy = typeof srsData.preparedBy === 'string' && srsData.preparedBy.trim() ? srsData.preparedBy.trim() : 'ECC-SDLC';

  const allRequirements = Array.isArray(srsData.requirements) ? srsData.requirements.map(normalizeReq).sort(byReqId) : [];

  const functionalRequirements = Array.isArray(srsData.functionalRequirements) ? srsData.functionalRequirements.map(normalizeReq).sort(byReqId) : allRequirements.filter(r => r.type === 'functional');

  const nonFunctionalRequirements = Array.isArray(srsData.nonFunctionalRequirements)
    ? srsData.nonFunctionalRequirements.map(normalizeReq).sort(byReqId)
    : allRequirements.filter(r => r.type === 'non-functional');

  // Resolve and normalize userClasses — handles both flat and nested shapes
  // and normalizes key names to match template: role, description, accessLevel, frequency
  const rawUserClasses = resolve(srsData, 'userClasses', 'overallDescription', 'userClasses');
  const normalizedUserClasses = Array.isArray(rawUserClasses) && rawUserClasses.length > 0 ? rawUserClasses.map(normalizeUserClass) : null;

  const data = {
    projectName: 'TBD',
    clientName: 'TBD',
    preparedBy,
    generatedDate: yyyyMmDd,
    documentVersion,
    versionHistory: buildVersionHistory(srsData || {}, docVersionNum, yyyyMmDd, preparedBy),

    purposeParagraphs: toStringArray(resolve(srsData, 'purposeParagraphs', 'introduction', 'purpose')),
    documentConventionsParagraphs: toStringArray(resolve(srsData, 'documentConventionsParagraphs', 'introduction', 'documentConventions')),
    intendedAudienceParagraphs: toStringArray(resolve(srsData, 'intendedAudienceParagraphs', 'introduction', 'intendedAudience')),
    scopeParagraphs: toStringArray(resolve(srsData, 'scopeParagraphs', 'introduction', 'scope')),
    definitionsTable: toTableArray(resolve(srsData, 'definitionsTable', 'introduction', 'definitions'), { term: 'TBD', definition: 'TBD', source: 'TBD' }),
    referencesBullets: toStringArray(resolve(srsData, 'referencesBullets', 'introduction', 'references')),
    overviewParagraphs: toStringArray(resolve(srsData, 'overviewParagraphs', 'introduction', 'overview')),

    productPerspective: toStringArray(resolve(srsData, 'productPerspective', 'overallDescription', 'productPerspective')),
    productFunctionsBullets: toStringArray(resolve(srsData, 'productFunctionsBullets', 'overallDescription', 'productFunctions')),
    userClasses: toTableArray(normalizedUserClasses, { role: 'TBD', description: 'TBD', accessLevel: 'TBD', frequency: 'TBD' }),
    operatingEnvironmentParagraphs: toStringArray(resolve(srsData, 'operatingEnvironmentParagraphs', 'overallDescription', 'operatingEnvironment')),
    constraintsNumbered: toStringArray(resolve(srsData, 'constraintsNumbered', 'overallDescription', 'constraints')),
    userDocumentationParagraphs: toStringArray(resolve(srsData, 'userDocumentationParagraphs', 'overallDescription', 'userDocumentation')),
    assumptionsNumbered: toStringArray(resolve(srsData, 'assumptionsNumbered', 'overallDescription', 'assumptions')),

    userInterfacesParagraphs: toStringArray(resolve(srsData, 'userInterfacesParagraphs', 'externalInterfaces', 'userInterfaces')),
    hardwareInterfacesParagraphs: toStringArray(resolve(srsData, 'hardwareInterfacesParagraphs', 'externalInterfaces', 'hardwareInterfaces')),
    softwareInterfacesParagraphs: toStringArray(resolve(srsData, 'softwareInterfacesParagraphs', 'externalInterfaces', 'softwareInterfaces')),
    communicationsInterfacesParagraphs: toStringArray(resolve(srsData, 'communicationsInterfacesParagraphs', 'externalInterfaces', 'communicationsInterfaces')),

    systemFeaturesIntroParagraphs: toStringArray(
      resolve(srsData, 'systemFeaturesIntroParagraphs', 'systemFeatures', 'introduction'),
      'This section organises the functional capabilities of the system into cohesive features. Each feature block below describes the feature, its priority, the stimulus-response sequences that define expected user-system interactions, and the individual functional requirements that together implement the feature.'
    ),
    systemFeatures:
      Array.isArray(srsData.systemFeatures) && srsData.systemFeatures.length > 0 ? srsData.systemFeatures.map((f, i) => normalizeSystemFeature(f, i)) : [normalizeSystemFeature({ name: 'TBD' }, 0)],
    useCases: Array.isArray(srsData.useCases) && srsData.useCases.length > 0 ? srsData.useCases.map((u, i) => normalizeUseCase(u, i)) : [normalizeUseCase({ id: 'UC-01', name: 'TBD' }, 0)],

    functionalRequirements: functionalRequirements.length > 0 ? functionalRequirements : [normalizeReq({})],
    nonFunctionalRequirements: nonFunctionalRequirements.length > 0 ? nonFunctionalRequirements : [normalizeReq({ type: 'non-functional', category: 'performance' })],
    nonFunctionalRequirementsIntroParagraphs: toStringArray(
      resolve(srsData, 'nonFunctionalRequirementsIntroParagraphs', 'nonFunctionalRequirements', 'introduction'),
      'The following non-functional requirements describe the qualities of the system that govern how functions are delivered, rather than which functions are delivered. They are grouped by category and shall be satisfied across the entire system.'
    ),
    performanceParagraphs: toStringArray(resolve(srsData, 'performanceParagraphs', 'softwareAttributes', 'performance')),
    safetyParagraphs: toStringArray(resolve(srsData, 'safetyParagraphs', 'softwareAttributes', 'safety')),
    usabilityParagraphs: toStringArray(resolve(srsData, 'usabilityParagraphs', 'softwareAttributes', 'usability')),
    interoperabilityParagraphs: toStringArray(resolve(srsData, 'interoperabilityParagraphs', 'softwareAttributes', 'interoperability')),
    businessRules:
      Array.isArray(srsData.businessRules) && srsData.businessRules.length > 0
        ? srsData.businessRules.map((b, i) => normalizeBusinessRule(b, i))
        : [normalizeBusinessRule({ id: 'BR-01', statement: 'TBD' }, 0)],
    glossaryParagraphs: toStringArray(resolve(srsData, 'glossaryParagraphs', 'appendix', 'glossary')),
    analysisModelsIntroParagraphs: toStringArray(
      resolve(srsData, 'analysisModelsIntroParagraphs', 'appendix', 'analysisModelsIntro'),
      'This appendix provides analysis models referenced throughout the SRS, including use case diagrams, entity-relationship diagrams, state transition diagrams, data flow diagrams, and key sequence diagrams. All diagrams are expressed in Mermaid syntax and render natively in compatible Markdown and Word environments.'
    ),
    useCaseDiagramMermaid:
      Array.isArray(srsData.useCaseDiagramMermaid) && srsData.useCaseDiagramMermaid.length > 0
        ? srsData.useCaseDiagramMermaid.map(String)
        : ['graph LR', '  %% Use case diagram to be completed during design review'],
    erDiagramMermaid:
      Array.isArray(srsData.erDiagramMermaid) && srsData.erDiagramMermaid.length > 0
        ? srsData.erDiagramMermaid.map(String)
        : ['erDiagram', '  %% Entity-relationship diagram to be completed during design review'],
    stateDiagramMermaid:
      Array.isArray(srsData.stateDiagramMermaid) && srsData.stateDiagramMermaid.length > 0
        ? srsData.stateDiagramMermaid.map(String)
        : ['stateDiagram-v2', '  %% State transitions to be completed during design review'],
    dataFlowDiagramMermaid:
      Array.isArray(srsData.dataFlowDiagramMermaid) && srsData.dataFlowDiagramMermaid.length > 0
        ? srsData.dataFlowDiagramMermaid.map(String)
        : ['flowchart TD', '  %% DFD Level-1 to be completed during design review'],
    sequenceDiagramsMermaid:
      Array.isArray(srsData.sequenceDiagramsMermaid) && srsData.sequenceDiagramsMermaid.length > 0
        ? srsData.sequenceDiagramsMermaid.map(String)
        : ['sequenceDiagram', '  %% Authentication and core sequences to be completed during design review'],
    tbdList:
      Array.isArray(srsData.tbdList) && srsData.tbdList.length > 0
        ? srsData.tbdList.map((t, i) => normalizeTbdItem(t, i))
        : [normalizeTbdItem({ id: 'TBD-01', description: 'No open TBD items at this revision.', owner: '—', deadline: '—' }, 0)],

    designConstraintsParagraphs: toStringArray(resolve(srsData, 'designConstraintsParagraphs', 'softwareAttributes', 'designConstraints')),
    logicalDatabaseParagraphs: toStringArray(resolve(srsData, 'logicalDatabaseParagraphs', 'softwareAttributes', 'logicalDatabase')),
    reliabilityParagraphs: toStringArray(resolve(srsData, 'reliabilityParagraphs', 'softwareAttributes', 'reliability')),
    availabilityParagraphs: toStringArray(resolve(srsData, 'availabilityParagraphs', 'softwareAttributes', 'availability')),
    securityParagraphs: toStringArray(resolve(srsData, 'securityParagraphs', 'softwareAttributes', 'security')),
    maintainabilityParagraphs: toStringArray(resolve(srsData, 'maintainabilityParagraphs', 'softwareAttributes', 'maintainability')),
    portabilityParagraphs: toStringArray(resolve(srsData, 'portabilityParagraphs', 'softwareAttributes', 'portability')),
    otherRequirementsParagraphs: toStringArray(resolve(srsData, 'otherRequirementsParagraphs', 'softwareAttributes', 'otherRequirements')),

    dataModelsParagraphs: toStringArray(resolve(srsData, 'dataModelsParagraphs', 'appendix', 'dataModels')),
    apiContractsParagraphs: toStringArray(resolve(srsData, 'apiContractsParagraphs', 'appendix', 'apiContracts')),
    complianceConsiderationsParagraphs: toStringArray(resolve(srsData, 'complianceConsiderationsParagraphs', 'appendix', 'complianceConsiderations')),
    signOffRows: toTableArray(resolve(srsData, 'signOffRows', 'appendix', 'signOff'), { name: 'TBD', title: 'TBD', signature: 'TBD', date: 'TBD' }),
    indexEntries: toTableArray(resolve(srsData, 'indexEntries', 'appendix', 'index'), { term: 'TBD', location: 'TBD' })
  };

  for (const field of ['projectName', 'clientName', 'generatedDate', 'preparedBy']) {
    if (typeof srsData[field] === 'string' && srsData[field].trim()) {
      data[field] = srsData[field].trim();
    }
  }

  // ── Gantt chart structured tasks (for SVG renderer) + Mermaid source ──────
  if (Array.isArray(srsData.ganttMermaid) && srsData.ganttMermaid.length > 0) {
    data.ganttMermaid = srsData.ganttMermaid.map(String);
  } else {
    data.ganttMermaid = [
      'gantt',
      `    title ${data.projectName} — Project Schedule`,
      '    dateFormat  YYYY-MM-DD',
      '    axisFormat  %b %Y',
      '    section Discovery',
      '    Requirements Gathering     :done,    disc1, 2025-01-01, 30d',
      '    Stakeholder Review         :done,    disc2, after disc1, 14d',
      '    section Requirements',
      '    SRS Drafting               :done,    req1, after disc2, 21d',
      '    SRS Review & Approval      :done,    req2, after req1, 14d',
      '    section Design',
      '    System Architecture (SDS)  :active,  des1, after req2, 28d',
      '    DB Schema & API Design     :         des2, after des1, 14d',
      '    section Development',
      '    Sprint 1 — Core Auth       :         dev1, after des2, 21d',
      '    Sprint 2 — Procurement     :         dev2, after dev1, 21d',
      '    Sprint 3 — Reporting       :         dev3, after dev2, 21d',
      '    Sprint 4 — Integrations    :         dev4, after dev3, 21d',
      '    section Testing',
      '    System Integration Testing :         tst1, after dev4, 21d',
      '    UAT                        :         tst2, after tst1, 14d',
      '    section Deployment',
      '    Production Rollout         :         dep1, after tst2, 14d',
      '    Hypercare Support          :         dep2, after dep1, 30d'
    ];
  }

  // ── ganttTasks[] — structured data for the custom SVG Gantt renderer ──────
  // If caller supplies ganttTasks[], use them. Otherwise build from phase names.
  if (Array.isArray(srsData.ganttTasks) && srsData.ganttTasks.length > 0) {
    data.ganttTasks = srsData.ganttTasks;
  } else {
    // Default SDLC phase tasks matching the Mermaid source above
    data.ganttTasks = [
      { name: 'DISCOVERY', isPhase: true, start: '2025-01-01', end: '2025-02-14' },
      { name: 'Requirements Gathering', done: true, start: '2025-01-01', end: '2025-01-31' },
      { name: 'Stakeholder Review', done: true, start: '2025-02-01', end: '2025-02-14' },
      { name: 'REQUIREMENTS', isPhase: true, start: '2025-02-15', end: '2025-03-28' },
      { name: 'SRS Drafting', done: true, start: '2025-02-15', end: '2025-03-07' },
      { name: 'SRS Review & Approval', done: true, start: '2025-03-08', end: '2025-03-21' },
      { name: 'DESIGN', isPhase: true, start: '2025-03-22', end: '2025-05-19' },
      { name: 'System Architecture (SDS)', active: true, start: '2025-03-22', end: '2025-04-19' },
      { name: 'DB Schema & API Design', done: false, start: '2025-04-20', end: '2025-05-03' },
      { name: 'DEVELOPMENT', isPhase: true, start: '2025-05-04', end: '2025-08-23' },
      { name: 'Sprint 1 — Core Auth', done: false, start: '2025-05-04', end: '2025-05-24' },
      { name: 'Sprint 2 — Procurement', done: false, start: '2025-05-25', end: '2025-06-14' },
      { name: 'Sprint 3 — Reporting', done: false, start: '2025-06-15', end: '2025-07-05' },
      { name: 'Sprint 4 — Integrations', done: false, start: '2025-07-06', end: '2025-07-26' },
      { name: 'TESTING', isPhase: true, start: '2025-07-27', end: '2025-09-06' },
      { name: 'System Integration Testing', done: false, start: '2025-07-27', end: '2025-08-16' },
      { name: 'UAT', done: false, start: '2025-08-17', end: '2025-08-30' },
      { name: 'DEPLOYMENT', isPhase: true, start: '2025-08-31', end: '2025-10-14' },
      { name: 'Production Rollout', done: false, start: '2025-08-31', end: '2025-09-13' },
      { name: 'Hypercare Support', done: false, start: '2025-09-14', end: '2025-10-14' }
    ];
  }

  // Pass-through PNG if the diagram pipeline already rendered it
  data.ganttPng = srsData.ganttPng || null;
  data.ganttDims = srsData.ganttDims || null;

  // ── _tableDefs: column specs for inline tableId rendering in subsections ──
  data._tableDefs = {
    definitionsTable: [
      { key: 'term', label: 'Term', widthPct: 25, format: 'bold' },
      { key: 'definition', label: 'Definition', widthPct: 55 },
      { key: 'source', label: 'Source', widthPct: 20 }
    ],
    userClassesTable: [
      { key: 'role', label: 'User Role', widthPct: 25 },
      { key: 'description', label: 'Description', widthPct: 40 },
      { key: 'accessLevel', label: 'Access Level', widthPct: 20 },
      { key: 'frequency', label: 'Usage Frequency', widthPct: 15 }
    ]
  };

  // ── _tableRows: maps tableId → the data key holding the actual rows ────────
  // 'definitionsTable' → data.definitionsTable  (same key, identity mapping)
  // 'userClassesTable' → data.userClasses        (different key!)
  data._tableRows = {
    definitionsTable: 'definitionsTable',
    userClassesTable: 'userClasses'
  };

  // ── ucDiagramsMap: per-UC-id PNG map injected by srs-doc.js after diagram gen ──
  // Keys = UC id (e.g. 'UC-01'), values = { png: Buffer, dims: {w,h} }
  // srs-doc.js populates this; here we just ensure the key exists.
  data.ucDiagramsMap = srsData.ucDiagramsMap || {};

  return data;
}

module.exports = { buildSrsRenderData };
