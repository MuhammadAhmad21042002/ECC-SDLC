'use strict';

/**
 * sds-render-data.js
 *
 * Maps the solution-architect SDS JSON → flat render-data for sds-template.json.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DIAGRAM DERIVATION — WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The solution-architect agent produces rich textual data:
 *   architectureDiagramMermaid  → Mermaid flowchart (used for Tier 1 PNG)
 *   databaseErDiagramMermaid    → Mermaid erDiagram (used for Tier 1 PNG)
 *   databaseTables[]            → table name + fields text + relationships text
 *   designComponents[]          → DC-* rows with responsibility, type, REQ links
 *   apiEndpoints[]              → method, path, description
 *
 * But the rendering pipeline also needs structured diagram OBJECTS for Tier 2
 * custom SVG rendering (used when Mermaid PNG fails or for diagram types the
 * agent doesn't produce Mermaid for):
 *   architectureDiagram  { layers: [{ name, services[] }] }
 *   databaseErDiagram    { entities: [{ name, fields: [{ name, type, pk, fk }] }], relations[] }
 *   dataFlowDiagram      { actors[], steps[] }
 *   networkDiagram       { zones[], connections[] }
 *   useCaseDiagrams[]    [ { title, actors[], useCases[], associations[] }, ... ]  — one per domain
 *   flowchartDiagram     { nodes[], edges[] }
 *
 * This file AUTO-DERIVES every structured diagram object from the agent's
 * textual data, so the document always has real project-specific content —
 * never generic placeholder defaults.
 *
 * If the agent explicitly provides any structured object, it wins over auto-derivation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toParas(val) {
  if (Array.isArray(val)) return val.length > 0 ? val : ['(not provided)'];
  if (typeof val === 'string' && val.trim()) return val.split('\n');
  return ['(not provided)'];
}

function toLines(val) {
  if (Array.isArray(val) && val.length > 0) return val;
  if (typeof val === 'string' && val.trim()) return val.split('\n');
  return ['(no diagram source provided)'];
}

function pickDiagram(sdsData, key) {
  const val = sdsData[key];
  return val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0 ? val : null;
}

function truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

// ---------------------------------------------------------------------------
// DERIVE ARCHITECTURE DIAGRAM
// Groups designComponents[] into named layers by type/keyword.
// ---------------------------------------------------------------------------

const ARCH_LAYERS = [
  { label: 'Security Layer', keywords: ['auth', 'security', 'audit', 'compliance', 'workflow', 'permission', 'access', 'mfa', 'sso', 'encryption'] },
  {
    label: 'Core Banking Layer',
    keywords: [
      'deposit',
      'account',
      'loan',
      'general ledger',
      'gl ',
      'islamic',
      'trade',
      'aml',
      'kyc',
      'risk',
      'customer',
      'cif',
      'teller',
      'cash',
      'forex',
      'reconcili',
      'card',
      'atm',
      'pos',
      'credit',
      'financ',
      'letter of credit',
      'offline',
      'branch'
    ]
  },
  { label: 'Digital Channels', keywords: ['digital', 'internet banking', 'mobile banking', 'channel', 'portal', 'self-service'] },
  { label: 'Integration Layer', keywords: ['integrat', 'esb', 'api gateway', 'swift', 'nift', 'rtgs', 'nadra', 'external', 'gateway', 'message bus'] },
  { label: 'Support Services', keywords: ['migrat', 'training', 'support', 'report', 'batch', 'job', 'scheduler', 'notification', 'email', 'sms'] },
  { label: 'Infrastructure Layer', keywords: ['infra', 'platform', 'database', 'cache', 'storage', 'ha ', 'dr ', 'disaster', 'replication', 'backup', 'monitoring'] }
];

function deriveArchitectureDiagram(sdsData) {
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];
  if (dcs.length === 0) return null;

  const layers = ARCH_LAYERS.map(l => ({ name: l.label, services: [] }));
  const other = { name: 'Other Components', services: [] };

  dcs.forEach(dc => {
    const id = String(dc.id || '');
    const name = String(dc.name || dc.title || '');
    const resp = (String(dc.responsibility || dc.description || '') + ' ' + name).toLowerCase();
    const label = truncate(name, 32);
    const svc = id ? `${id}: ${label}` : label;

    let placed = false;
    for (let i = 0; i < ARCH_LAYERS.length; i++) {
      if (ARCH_LAYERS[i].keywords.some(kw => resp.includes(kw))) {
        layers[i].services.push(svc);
        placed = true;
        break;
      }
    }
    if (!placed) other.services.push(svc);
  });

  if (other.services.length > 0) layers.push(other);
  const filled = layers.filter(l => l.services.length > 0);

  return { title: `${sdsData.projectName || 'System'} — System Architecture`, layers: filled };
}

// ---------------------------------------------------------------------------
// DERIVE ER DIAGRAM
// Parses databaseTables[].fields text + primaryKey text → entity field arrays.
// Extracts relationships from databaseErDiagramMermaid lines.
// Marks FK fields by matching field names to referenced table names.
// ---------------------------------------------------------------------------

function inferFieldType(name, pkName) {
  const n = name.toLowerCase();
  if (n === pkName) return 'UUID';
  if (n.endsWith('_id') || n === 'id') return 'UUID';
  if (n.endsWith('_at') || n.endsWith('_date') || n.includes('date') || n.includes('timestamp')) return 'Date';
  if (n.startsWith('amount') || n.startsWith('balance') || n.startsWith('total') || n.includes('_amount') || n.includes('_balance') || n.includes('rate') || n.includes('price')) return 'Decimal';
  if (n.startsWith('is_') || n.startsWith('has_') || n.endsWith('_enabled') || n.endsWith('_flag') || n === 'active' || n === 'status') return 'Boolean';
  if (n.endsWith('_hash') || n.endsWith('_key') || n.endsWith('_token') || n.endsWith('_xml') || n.endsWith('_json') || n.includes('content')) return 'Text';
  if (n.includes('number') || n.includes('count') || n.includes('_no')) return 'Integer';
  return 'String';
}

function parseEntityFields(fieldsText, primaryKeyText) {
  const pkRaw = String(primaryKeyText || '').match(/^(\w+)/);
  const pkName = pkRaw ? pkRaw[1].toLowerCase() : 'id';
  const pkType = String(primaryKeyText || '').includes('BIGINT') ? 'BigInt' : String(primaryKeyText || '').includes('VARCHAR') ? 'String' : 'UUID';

  const fields = [{ name: pkName, type: pkType, pk: true, fk: false }];

  if (!fieldsText || typeof fieldsText !== 'string') return fields;

  fieldsText
    .replace(/\n/g, ',')
    .split(',')
    .forEach(raw => {
      // Strip parenthetical hints like "(FK)" or "(UUID)"
      const clean = raw
        .replace(/\s*\([^)]*\)/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .toLowerCase();
      if (!clean || clean === pkName || clean.length < 2) return;
      fields.push({ name: clean, type: inferFieldType(clean, pkName), pk: false, fk: false });
    });

  return fields;
}

function extractErRelations(mermaidLines) {
  const relations = [];
  (Array.isArray(mermaidLines) ? mermaidLines : []).forEach(line => {
    const m = String(line)
      .trim()
      .match(/^(\w+)\s+([|o<>{}*+\-]{2,})\s+(\w+)\s*:\s*["']?([^"'\n]+)["']?/);
    if (!m) return;
    const [, from, rel, to, label] = m;
    let cardinality = '1:N';
    if (rel.includes('||') && rel.endsWith('||')) cardinality = '1:1';
    else if (rel.includes('*') || rel.includes('}{')) cardinality = 'N:M';
    relations.push({ from: from.toUpperCase(), to: to.toUpperCase(), label: label.trim(), cardinality });
  });
  return relations;
}

function markFks(entities, relations) {
  relations.forEach(rel => {
    // On a 1:N the "to" (many) side has the FK
    const childName = rel.cardinality === 'N:M' ? null : rel.to;
    if (!childName) return;
    const ent = entities.find(e => e.name === childName);
    if (!ent) return;
    const parentBase = rel.from.toLowerCase().replace(/_cif$|s$/, '');
    ent.fields.forEach(f => {
      if (!f.pk && (f.name.endsWith('_id') || f.name.endsWith('_number') || f.name.endsWith('_code') || f.name.endsWith('_ref'))) {
        const base = f.name.replace(/_(id|number|code|ref)$/, '');
        if (base === rel.from.toLowerCase() || base === parentBase || base.includes(parentBase)) {
          f.fk = true;
        }
      }
    });
  });
}

function deriveDatabaseErDiagram(sdsData) {
  const tables = Array.isArray(sdsData.databaseTables) ? sdsData.databaseTables : [];
  if (tables.length === 0) return null;

  // Start with agent-written Mermaid relation lines
  const mermaidRelations = extractErRelations(sdsData.databaseErDiagramMermaid);

  // Build a set of known entity names for FK validation
  const entityNames = new Set(tables.map(t => String(t.table || '').toUpperCase()));

  // Infer additional FK relations from databaseTables[].relationships text
  // e.g. "1:N accounts, N:M roles" on the USERS row → USERS→ACCOUNTS (1:N), USERS→ROLES (N:M)
  const inferredRelations = [];
  const existingRelKeys = new Set(mermaidRelations.map(r => `${r.from}|${r.to}`));

  tables.forEach(t => {
    const fromName = String(t.table || '').toUpperCase();
    const relText = String(t.relationships || '');
    if (!relText || relText.toLowerCase().includes('independent')) return;

    // Match patterns: "1:N accounts", "N:1 customer_cif", "N:M roles"
    const matches = [...relText.matchAll(/([NnMm1*]:[NnMm1*])\s+([a-z_]+)/gi)];
    matches.forEach(m => {
      const card = m[1].toUpperCase();
      const toName = m[2].toUpperCase();
      if (!entityNames.has(toName)) return;
      // For "N:1": current table has FK pointing to the referenced table (parent→child reversed)
      const relFrom = card === 'N:1' ? toName : fromName;
      const relTo = card === 'N:1' ? fromName : toName;
      const normalCard = card === 'N:1' ? '1:N' : card;
      const key = `${relFrom}|${relTo}`;
      if (!existingRelKeys.has(key)) {
        existingRelKeys.add(key);
        inferredRelations.push({ from: relFrom, to: relTo, label: card, cardinality: normalCard });
      }
    });
  });

  const relations = [...mermaidRelations, ...inferredRelations];
  const entities = tables.map(t => ({
    name: String(t.table || '')
      .replace(/\s+/g, '_')
      .toUpperCase(),
    fields: parseEntityFields(t.fields, t.primaryKey)
  }));
  markFks(entities, relations);

  return {
    title: `${sdsData.projectName || 'System'} — Entity Relationship Diagram`,
    entities,
    relations
  };
}
// ---------------------------------------------------------------------------
// DERIVE DATA FLOW DIAGRAM
// Builds a swimlane sequence diagram from apiEndpoints[] + designComponents[].
// Shows auth → business logic → database → audit trail flow.
// ---------------------------------------------------------------------------

function findDcByKeywords(dcs, ...keywords) {
  return dcs.find(dc => {
    const text = (String(dc.name || dc.title || '') + ' ' + String(dc.responsibility || dc.description || '')).toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

function deriveDataFlowDiagram(sdsData) {
  const eps = Array.isArray(sdsData.apiEndpoints) ? sdsData.apiEndpoints : [];
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];
  if (eps.length === 0 && dcs.length === 0) return null;

  // Resolve actor names from actual DCs
  const gwDc = findDcByKeywords(dcs, 'gateway', 'api gateway', 'esb');
  const authDc = findDcByKeywords(dcs, 'auth', 'security', 'access control', 'sso');
  const coreDc = findDcByKeywords(dcs, 'deposit', 'account', 'teller', 'core banking', 'general banking');
  const auditDc = findDcByKeywords(dcs, 'audit', 'compliance log', 'audit trail');
  const wfDc = findDcByKeywords(dcs, 'workflow', 'authorization', 'maker', 'checker');

  // Shorten DC names to fit swimlane headers — prefer last 2 meaningful words
  function actorLabel(dc, fallback) {
    if (!dc) return fallback;
    const name = String(dc.name || dc.title || fallback);
    // Strip common prefixes: "Security and Authentication Service" → "Auth Service"
    const stripped = name
      .replace(/^(Security and |Authorization and |Conventional |General |Islamic |AML\/KYC |Digital |Integration |Infrastructure )/i, '')
      .replace(/\s+(Service|Module|Engine|System|Layer|Gateway|Platform)$/i, ' $1');
    return truncate(stripped, 20);
  }

  const gwName = actorLabel(gwDc, 'API Gateway');
  const authName = actorLabel(authDc, 'Auth Service');
  const coreName = actorLabel(coreDc, 'Core Service');
  const auditName = actorLabel(auditDc, 'Audit Service');
  const wfName = actorLabel(wfDc, 'Workflow Engine');

  // Cap at 6 actors — more than 6 makes the swimlane too wide to read on A4
  const actors = ['Client', gwName, authName, coreName, 'Database', auditName];

  // Build steps for first 4 endpoints (each contributes ~9 steps → 36 total, readable)
  // Sample 2 endpoints max — each contributes ~9 steps so 2 = 18 steps total
  const sample = eps.slice(0, 2);
  const steps = [];
  let seq = 1;

  if (sample.length === 0) {
    // Minimal default if no endpoints
    steps.push({ from: 'Client', to: gwName, message: 'HTTP Request', sequence: seq++, type: 'sync' });
    steps.push({ from: gwName, to: authName, message: 'Verify token', sequence: seq++, type: 'sync' });
    steps.push({ from: authName, to: gwName, message: 'Token valid', sequence: seq++, type: 'return' });
    steps.push({ from: gwName, to: coreName, message: 'Process request', sequence: seq++, type: 'sync' });
    steps.push({ from: coreName, to: 'Database', message: 'Query / write', sequence: seq++, type: 'sync' });
    steps.push({ from: 'Database', to: coreName, message: 'Result', sequence: seq++, type: 'return' });
    steps.push({ from: coreName, to: auditName, message: 'Log event', sequence: seq++, type: 'async' });
    steps.push({ from: coreName, to: gwName, message: 'Response data', sequence: seq++, type: 'return' });
    steps.push({ from: gwName, to: 'Client', message: '200 OK', sequence: seq++, type: 'return' });
  } else {
    sample.forEach(ep => {
      const path = truncate(ep.path || '/api/...', 32);
      const desc = truncate(ep.description || 'Process request', 40);
      steps.push({ from: 'Client', to: gwName, message: `${ep.method || 'POST'} ${path}`, sequence: seq++, type: 'sync' });
      steps.push({ from: gwName, to: authName, message: 'Validate JWT token', sequence: seq++, type: 'sync' });
      steps.push({ from: authName, to: gwName, message: 'Token valid + permissions', sequence: seq++, type: 'return' });
      steps.push({ from: gwName, to: wfName, message: 'Check maker-checker required', sequence: seq++, type: 'sync' });
      steps.push({ from: wfName, to: coreName, message: desc, sequence: seq++, type: 'sync' });
      steps.push({ from: coreName, to: 'Database', message: 'Read / write data', sequence: seq++, type: 'sync' });
      steps.push({ from: 'Database', to: coreName, message: 'Result set', sequence: seq++, type: 'return' });
      steps.push({ from: coreName, to: auditName, message: 'Immutable audit entry', sequence: seq++, type: 'async' });
      steps.push({ from: coreName, to: 'Client', message: '200 OK + response body', sequence: seq++, type: 'return' });
    });
  }

  return { title: `${sdsData.projectName || 'System'} — Data Flow (API Request Lifecycle)`, actors, steps: steps.slice(0, 18) };
}

// ---------------------------------------------------------------------------
// DERIVE SEQUENCE DIAGRAMS — one per major feature group
//
// Each sequence diagram shows the UML interaction for one feature:
//   participants = actors + key DCs involved in that feature
//   messages = numbered steps: request → auth → process → db → audit → response
//
// Groups apiEndpoints by domain/module, produces one diagram per group
// (max 6 groups × max 10 messages = readable diagrams matching the user's example)
// ---------------------------------------------------------------------------

const SEQ_GROUPS = [
  { name: 'Authentication & Session Management', keywords: ['auth', 'login', 'logout', 'mfa', 'sso', 'session', 'password', 'token', 'lock'] },
  { name: 'Customer & Account Operations', keywords: ['cif', 'customer', 'account', 'open', 'block', 'dormant', 'signature', 'kyc', 'nadra'] },
  { name: 'Transactions & Teller Operations', keywords: ['teller', 'cash', 'transaction', 'transfer', 'forex', 'po', 'dd', 'cheque', 'instrument', 'pay'] },
  { name: 'Workflow & Maker-Checker Approval', keywords: ['workflow', 'submit', 'approve', 'reject', 'maker', 'checker', 'pending', 'authorize'] },
  { name: 'Islamic Banking Operations', keywords: ['islamic', 'murabaha', 'pool', 'profit', 'shariah', 'sukuk', 'financing', 'musharaka'] },
  { name: 'Compliance, AML & Reporting', keywords: ['aml', 'kyc', 'str', 'alert', 'report', 'compliance', 'goaml', 'fatca', 'sanction', 'gl', 'ledger', 'recon'] }
];

function deriveSequenceDiagrams(sdsData) {
  const eps = Array.isArray(sdsData.apiEndpoints) ? sdsData.apiEndpoints : [];
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];
  if (eps.length === 0) return null;

  // Helper: find a DC by keyword in its name/responsibility
  function findDc(...kws) {
    return dcs.find(dc => {
      const t = (String(dc.name || dc.title || '') + ' ' + String(dc.responsibility || dc.description || '')).toLowerCase();
      return kws.some(kw => t.includes(kw));
    });
  }

  // Get short participant label from DC — strip common suffixes
  function dcLabel(dc, fallback) {
    if (!dc) return fallback;
    return String(dc.name || dc.title || fallback)
      .replace(/^(Security and |Authorization and |Conventional |General |Islamic |AML\/KYC )/i, '')
      .replace(/\s+(Service|Module|Engine|System|Gateway)$/i, ' $1')
      .slice(0, 20);
  }

  // Assign endpoints to groups
  const buckets = SEQ_GROUPS.map(g => ({ ...g, eps: [] }));
  const spill = { name: 'General Operations', keywords: ['general', 'operations'], eps: [] };

  eps.forEach(ep => {
    const text = (String(ep.path || '') + ' ' + String(ep.description || '')).toLowerCase();
    let placed = false;
    for (const bucket of buckets) {
      if (bucket.keywords.some(kw => text.includes(kw))) {
        bucket.eps.push(ep);
        placed = true;
        break;
      }
    }
    if (!placed) spill.eps.push(ep);
  });
  if (spill.eps.length > 0) buckets.push(spill);

  const diagrams = [];

  buckets.forEach(bucket => {
    if (bucket.eps.length === 0) return;

    // Pick relevant DCs for participants in this group
    const authDc = findDc('auth', 'security', 'access control');
    const wfDc = findDc('workflow', 'authorization engine', 'maker');
    const auditDc = findDc('audit', 'compliance log');

    // Find the most relevant domain DC for this group
    const domainKws = bucket.keywords.slice(0, 3);
    const domainDc =
      dcs.find(dc => {
        const t = (String(dc.name || dc.title || '') + ' ' + String(dc.responsibility || dc.description || '')).toLowerCase();
        return domainKws.some(kw => t.includes(kw));
      }) ||
      dcs.find(dc => dc.type === 'module') ||
      dcs[0];

    // Build participant list: User, Auth, Workflow (if relevant), DomainService, DB, Audit
    // Avoid duplicates — wfDc and domainDc may be the same component
    const participants = [{ id: 'user', label: 'User / Teller' }];
    if (authDc) participants.push({ id: 'auth', label: dcLabel(authDc, 'Auth Service') });
    const needsWf = wfDc && bucket.keywords.some(kw => ['workflow', 'approve', 'submit', 'maker'].includes(kw));
    if (needsWf) participants.push({ id: 'wf', label: dcLabel(wfDc, 'Workflow Engine') });
    // Only add domainDc if it's different from auth and wf
    const domainIsDuplicate = domainDc === authDc || (needsWf && domainDc === wfDc);
    if (domainDc && !domainIsDuplicate) participants.push({ id: 'domain', label: dcLabel(domainDc, 'Core Service') });
    participants.push({ id: 'db', label: 'Database' });
    if (auditDc && auditDc !== authDc && auditDc !== domainDc) participants.push({ id: 'audit', label: dcLabel(auditDc, 'Audit Log') });

    // Build messages from the first 2 endpoints in this group
    const messages = [];
    let seq = 1;
    const sampleEps = bucket.eps.slice(0, 2);

    sampleEps.forEach(ep => {
      const pathShort = String(ep.path || '/api/...')
        .split('/')
        .slice(-2)
        .join('/')
        .slice(0, 30);
      const desc = String(ep.description || '')
        .replace(/\s*\(REQ-[^)]+\)/g, '')
        .trim()
        .slice(0, 35);

      // 1. User → Auth: authenticate
      messages.push({ from: 'user', to: 'auth', label: `${ep.method || 'POST'} ${pathShort}`, type: 'sync', seq: seq++ });
      // 2. Auth → User: token validated
      messages.push({ from: 'auth', to: 'user', label: 'JWT token validated', type: 'return', seq: seq++ });

      const hasDomain = participants.some(p => p.id === 'domain');
      const hasWf = participants.some(p => p.id === 'wf');

      if (hasWf) {
        messages.push({ from: 'user', to: 'wf', label: desc, type: 'sync', seq: seq++ });
        messages.push({ from: 'wf', to: 'domain', label: 'Initiate transaction', type: 'sync', seq: seq++ });
      } else if (hasDomain) {
        messages.push({ from: 'user', to: 'domain', label: desc, type: 'sync', seq: seq++ });
      }

      if (hasDomain) {
        messages.push({ from: 'domain', to: 'db', label: 'Read / write record', type: 'sync', seq: seq++ });
        messages.push({ from: 'db', to: 'domain', label: 'Result set', type: 'return', seq: seq++ });
        if (participants.some(p => p.id === 'audit')) messages.push({ from: 'domain', to: 'audit', label: 'Write audit entry', type: 'async', seq: seq++ });
        messages.push({ from: 'domain', to: 'user', label: '200 OK — ' + String(ep.response || 'response').slice(0, 20), type: 'return', seq: seq++ });
      } else {
        messages.push({ from: 'auth', to: 'user', label: '200 OK', type: 'return', seq: seq++ });
      }
    });

    diagrams.push({
      title: bucket.name,
      participants,
      messages: messages.slice(0, 14) // cap for readability
    });
  });

  return diagrams.length > 0 ? diagrams : null;
}

// Derive deployment diagram from designComponents
function deriveDeploymentDiagram(sdsData) {
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];
  const proj = sdsData.projectName || 'System';

  const environments = [
    {
      name: 'Client Zone',
      nodes: [
        { id: 'browser', label: 'Web Browser', type: 'client' },
        { id: 'mobile', label: 'Mobile App', type: 'client' },
        { id: 'branches', label: 'Branch Terminals', type: 'client' }
      ]
    },
    {
      name: 'DMZ (Load Balancer + WAF)',
      nodes: [
        { id: 'waf', label: 'WAF / Firewall', type: 'server' },
        { id: 'lb', label: 'Load Balancer', type: 'loadbalancer' }
      ]
    },
    {
      name: 'Application Tier (Private)',
      nodes: []
    },
    {
      name: 'Data Tier (Isolated)',
      nodes: [
        { id: 'primary_db', label: 'Primary RDBMS', type: 'db' },
        { id: 'replica', label: 'Read Replica', type: 'db' },
        { id: 'cache', label: 'Redis Cache', type: 'db' },
        { id: 'msgbus', label: 'Message Bus', type: 'server' }
      ]
    },
    {
      name: 'Management & DR',
      nodes: [
        { id: 'monitor', label: 'Monitoring', type: 'server' },
        { id: 'dr', label: 'DR Site', type: 'server' },
        { id: 'audit_db', label: 'Audit Store', type: 'db' }
      ]
    }
  ];

  // Populate Application Tier from service/module DCs
  let appIdx = 0;
  dcs.forEach(dc => {
    if (['service', 'module', 'api', 'integration'].includes((dc.type || '').toLowerCase()) && appIdx < 6) {
      const id = String(dc.id || `svc${appIdx}`)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_');
      const name = String(dc.name || dc.title || 'Service');
      const label = name.replace(/^(Security and |Authorization and |Conventional |General )/i, '').slice(0, 18);
      environments[2].nodes.push({ id, label, type: 'container' });
      appIdx++;
    }
  });

  if (environments[2].nodes.length === 0) {
    environments[2].nodes.push({ id: 'app', label: 'Application Server', type: 'server' });
  }

  const connections = [
    { from: 'browser', to: 'waf', label: 'HTTPS/443' },
    { from: 'branches', to: 'waf', label: 'HTTPS/443' },
    { from: 'waf', to: 'lb', label: 'HTTPS' },
    { from: 'lb', to: environments[2].nodes[0]?.id || 'app', label: 'HTTP' },
    { from: environments[2].nodes[0]?.id || 'app', to: 'primary_db', label: 'TCP/5432' },
    { from: environments[2].nodes[0]?.id || 'app', to: 'cache', label: 'TCP/6379' },
    { from: environments[2].nodes[0]?.id || 'app', to: 'msgbus', label: 'AMQP' },
    { from: 'primary_db', to: 'replica', label: 'Replication' },
    { from: 'primary_db', to: 'dr', label: 'DR Sync' },
    { from: environments[2].nodes[0]?.id || 'app', to: 'audit_db', label: 'Audit events' }
  ].filter(c => c.from && c.to);

  return {
    title: `${proj} — Deployment Architecture`,
    environments,
    connections
  };
}

// ---------------------------------------------------------------------------
// DERIVE NETWORK DIAGRAM
// Builds zone-based network topology from designComponents[].
// ---------------------------------------------------------------------------

function deriveNetworkDiagram(sdsData) {
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];

  const zones = [];
  const conns = [];

  // Zone 0 — Internet
  zones.push({
    name: 'Internet / External Connections',
    nodes: [
      { id: 'users', label: 'Bank Staff / End Users', type: 'client' },
      { id: 'branches', label: 'Branch Offices', type: 'client' },
      { id: 'ext_banks', label: 'Correspondent Banks', type: 'client' }
    ]
  });

  // Zone 1 — DMZ
  zones.push({
    name: 'DMZ (Perimeter Security)',
    nodes: [
      { id: 'waf', label: 'Web Application Firewall', type: 'firewall' },
      { id: 'lb', label: 'Load Balancer (HA Pair)', type: 'loadbalancer' },
      { id: 'smtp', label: 'SMTP / SMS Gateway', type: 'server' }
    ]
  });
  conns.push({ from: 'users', to: 'waf', protocol: 'HTTPS/443' });
  conns.push({ from: 'branches', to: 'waf', protocol: 'HTTPS/443' });
  conns.push({ from: 'ext_banks', to: 'waf', protocol: 'SWIFT/HTTPS' });
  conns.push({ from: 'waf', to: 'lb', protocol: 'HTTPS' });

  // Zone 2 — Application Zone (group DCs that are services/modules)
  const appNodes = [];
  dcs.forEach(dc => {
    const type = (dc.type || '').toLowerCase();
    const name = String(dc.name || dc.title || '');
    const id = String(dc.id || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    if (['service', 'module', 'api', 'integration'].includes(type)) {
      appNodes.push({ id, label: truncate(name, 28), type: 'server' });
    }
  });
  // Cap at 8 to keep diagram readable
  zones.push({ name: 'Application Zone (Private Network)', nodes: appNodes.slice(0, 8) });
  appNodes.slice(0, 4).forEach(n => conns.push({ from: 'lb', to: n.id, protocol: 'HTTP/8080' }));

  // Zone 3 — Data Zone
  zones.push({
    name: 'Data Zone (Isolated Segment)',
    nodes: [
      { id: 'primary_db', label: 'Primary RDBMS (Core)', type: 'db' },
      { id: 'replica_db', label: 'Read Replica', type: 'db' },
      { id: 'redis_cache', label: 'Redis Cache Cluster', type: 'db' },
      { id: 'file_store', label: 'Encrypted File / Doc Store', type: 'db' },
      { id: 'message_bus', label: 'Message Bus (Events)', type: 'server' }
    ]
  });
  if (appNodes.length > 0) {
    conns.push({ from: appNodes[0].id, to: 'primary_db', protocol: 'TCP/5432' });
    conns.push({ from: appNodes[0].id, to: 'redis_cache', protocol: 'TCP/6379' });
    conns.push({ from: appNodes[0].id, to: 'message_bus', protocol: 'AMQP' });
  }

  // Zone 4 — Management & DR
  zones.push({
    name: 'Management & DR Zone',
    nodes: [
      { id: 'monitor', label: 'Monitoring & Alerting', type: 'server' },
      { id: 'audit_db', label: 'Audit Log Store (Partitioned)', type: 'db' },
      { id: 'dr_site', label: 'DR Site (Active-Passive)', type: 'server' },
      { id: 'backup', label: 'Encrypted Backup Storage', type: 'db' }
    ]
  });
  conns.push({ from: 'primary_db', to: 'dr_site', protocol: 'Replication' });
  conns.push({ from: 'primary_db', to: 'backup', protocol: 'Backup' });

  return {
    title: `${sdsData.projectName || 'System'} — Network Architecture`,
    zones: zones.filter(z => z.nodes.length > 0),
    connections: conns.slice(0, 20)
  };
}

// ---------------------------------------------------------------------------
// DERIVE USE CASE DIAGRAMS (one per domain)
// Groups DCs into 8 business domain groups, produces one diagram each.
// ---------------------------------------------------------------------------

const UC_DOMAINS = [
  {
    domain: 'Security & Access Control',
    actors: [
      { id: 'admin', name: 'System Admin' },
      { id: 'staff', name: 'Bank Staff' },
      { id: 'auditor', name: 'Auditor' }
    ],
    keywords: [
      'auth service',
      'authentication',
      'sso',
      'mfa',
      'password',
      'session',
      'lockout',
      'access control',
      'permission',
      'workflow',
      'maker',
      'checker',
      'rbac',
      'audit',
      'audit trail',
      'immutable'
    ]
  },
  {
    domain: 'Customer & Account Management',
    actors: [
      { id: 'teller', name: 'Teller' },
      { id: 'officer', name: 'Account Officer' },
      { id: 'customer', name: 'Customer' }
    ],
    keywords: ['customer', 'cif', 'account', 'deposit', 'teller', 'cash', 'forex', 'overdraft', 'standing instruction', 'zakat', 'dormant']
  },
  {
    domain: 'Islamic Banking',
    actors: [
      { id: 'ib_officer', name: 'Islamic Banking Officer' },
      { id: 'customer', name: 'Customer' },
      { id: 'shariah', name: 'Shariah Advisor' }
    ],
    keywords: ['islamic', 'shariah', 'murabaha', 'musharaka', 'mudaraba', 'profit distribution', 'pool', 'halal', 'aaoifi']
  },
  {
    domain: 'Credit & Financing',
    actors: [
      { id: 'credit_off', name: 'Credit Officer' },
      { id: 'risk_off', name: 'Risk Officer' },
      { id: 'customer', name: 'Customer' }
    ],
    keywords: ['loan', 'credit', 'financing', 'collateral', 'provision', 'npl', 'basel', 'risk', 'classification', 'disburs']
  },
  {
    domain: 'Trade Finance',
    actors: [
      { id: 'trade_off', name: 'Trade Finance Officer' },
      { id: 'customer', name: 'Customer' },
      { id: 'corr_bank', name: 'Correspondent Bank' }
    ],
    keywords: ['trade', 'letter of credit', ' lc ', 'swift', 'mt700', 'mt103', 'guarantee', 'export', 'import', 'bill of lading']
  },
  {
    domain: 'AML & Regulatory Compliance',
    actors: [
      { id: 'compliance', name: 'Compliance Officer' },
      { id: 'fmu', name: 'FMU / FIU' },
      { id: 'analyst', name: 'AML Analyst' }
    ],
    keywords: ['aml', 'kyc', 'fatf', 'fatca', 'str', 'suspicious', 'goaml', 'sanction', 'pep', 'monitor', 'threshold', 'alert', 'risk profil', 'compliance module']
  },
  {
    domain: 'GL, Reporting & Reconciliation',
    actors: [
      { id: 'accountant', name: 'Accountant' },
      { id: 'mgr', name: 'Finance Manager' },
      { id: 'auditor', name: 'Internal Auditor' }
    ],
    keywords: ['general ledger', 'gl ', 'posting', 'report', 'reconcili', 'cost center', 'profit center', 'chart of account', 'recon']
  },
  {
    domain: 'Digital Channels & Integration',
    actors: [
      { id: 'customer', name: 'Customer' },
      { id: 'sys_admin', name: 'System Admin' },
      { id: 'ext_system', name: 'External System' }
    ],
    keywords: ['digital', 'internet banking', 'mobile', 'atm', 'pos', 'integrat', 'esb', 'external', 'channel', 'api gateway', 'swift', 'nift', 'rtgs', 'oauth', 'circuit breaker']
  }
];

function deriveUseCaseDiagrams(sdsData) {
  const dcs = Array.isArray(sdsData.designComponents) ? sdsData.designComponents : [];
  if (dcs.length === 0) return null;

  // Assign each DC to a domain
  const buckets = UC_DOMAINS.map(d => ({ ...d, dcs: [] }));
  const spill = {
    domain: 'Infrastructure & Support',
    dcs: [],
    actors: [
      { id: 'admin', name: 'System Admin' },
      { id: 'support', name: 'Support Staff' }
    ]
  };

  dcs.forEach(dc => {
    const text = (String(dc.name || dc.title || '') + ' ' + String(dc.responsibility || dc.description || '')).toLowerCase();
    let placed = false;
    for (const bucket of buckets) {
      if (bucket.keywords.some(kw => text.includes(kw))) {
        bucket.dcs.push(dc);
        placed = true;
        break;
      }
    }
    if (!placed) spill.dcs.push(dc);
  });

  if (spill.dcs.length > 0) buckets.push(spill);

  const diagrams = [];

  buckets.forEach(bucket => {
    if (bucket.dcs.length === 0) return;

    const useCases = [];
    const associations = [];
    const includes = [];

    bucket.dcs.forEach(dc => {
      const dcId = String(dc.id || 'dc')
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
      const resp = String(dc.responsibility || dc.description || '');

      // Extract verb-object pairs from responsibilities — each makes a clear UC name
      // Split on ". " or "," or ";" to get granular activities
      const rawSentences = resp
        .split(/[.;,]/)
        .map(s => s.trim())
        .filter(s => s.length >= 8 && s.length <= 90);

      // Extract the core action from each phrase — strip lead verb + keep object
      function toUcName(phrase) {
        // Remove leading participles: "managing X" → "X management"
        // Keep verb: "process X" → "Process X"
        const stripped = phrase
          .replace(/^(Centralised|Unified|Complete|Full|Real-time|Configurable|Dedicated)\s+/i, '')
          .replace(/^(Manages?|Handles?|Provides?|Implements?|Performs?|Supports?|Processes?|Generates?|Maintains?|Enforces?|Produces?|Tracks?|Monitors?|Enables?|Ensures?)\s+/i, '')
          .trim();
        // Cap at 50 chars
        return truncate(stripped.charAt(0).toUpperCase() + stripped.slice(1), 38);
      }

      // Pick up to 3 meaningful phrases
      const ucTexts = rawSentences.slice(0, 3).length > 0 ? rawSentences.slice(0, 3) : [resp.slice(0, 65)];

      ucTexts.forEach((txt, i) => {
        const ucId = `uc_${dcId}_${i}`;
        const ucName = toUcName(txt);
        if (!ucName || ucName.length < 5) return;
        useCases.push({ id: ucId, name: ucName });

        // Primary actor association
        associations.push({ actorId: bucket.actors[0].id, useCaseId: ucId });
        // Secondary actor for later UCs
        if (i > 0 && bucket.actors[1]) {
          associations.push({ actorId: bucket.actors[1].id, useCaseId: ucId });
        }
        // Include chain within same DC
        if (i > 0) includes.push({ from: `uc_${dcId}_0`, to: ucId });
      });
    });

    // Cap per diagram for readability
    const capUCs = useCases.slice(0, 12);
    const ucIdSet = new Set(capUCs.map(u => u.id));
    const capAssoc = associations.filter(a => ucIdSet.has(a.useCaseId));
    const capInc = includes.filter(i => ucIdSet.has(i.from) && ucIdSet.has(i.to)).slice(0, 5);

    diagrams.push({
      title: `${bucket.domain} — Use Cases`,
      actors: bucket.actors.slice(0, 3),
      useCases: capUCs,
      associations: capAssoc,
      includes: capInc,
      extends: []
    });
  });

  return diagrams.length > 0 ? diagrams : null;
}

// ---------------------------------------------------------------------------
// DERIVE FLOWCHART DIAGRAM
// Builds the maker-checker transaction flow common to all CBS systems.
// Uses actual endpoint names where available.
// ---------------------------------------------------------------------------

function deriveFlowchartDiagram(sdsData) {
  const eps = Array.isArray(sdsData.apiEndpoints) ? sdsData.apiEndpoints : [];
  const proj = sdsData.projectName || 'System';

  // Find a transaction/workflow endpoint for the title
  const txnEp = eps.find(e => {
    const d = (e.description || e.path || '').toLowerCase();
    return d.includes('transaction') || d.includes('submit') || d.includes('workflow') || d.includes('teller') || d.includes('post');
  });

  // Compact LR flowchart — keeps canvas wide rather than tall
  return {
    title: `${proj} — Core Transaction Flow`,
    direction: 'LR',
    nodes: [
      { id: 'start', label: 'Start', type: 'start' },
      { id: 'login', label: 'Authenticate User', type: 'process' },
      { id: 'auth_ok', label: 'Auth Valid?', type: 'decision' },
      { id: 'locked', label: 'Lockout / Error', type: 'process' },
      { id: 'input', label: 'Maker Initiates Txn', type: 'io' },
      { id: 'valid', label: 'Rules Valid?', type: 'decision' },
      { id: 'err', label: 'Show Error', type: 'process' },
      { id: 'submit', label: 'Submit to Workflow', type: 'io' },
      { id: 'approve', label: 'Checker Approves?', type: 'decision' },
      { id: 'reject', label: 'Rejected — Notify', type: 'process' },
      { id: 'post', label: 'Post to GL + Module', type: 'process' },
      { id: 'audit', label: 'Audit + Receipt', type: 'io' },
      { id: 'end', label: 'End', type: 'end' }
    ],
    edges: [
      { from: 'start', to: 'login' },
      { from: 'login', to: 'auth_ok' },
      { from: 'auth_ok', to: 'locked', label: 'No' },
      { from: 'auth_ok', to: 'input', label: 'Yes' },
      { from: 'locked', to: 'end' },
      { from: 'input', to: 'valid' },
      { from: 'valid', to: 'err', label: 'Invalid' },
      { from: 'valid', to: 'submit', label: 'Valid' },
      { from: 'err', to: 'input' },
      { from: 'submit', to: 'approve' },
      { from: 'approve', to: 'reject', label: 'No' },
      { from: 'approve', to: 'post', label: 'Yes' },
      { from: 'reject', to: 'end' },
      { from: 'post', to: 'audit' },
      { from: 'audit', to: 'end' }
    ]
  };
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

// Build a proper erDiagram Mermaid source from the structured ERD object.
// This produces attribute blocks so the mermaid.live link shows real fields.
function buildErMermaidSource(erd) {
  if (!erd || !Array.isArray(erd.entities) || erd.entities.length === 0) return null;
  const lines = ['erDiagram'];

  // Field type mapping for Mermaid erDiagram attribute syntax
  const mermaidType = t => {
    const u = String(t || '').toUpperCase();
    if (u === 'UUID' || u === 'BIGINT' || u === 'INTEGER') return 'string';
    if (u === 'DECIMAL' || u === 'NUMERIC') return 'float';
    if (u === 'BOOLEAN') return 'boolean';
    if (u === 'DATE') return 'date';
    if (u === 'TEXT') return 'string';
    return 'string';
  };

  erd.entities.forEach(entity => {
    if (!entity.fields || entity.fields.length === 0) return;
    lines.push(`  ${entity.name} {`);
    entity.fields
      .filter(f => !f.ellipsis)
      .forEach(f => {
        const type = mermaidType(f.type);
        const badge = f.pk ? ' PK' : f.fk ? ' FK' : '';
        const name = String(f.name || '').replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`    ${type} ${name}${badge}`);
      });
    lines.push('  }');
  });

  erd.relations.forEach(r => {
    const card = r.cardinality === '1:1' ? '||--||' : r.cardinality === 'N:M' ? '}o--o{' : '||--o{';
    const lbl = String(r.label || 'has').replace(/[^a-zA-Z0-9_]/g, '_') || 'has';
    lines.push(`  ${r.from} ${card} ${r.to} : "${lbl}"`);
  });

  return lines;
}

// Convert the structured flowchartDiagram object → Mermaid flowchart LR source lines
// so we can generate a valid mermaid.live link for the process flow diagram.
function buildFlowchartMermaidSource(flowchart) {
  if (!flowchart || !Array.isArray(flowchart.nodes)) return null;
  const dir = flowchart.direction || 'LR';
  const lines = [`flowchart ${dir}`];
  const nodeShapes = { start: '([ ])', end: '([ ])', decision: '{ }', io: '[ /  / ]', process: '[ ]' };

  flowchart.nodes.forEach(n => {
    const id = String(n.id).replace(/[^a-zA-Z0-9_]/g, '_');
    const label = String(n.label || n.id)
      .replace(/["\n]/g, ' ')
      .trim();
    const type = n.type || 'process';
    let shape;
    if (type === 'start' || type === 'end') shape = `([${label}])`;
    else if (type === 'decision') shape = `{${label}}`;
    else if (type === 'io') shape = `[/${label}/]`;
    else shape = `[${label}]`;
    lines.push(`  ${id}${shape}`);
  });

  flowchart.edges.forEach(e => {
    const from = String(e.from).replace(/[^a-zA-Z0-9_]/g, '_');
    const to = String(e.to).replace(/[^a-zA-Z0-9_]/g, '_');
    const label = e.label ? `|"${e.label}"|` : '';
    lines.push(`  ${from} -->${label} ${to}`);
  });

  return lines;
}

// Generate a mermaid.live edit link from mermaid source lines.
// URL is rendered as plain text in the document (no hyperlink) so length
// is not a concern — the user copies it manually into their browser.
function mermaidLiveUrl(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const code = lines.join('\n');
  try {
    const zlib = require('zlib');
    const payload = JSON.stringify({ code, mermaid: { theme: 'default' } });
    const deflated = zlib.deflateRawSync(Buffer.from(payload, 'utf-8'));
    const b64 = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `https://mermaid.live/edit#pako:${b64}`;
  } catch {
    return null;
  }
}

/**
 * Load pre-rendered UC PNG files saved by the /srs pipeline.
 *
 * /srs saves per-UC PNGs to .sdlc/artifacts/diagrams/srs/uc-{id}.png
 * and records the paths in state.json.artifacts.srs.diagrams.
 *
 * Returns an array of { title, png: Buffer, dims: {w,h} } compatible with
 * the useCaseDiagrams[] array expected by mermaid-generator.buildSdsDiagrams.
 * Returns null if nothing useful is found.
 */
