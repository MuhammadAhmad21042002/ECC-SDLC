// Computes the mathematically correct estimate output for estimate-fixture.json.
// Run: node tests/sdlc/compute-golden.js
// Writes: tests/sdlc/fixtures/estimate-golden-output.json

'use strict';
const fs = require('fs');
const path = require('path');

// --- FPA reference table (mirrors Section 1 of agents/estimator.md) ---
const FPA_TABLE = {
  EI:  { simple: 3, average: 4,  complex: 6  },
  EO:  { simple: 4, average: 5,  complex: 7  },
  EQ:  { simple: 3, average: 4,  complex: 6  },
  ILF: { simple: 7, average: 10, complex: 15 },
  EIF: { simple: 5, average: 7,  complex: 10 }
};

const FPA_FULL = {
  EI:  'External Input',
  EO:  'External Output',
  EQ:  'External Inquiry',
  ILF: 'Internal Logical File',
  EIF: 'External Interface File',
  UNMAPPABLE: 'UNMAPPABLE'
};

// --- DC type mapping (mirrors Section 2 of agents/estimator.md) ---
const DC_TYPE_MAP = {
  service:     'EO',
  module:      'EI',
  component:   'EI',
  job:         'EI',
  database:    'ILF',
  integration: 'EIF',
  ui:          'EI',
  infra:       'UNMAPPABLE',
  library:     'UNMAPPABLE',
  other:       'UNMAPPABLE'
};

const WRITE_VERBS = ['create','update','delete','submit','insert','patch','post','write','save','remove'];

function getFpaType(component) {
  const t = component.type;
  if (t === 'infra' || t === 'library' || t === 'other') return 'UNMAPPABLE';

  // api and ui require EI/EQ disambiguation
  if (t === 'api' || t === 'ui') {
    const ifaces = component.interfaces || [];
    const resps  = component.responsibilities || [];
    const hasNonDb = ifaces.some(i => i.kind !== 'db');
    const hasWrite = resps.some(r => WRITE_VERBS.some(v => r.toLowerCase().includes(v)));

    // Rule 1: any non-db interface OR write verb → EO (api) or EI (ui)
    if (hasNonDb || hasWrite) return t === 'api' ? 'EO' : 'EI';
    // Rule 2: all interfaces are db AND no write verb → EQ
    if (ifaces.length > 0 && ifaces.every(i => i.kind === 'db') && !hasWrite) return 'EQ';
    // Rule 3: no interfaces, no responsibilities → default
    return t === 'api' ? 'EO' : 'EI';
  }

  return DC_TYPE_MAP[t] || 'UNMAPPABLE';
}

// --- Complexity algorithm (mirrors Section 3 of agents/estimator.md) ---
// Ranges are mutually exclusive: 0-3=simple, 4-7=average, 8+=complex
function getComplexity(component) {
  if (component.complexity) return component.complexity;
  const score = (component.interfaces     || []).length
              + (component.responsibilities || []).length
              + (component.dataStores       || []).length;
  if (score <= 3) return 'simple';
  if (score <= 7) return 'average';
  return 'complex';
}

// --- Hours per FP (mirrors Section 4 of agents/estimator.md) ---
const HOURS_PER_FP = { juniorDev: 12, seniorDev: 8, architect: 6 };

// --- Role allocation defaults (mirrors Section 6 of agents/estimator.md) ---
const ALLOC = { architect: 0.15, seniorDev: 0.60, juniorDev: 0.25 };
const ROLE_LABELS   = { architect: 'Solution Architect', seniorDev: 'Senior Developer', juniorDev: 'Junior Developer' };
const SENIORITY     = { architect: 'principal',          seniorDev: 'senior',           juniorDev: 'junior'           };

// --- Load fixture ---
const fixtureDir  = path.join(__dirname, 'fixtures');
const fixture     = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'estimate-fixture.json'), 'utf8'));
const rateCard    = fixture.rateCard;
const contingencyPct = fixture.contingencyPct != null ? fixture.contingencyPct : null;

// --- Step 3: process each component ---
const effortBreakdown = fixture.designComponents.map(c => {
  const fpaType    = getFpaType(c);
  const complexity = getComplexity(c);
  const fp         = fpaType === 'UNMAPPABLE' ? 0 : FPA_TABLE[fpaType][complexity];
  const role       = (c.assignedRole && HOURS_PER_FP[c.assignedRole]) ? c.assignedRole : 'seniorDev';
  const hoursPerFP = HOURS_PER_FP[role];
  const effortHours = fp * hoursPerFP;

  return {
    componentId:     c.id,
    componentTitle:  c.title,
    componentType:   c.type,
    fpaType,
    fpaTypeFullName: FPA_FULL[fpaType],
    complexity,
    functionPoints:  fp,
    hoursPerFP,
    effortHours,
    phase:           'development',
    requirementIds:  (c.requirementIds || []).join(', '),
    notes: fpaType === 'UNMAPPABLE'
      ? `FLAGGED: DC type '${c.type}' has no FPA equivalent. Manual estimation required for this component.`
      : (role !== 'seniorDev' ? `assignedRole: ${role}` : '')
  };
});

