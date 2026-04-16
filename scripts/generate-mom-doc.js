#!/usr/bin/env node
'use strict';

/**
 * generate-mom-doc.js
 *
 * CLI entry point for MoM document generation, called by /mom Step 4.
 * Reads mom-data.json, maps it to render-data, and calls generateFromTemplate
 * to produce the .docx output.
 *
 * Usage:
 *   node scripts/generate-mom-doc.js \
 *     --data      .sdlc/tmp/mom-data.json \
 *     --out       .sdlc/artifacts/mom-v1.docx \
 *     --template  templates/mom-template.json   (optional) \
 *     --version   1                             (document version number) \
 *     --state     .sdlc/state.json              (optional — for version history)
 */

const fs   = require('fs');
const path = require('path');
const { generateFromTemplate } = require('../lib/doc-generator/generic-doc');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--data')     args.data     = argv[++i];
    else if (a === '--out')      args.out      = argv[++i];
    else if (a === '--template') args.template = argv[++i];
    else if (a === '--version')  args.version  = argv[++i];
    else if (a === '--state')    args.state    = argv[++i];
  }
  return args;
}

// ---------------------------------------------------------------------------
// Version history helpers
// ---------------------------------------------------------------------------

function readPriorVersionHistory(statePath, currentVersion) {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return []; }

  // MoM version history is stored on the individual meeting record inside
  // state.meetings[], not on state.artifacts.  For document versioning we
  // use a lightweight accumulated array stored on state.artifacts.mom.
  const mom = state.artifacts && state.artifacts.mom;
  if (!mom) return [];

  const stored = {};
  if (Array.isArray(mom.versionHistory)) {
    for (const row of mom.versionHistory) {
      const num = parseInt(String(row.version).split('.')[0], 10);
      if (!isNaN(num)) stored[num] = row;
    }
  }

  const createdDate = mom.createdAt ? mom.createdAt.slice(0, 10) : null;
  const updatedDate = mom.updatedAt ? mom.updatedAt.slice(0, 10) : null;

  const rows = [];
  for (let v = 1; v < currentVersion; v++) {
    if (stored[v]) {
      rows.push({
        version: `${v}.0`,
        date:    stored[v].date    || '—',
        author:  stored[v].author  || 'ECC-SDLC',
        changes: stored[v].changes || 'MoM updated'
      });
    } else {
      const fallbackDate = v === 1 && createdDate ? createdDate
        : v === currentVersion - 1 && updatedDate ? updatedDate : '—';
      rows.push({
        version: `${v}.0`,
        date:    fallbackDate,
        author:  'ECC-SDLC',
        changes: v === 1 ? 'Initial Minutes of Meeting document' : 'MoM revised'
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Render-data builder — maps MoM JSON → template placeholder keys
// ---------------------------------------------------------------------------

function buildMomRenderData(momData, docVersion, priorHistory) {
  const now       = new Date();
  const yyyyMmDd  = now.toISOString().slice(0, 10);
  const docVerStr = `${docVersion}.0`;

  // ── Version history row for this run ──────────────────────────────────────
  const versionHistory = [
    ...priorHistory,
    {
      version: docVerStr,
      date:    yyyyMmDd,
      author:  momData.preparedBy || 'ECC-SDLC',
      changes: docVersion === 1
        ? 'Initial Minutes of Meeting'
        : 'MoM revised — updated decisions, actions, or signals'
    }
  ];

  // ── Meeting details rows (key-value table) ─────────────────────────────────
  const meetingDetailsRows = [
    { field: 'Meeting Title',  value: momData.meetingTitle  || '—' },
    { field: 'Date',           value: momData.date          || '—' },
    { field: 'Time',           value: momData.time          || '—' },
    { field: 'Duration',       value: momData.duration      || '—' },
    { field: 'Meeting Type',   value: momData.meetingType   || '—' },
    { field: 'Platform',       value: momData.platform      || '—' },
    { field: 'Location',       value: momData.location      || '—' },
    { field: 'Project',        value: momData.projectName   || '—' },
    { field: 'Client',         value: momData.clientName    || '—' },
    { field: 'Prepared by',    value: momData.preparedBy    || 'ECC-SDLC' }
  ].filter(r => r.value && r.value !== '—');

  // ── Attendees rows ────────────────────────────────────────────────────────
  const attendeeRows = (momData.attendees || []).map(a => ({
    name:         a.name         || '—',
    role:         a.role         || '—',
    organization: a.organization || '—',
    status:       a.present === false ? 'Apologies' : 'Present'
  }));

  // ── Decisions rows ────────────────────────────────────────────────────────
  const decisionRows = (momData.decisions || []).map(d => ({
    id:       d.id       || '—',
    decision: d.decision || '—',
    owner:    d.owner    || '—',
    dueDate:  d.dueDate  || 'TBD'
  }));

  // ── Action item rows ──────────────────────────────────────────────────────
  const actionItemRows = (momData.actionItems || []).map(a => ({
    id:       a.id       || '—',
    action:   a.action   || '—',
    owner:    a.owner    || '—',
    dueDate:  a.dueDate  || 'TBD',
    priority: a.priority || 'medium'
  }));

  // ── Requirement signals ───────────────────────────────────────────────────
  const requirementSignalBullets = Array.isArray(momData.requirementSignals)
    ? momData.requirementSignals.filter(Boolean)
    : ['(No requirement signals recorded)'];

  // ── Open questions ────────────────────────────────────────────────────────
  const openQuestionBullets = Array.isArray(momData.openQuestions) && momData.openQuestions.length > 0
    ? momData.openQuestions
    : ['(No open questions recorded)'];

  // ── Compliance flags ──────────────────────────────────────────────────────
  const complianceFlagBullets = Array.isArray(momData.complianceFlags) && momData.complianceFlags.length > 0
    ? momData.complianceFlags
    : ['(No compliance flags detected in this meeting)'];

  // ── Next meeting ──────────────────────────────────────────────────────────
  const nm = momData.nextMeeting;
  const hasNextMeeting = nm && (nm.date || nm.platform || (Array.isArray(nm.proposedAgenda) && nm.proposedAgenda.length > 0));
  const nextMeetingParagraphs = hasNextMeeting ? [
    [
      nm.date     ? `Date: ${nm.date}`          : null,
      nm.platform ? `Platform: ${nm.platform}`  : null,
    ].filter(Boolean).join('  |  '),
    Array.isArray(nm.proposedAgenda) && nm.proposedAgenda.length > 0
      ? `Proposed agenda: ${nm.proposedAgenda.join('; ')}`
      : null
  ].filter(Boolean) : [];

  // ── Summary ───────────────────────────────────────────────────────────────
  const summaryParagraphs = momData.summary
    ? [momData.summary]
    : ['(No meeting summary provided)'];

  return {
    // Cover / header / footer tokens
    projectName:      momData.projectName  || 'Unknown Project',
    clientName:       momData.clientName   || 'Unknown Client',
    meetingTitle:     momData.meetingTitle  || 'Minutes of Meeting',
    meetingDate:      momData.date         || yyyyMmDd,
    preparedBy:       momData.preparedBy   || 'ECC-SDLC',
    generatedDate:    yyyyMmDd,
    documentVersion:  docVerStr,

    // Sections
    versionHistory,
    meetingDetailsRows,
    attendeeRows,
    agendaItems:             Array.isArray(momData.agendaItems) ? momData.agendaItems : [],
    summaryParagraphs,
    decisionRows,
    actionItemRows,
    requirementSignalBullets,
    openQuestionBullets,
    complianceFlagBullets,
    hasNextMeeting:          !!hasNextMeeting,
    nextMeetingParagraphs
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.data || !args.out) {
    console.error(
      'Usage: node scripts/generate-mom-doc.js ' +
      '--data <path> --out <path.docx> [--template <json>] [--version <N>] [--state <state.json>]'
    );
    process.exit(2);
  }

  const dataPath     = path.resolve(process.cwd(), args.data);
  const outPath      = path.resolve(process.cwd(), args.out);
  const docVersion   = parseInt(args.version || '1', 10) || 1;
  const templatePath = args.template
    ? path.resolve(process.cwd(), args.template)
    : path.resolve(__dirname, '..', 'templates', 'mom-template.json');
  const statePath    = args.state
    ? path.resolve(process.cwd(), args.state)
    : path.resolve(process.cwd(), '.sdlc', 'state.json');

  let momData;
  try {
    momData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    console.error(`ERR: Could not read mom-data JSON at ${dataPath}: ${err.message}`);
    process.exit(1);
  }

  const priorHistory = readPriorVersionHistory(statePath, docVersion);
  const data         = buildMomRenderData(momData, docVersion, priorHistory);

  try {
    await generateFromTemplate({ templatePath, data, outputPath: outPath });
  } catch (err) {
    console.error(`ERR: ${err.message}`);
    process.exit(1);
  }
}

main();