function _loadSrsUcDiagrams(sdsData) {
  try {
    const fs = require('fs');
    const path = require('path');

    // sdsData._statePath is injected by generate-sds-doc.js when available
    const statePath = sdsData._statePath;
    if (!statePath) return null;

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const srsDiagrams = state && state.artifacts && state.artifacts.srs && state.artifacts.srs.diagrams;
    if (!srsDiagrams || typeof srsDiagrams !== 'object') return null;

    const ucEntries = Object.entries(srsDiagrams)
      .filter(([key]) => key.startsWith('uc-'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    if (ucEntries.length === 0) return null;

    const results = [];
    for (const [key, fpath] of ucEntries) {
      try {
        const png = fs.readFileSync(fpath);
        const ucId = key.replace('uc-', '');
        // Try to get dims via sharp
        let dims = null;
        try {
          const sharp = require('sharp');
          const meta = sharp(png).metadata();
          // metadata() is async — skip dims here, let sds-doc.js getDims handle it
          void meta;
        } catch {
          /* no sharp */
        }
        results.push({ title: ucId, png, dims });
      } catch {
        /* file missing — skip */
      }
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function buildSdsRenderData(sdsData) {
  const now = new Date();
  const yyyyMmDd = now.toISOString().slice(0, 10);

  // ── Document version ──────────────────────────────────────────────────────
  let docVersionNum = 1;
  if (typeof sdsData._docVersion === 'number' && sdsData._docVersion >= 1) {
    docVersionNum = sdsData._docVersion;
  } else if (typeof sdsData.documentVersion === 'string') {
    const parsed = parseInt(sdsData.documentVersion, 10);
    if (!isNaN(parsed) && parsed >= 1) docVersionNum = parsed;
  }
  const documentVersion = `${docVersionNum}.0`;

  // ── Version history ────────────────────────────────────────────────────────
  const priorRows = Array.isArray(sdsData._versionHistory) ? sdsData._versionHistory : [];
  const versionHistory = [];

  for (let v = 1; v < docVersionNum; v++) {
    const prior = priorRows.find(r => parseInt(String(r.version).split('.')[0], 10) === v);
    versionHistory.push(
      prior
        ? { version: `${v}.0`, date: prior.date || '—', author: prior.author || 'ECC-SDLC', changes: prior.changes || 'SDS updated', status: prior.status || 'Approved' }
        : { version: `${v}.0`, date: '—', author: 'ECC-SDLC', changes: 'Prior revision', status: 'Approved' }
    );
  }

  const preparedBy = typeof sdsData.preparedBy === 'string' && sdsData.preparedBy.trim() ? sdsData.preparedBy.trim() : 'ECC-SDLC';

  versionHistory.push({
    version: `${docVersionNum}.0`,
    date: yyyyMmDd,
    author: preparedBy,
    changes: docVersionNum === 1 ? 'Initial SDS — design extracted from validated requirements' : 'SDS updated — design components revised',
    status: 'Draft'
  });

  // ── Normalise table arrays ─────────────────────────────────────────────────
  const designComponents = Array.isArray(sdsData.designComponents)
    ? sdsData.designComponents.map(dc => ({
        ...dc,
        tracesToReq: Array.isArray(dc.tracesToReq) ? dc.tracesToReq.join(', ') : String(dc.tracesToReq || '—')
      }))
    : [];

  const traceabilityMatrixRows = Array.isArray(sdsData.traceabilityMatrixRows)
    ? sdsData.traceabilityMatrixRows.map(row => ({
        ...row,
        designComponentIds: Array.isArray(row.designComponentIds) ? row.designComponentIds.join(', ') : String(row.designComponentIds || '—')
      }))
    : [];

  // ── Derive ALL structured diagram inputs ──────────────────────────────────
  // Agent-provided values win; auto-derivation fills every gap.
  const architectureDiagram = pickDiagram(sdsData, 'architectureDiagram') || deriveArchitectureDiagram(sdsData);
  const databaseErDiagram = pickDiagram(sdsData, 'databaseErDiagram') || deriveDatabaseErDiagram(sdsData);

  const dataFlowDiagram = pickDiagram(sdsData, 'dataFlowDiagram') || deriveDataFlowDiagram(sdsData);
  const networkDiagram = pickDiagram(sdsData, 'networkDiagram') || deriveNetworkDiagram(sdsData);
  const flowchartDiagram = pickDiagram(sdsData, 'flowchartDiagram') || deriveFlowchartDiagram(sdsData);

  // Use case diagrams — array (one per domain)
  // Priority: agent-provided > auto-derived structured objects
  // SRS pre-rendered PNGs are loaded separately by sds-doc.js (async) and
  // injected after buildSdsDiagrams runs. Do NOT put raw PNG buffers into
  // useCaseDiagrams[] here — that breaks buildUseCaseSvg which expects
  // { actors[], useCases[], associations[] } not { png, title }.
  let useCaseDiagrams;
  if (Array.isArray(sdsData.useCaseDiagrams) && sdsData.useCaseDiagrams.length > 0) {
    useCaseDiagrams = sdsData.useCaseDiagrams;
  } else if (pickDiagram(sdsData, 'useCaseDiagram')) {
    useCaseDiagrams = [pickDiagram(sdsData, 'useCaseDiagram')];
  } else {
    useCaseDiagrams = deriveUseCaseDiagrams(sdsData) || [];
  }

  // ── Assemble final render data ─────────────────────────────────────────────
  const data = {
    // Cover / header / footer
    projectName: 'TBD',
    clientName: 'TBD',
    preparedBy,
    generatedDate: yyyyMmDd,
    documentVersion,
    versionHistory,

    // Section 1 — Architecture text
    architectureOverviewParagraphs: toParas(sdsData.architectureOverviewParagraphs),
    // mermaid.live link for architecture flowchart
    architectureMermaidLiveUrl: mermaidLiveUrl(toLines(sdsData.architectureDiagramMermaid)),
    // Mermaid source for flowchart — same fallback strategy as ERD
    flowchartMermaidSource: buildFlowchartMermaidSource(flowchartDiagram) || [],
    // mermaid.live link for process flow diagram
    flowchartMermaidLiveUrl: mermaidLiveUrl(buildFlowchartMermaidSource(flowchartDiagram)),
    architectureDecisionsNumbered: toParas(sdsData.architectureDecisionsNumbered),

    // Diagram inputs (Tier 1 Mermaid source + Tier 2 structured objects)
    architectureDiagramLines: toLines(sdsData.architectureDiagramMermaid),
    architectureDiagram,
    dataFlowDiagramLines: toLines(sdsData.dataFlowDiagramMermaid),
    sequenceDiagramLines: toLines(sdsData.dataFlowDiagramMermaid),
    dataFlowDiagram,
    networkDiagram,

    // Per-feature UML sequence diagrams (derived from apiEndpoints + designComponents)
    sequenceDiagrams: deriveSequenceDiagrams(sdsData) || [],
    // Deployment diagram
    deploymentDiagram: deriveDeploymentDiagram(sdsData),

    // Section 2 — Components
    designComponents,

    // Use case diagrams (one per domain)
    useCaseDiagrams,
    useCaseDiagram: useCaseDiagrams[0] || null, // first diagram for single-slot backwards compat

    // Flowchart
    flowchartDiagram,

    // Section 3 — Database
    databaseSchemaIntroParagraphs: toParas(sdsData.databaseSchemaIntroParagraphs),
    databaseErDiagramLines: toLines(sdsData.databaseErDiagramMermaid),
    // mermaid.live URL built from the AUTO-DERIVED ERD (includes real fields from databaseTables)
    // This matches what's in the document — not the agent's raw erDiagram which may lack attribute blocks
    erDiagramMermaidSource: buildErMermaidSource(databaseErDiagram) || [],
    erDiagramMermaidLiveUrl: mermaidLiveUrl(buildErMermaidSource(databaseErDiagram)),
    databaseErDiagram,
    databaseTables: Array.isArray(sdsData.databaseTables) ? sdsData.databaseTables : [],

    // Section 4 — API
    apiEndpoints: Array.isArray(sdsData.apiEndpoints) ? sdsData.apiEndpoints : [],

    // Section 5 — Integration
    integrationIntroParagraphs: toParas(sdsData.integrationIntroParagraphs),
    integrationPointsBullets: toParas(sdsData.integrationPointsBullets),

    // Section 6 — Security
    securityArchitectureParagraphs: toParas(sdsData.securityArchitectureParagraphs),
    securityAuthParagraphs: toParas(sdsData.securityAuthParagraphs),
    securityAuthorizationParagraphs: toParas(sdsData.securityAuthorizationParagraphs),
    securityDataProtectionParagraphs: toParas(sdsData.securityDataProtectionParagraphs),
    securityAuditLoggingParagraphs: toParas(sdsData.securityAuditLoggingParagraphs),

    // Section 7 — Traceability
    traceabilityMatrixRows,

    // PNG/dims slots — filled by sds-doc.js after async generation
    architecturePng: null,
    architectureDims: null,
    erDiagramPng: null,
    erDiagramDims: null,
    sequencePng: null,
    sequenceDims: null,
    sequencePngs: [], // array — one per feature group
    deploymentPng: null,
    deploymentDims: null,
    // one per domain ERD diagram
    dataFlowPng: null,
    dataFlowDims: null,
    networkPng: null,
    networkDims: null,
    useCasePng: null,
    useCaseDims: null,
    useCasePngs: [],
    flowchartPng: null,
    flowchartDims: null
  };

  // String overrides from input
  ['projectName', 'clientName', 'generatedDate'].forEach(f => {
    if (typeof sdsData[f] === 'string' && sdsData[f].trim()) data[f] = sdsData[f].trim();
  });

  return data;
}

module.exports = { buildSdsRenderData };