// --- Step 4: totals ---
const totalFunctionPoints = effortBreakdown.reduce((s, r) => s + r.functionPoints, 0);
const totalEffortHours    = effortBreakdown.reduce((s, r) => s + r.effortHours,    0);

// --- Step 5: resource plan ---
const resourcePlan = ['architect', 'seniorDev', 'juniorDev'].map(role => {
  const totalHours  = Math.round(totalEffortHours * ALLOC[role]);
  const storyPoints = Math.ceil(totalHours / 8);
  const hourlyRate  = rateCard[role] ? rateCard[role].hourlyRate : 0;
  const currency    = rateCard[role] ? rateCard[role].currency   : '';
  const totalCost   = totalHours * hourlyRate;
  return {
    role,
    roleLabel:      ROLE_LABELS[role],
    seniorityLevel: SENIORITY[role],
    allocationPct:  ALLOC[role],
    totalHours,
    storyPoints,
    hourlyRate,
    currency,
    totalCost
  };
});

// --- Step 6: cost summary ---
const totalRoleCost = resourcePlan.reduce((s, r) => s + r.totalCost, 0);
const contingencyAmt = contingencyPct != null ? totalRoleCost * (contingencyPct / 100) : 0;
const grandTotal = totalRoleCost + contingencyAmt;
const totalRoleHours = resourcePlan.reduce((s, r) => s + r.totalHours, 0);

const costSummary = [
  ...resourcePlan.map(r => ({
    category:    r.roleLabel,
    description: `${r.roleLabel} effort cost`,
    role:        r.role,
    hours:       r.totalHours,
    hourlyRate:  r.hourlyRate,
    currency:    r.currency,
    subtotal:    r.totalCost
  }))
];
if (contingencyPct != null) {
  costSummary.push({
    category:    'Contingency',
    description: `${contingencyPct}% contingency on total effort cost`,
    role:        '',
    hours:       0,
    hourlyRate:  null,
    currency:    '',
    subtotal:    contingencyAmt
  });
}
costSummary.push({
  category:    'GRAND TOTAL',
  description: 'Total project cost including contingency',
  role:        '',
  hours:       totalRoleHours,
  hourlyRate:  null,
  currency:    'USD',
  subtotal:    grandTotal
});

const unmappableComponents = effortBreakdown
  .filter(r => r.fpaType === 'UNMAPPABLE')
  .map(r => `${r.componentId}: ${r.componentType} has no FPA equivalent. Manual estimation required.`);

const plan = {
  estimatePlan: {
    templatePath:    'templates/estimation-template.json',
    templateId:      'ecc-sdlc.estimation.v1',
    projectId:       fixture.projectId,
    projectName:     fixture.projectName,
    clientName:      fixture.clientName,
    generatedDate:   '2026-03-20',
    documentVersion: '1.0',
    currency:        'USD',
    totalFunctionPoints,
    totalEffortHours,
    totalCost: grandTotal,
    sheets: { effortBreakdown, resourcePlan, costSummary },
    unmappableComponents,
    missingRateCardRoles: [],
    validation: {
      totalFPMatchesBreakdown:      true,
      totalHoursMatchesBreakdown:   true,
      totalCostMatchesResourcePlan: true,
      allComponentsProcessed:       true,
      unmappableCount:              unmappableComponents.length,
      missingRateCardRolesCount:    0
    }
  }
};

const outPath = path.join(fixtureDir, 'estimate-golden-output.json');
fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
console.log('Golden output written to', outPath);
console.log('totalFunctionPoints:', totalFunctionPoints);
console.log('totalEffortHours:   ', totalEffortHours);
console.log('totalCost:          ', grandTotal);
console.log('unmappable:         ', unmappableComponents.length);

// Print breakdown for manual verification
effortBreakdown.forEach(r => {
  console.log(`  ${r.componentId} (${r.componentType}/${r.complexity}) -> ${r.fpaType} = ${r.functionPoints} FP x ${r.hoursPerFP}h = ${r.effortHours}h`);
});
resourcePlan.forEach(r => {
  console.log(`  ${r.role}: ${r.totalHours}h x $${r.hourlyRate} = $${r.totalCost}`);
});
