#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generateSrsDocument } = require('../lib/doc-generator/srs-doc');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--template') args.template = argv[++i];
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--state') args.state = argv[++i];
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

  const srs = state.artifacts && state.artifacts.srs;
  if (!srs) return [];

  const stored = {};
  if (Array.isArray(srs.versionHistory)) {
    for (const row of srs.versionHistory) {
      const num = parseInt(String(row.version).split('.')[0], 10);
      if (!isNaN(num)) stored[num] = row;
    }
  }

  const createdDate = srs.createdAt ? srs.createdAt.slice(0, 10) : null;
  const updatedDate = srs.updatedAt ? srs.updatedAt.slice(0, 10) : null;

  const rows = [];
  for (let v = 1; v < currentVersion; v++) {
    if (stored[v]) {
      rows.push({
        version: `${v}.0`,
        date: stored[v].date || '—',
        author: stored[v].author || 'ECC-SDLC',
        changes: stored[v].changes || 'SRS updated',
        status: stored[v].status || 'Approved'
      });
    } else {
      const fallbackDate = v === 1 && createdDate ? createdDate : v === currentVersion - 1 && updatedDate ? updatedDate : '—';
      rows.push({
        version: `${v}.0`,
        date: fallbackDate,
        author: 'ECC-SDLC',
        changes: v === 1 ? 'Initial SRS extracted from validated requirements' : 'SRS updated',
        status: 'Approved'
      });
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.data || !args.out) {
    console.error('Usage: node scripts/generate-srs-doc.js --data <path> --out <path.docx> [--template <json>] [--version <N>] [--state <state.json>]');
    process.exit(2);
  }

  const dataPath = path.resolve(process.cwd(), args.data);
  const outPath = path.resolve(process.cwd(), args.out);
  const docVersion = parseInt(args.version || '1', 10) || 1;

  const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const raw = parsed.srsData || parsed; // unwrap srsData wrapper if present
  raw._docVersion = docVersion;

  const statePath = args.state ? path.resolve(process.cwd(), args.state) : path.resolve(process.cwd(), '.sdlc', 'state.json');

  raw._versionHistory = readPriorVersionHistory(statePath, docVersion);

  // Inject requirements from state.json — technical writer does not produce these.
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (Array.isArray(state.requirements) && state.requirements.length > 0) {
      raw.requirements = state.requirements;
    }
    if (!raw.projectName && state.projectName) raw.projectName = state.projectName;
    if (!raw.clientName && state.clientName) raw.clientName = state.clientName;
  } catch {
    // state.json unreadable — requirements will fall back to TBD placeholder
  }

  const templatePath = args.template ? path.resolve(process.cwd(), args.template) : path.resolve(__dirname, '..', 'templates', 'srs-template.json');

  const projectRoot = path.resolve(outPath, '..', '..', '..');

  try {
    const result = await generateSrsDocument(raw, outPath, templatePath, { projectRoot });

    // result = { docPath, savedDiagramPaths }
    const savedDiagramPaths = result && typeof result === 'object' && result.savedDiagramPaths ? result.savedDiagramPaths : {};

    // Write savedDiagramPaths into state.json.artifacts.srs.diagrams for /sds reuse
    if (Object.keys(savedDiagramPaths).length > 0 && statePath) {
      try {
        const stateRaw = fs.readFileSync(statePath, 'utf8');
        const stateJson = JSON.parse(stateRaw);
        if (stateJson.artifacts && stateJson.artifacts.srs) {
          stateJson.artifacts.srs.diagrams = savedDiagramPaths;
          fs.writeFileSync(statePath, JSON.stringify(stateJson, null, 2));
          process.stderr.write(`[ECC-SDLC] SRS diagram paths written to state.json\n`);
        }
      } catch (e) {
        process.stderr.write(`[ECC-SDLC] Warning: could not update state.json SRS diagrams: ${e.message}\n`);
      }
    }

    const outFinal = result && typeof result === 'object' && result.docPath ? result.docPath : outPath;
    console.log(`SDLC:SRS:DOC_GENERATED:${outFinal}`);
  } catch (err) {
    console.error(`ERR:${err.message}`);
    process.exit(1);
  }
}

main();
