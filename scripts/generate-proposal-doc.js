#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { generateProposalDoc } = require('../lib/doc-generator/proposal-doc');

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

function readPriorVersionHistory(statePath, currentVersion) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return [];
  }

  const proposal = state.artifacts && state.artifacts.proposal;
  if (!proposal) return [];

  // Index stored version history by version number
  const stored = {};
  if (Array.isArray(proposal.versionHistory)) {
    for (const row of proposal.versionHistory) {
      const num = parseInt(String(row.version).split('.')[0], 10);
      if (!isNaN(num)) stored[num] = row;
    }
  }

  const createdDate = proposal.createdAt ? proposal.createdAt.slice(0, 10) : null;
  const updatedDate = proposal.updatedAt ? proposal.updatedAt.slice(0, 10) : null;

  // Build rows for every prior version 1..(currentVersion-1)
  const rows = [];
  for (let v = 1; v < currentVersion; v++) {
    if (stored[v]) {
      rows.push({
        version: `${v}.0`,
        date:    stored[v].date    || '—',
        author:  stored[v].author  || 'ECC-SDLC',
        changes: stored[v].changes || 'Proposal updated',
        status:  stored[v].status  || 'Approved',
      });
    } else {
      const fallbackDate =
        v === 1 && createdDate                  ? createdDate  :
        v === currentVersion - 1 && updatedDate ? updatedDate  :
        '—';
      rows.push({
        version: `${v}.0`,
        date:    fallbackDate,
        author:  'ECC-SDLC',
        changes: v === 1 ? 'Initial proposal assembled from SDLC artifacts' : 'Proposal updated',
        status:  'Approved',
      });
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.data || !args.out) {
    console.error('Usage: node scripts/generate-proposal-doc.js --data <path> --out <path.docx> [--template <json>] [--version <N>] [--state <state.json>]');
    process.exit(2);
  }

  const dataPath   = path.resolve(process.cwd(), args.data);
  const outPath    = path.resolve(process.cwd(), args.out);
  const docVersion = parseInt(args.version || '1', 10) || 1;

  const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Unwrap if agent returned { proposalData: { ... } }
  const raw = parsed.proposalData || parsed;
  raw._docVersion = docVersion;

  const statePath = args.state
    ? path.resolve(process.cwd(), args.state)
    : path.resolve(process.cwd(), '.sdlc', 'state.json');

  raw._versionHistory = readPriorVersionHistory(statePath, docVersion);

  // Inject project metadata from state.json if missing from agent output.
  // currency lives nested inside rateCard (rateCard.architect.currency) —
  // there is no guaranteed top-level currency field, so we probe in order:
  //   1. state.currency          (written manually or by /scope)
  //   2. rateCard.architect.currency  (most reliable nested source)
  //   3. rateCard.seniorDev.currency  (fallback nested source)
  //   4. hard default 'PKR'
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!raw.projectName && state.projectName) raw.projectName = state.projectName;
    if (!raw.clientName  && state.clientName)  raw.clientName  = state.clientName;
    if (!raw.currency) {
      const rc = state.rateCard || {};
      raw.currency =
        state.currency                                  ||
        (rc.architect  && rc.architect.currency)  ||
        (rc.seniorDev  && rc.seniorDev.currency)  ||
        (rc.juniorDev  && rc.juniorDev.currency)  ||
        'PKR';
    }
  } catch {
    // state.json unreadable — non-fatal, metadata falls back to render-data defaults
  }

  const templatePath = args.template
    ? path.resolve(process.cwd(), args.template)
    : path.resolve(__dirname, '..', 'templates', 'proposal-template.json');

  try {
    await generateProposalDoc(raw, outPath, templatePath, { statePath });
    console.log(`SDLC:PROPOSAL:DOC_GENERATED:${outPath}`);
  } catch (err) {
    console.error(`ERR:${err.message}`);
    process.exit(1);
  }
}

main();