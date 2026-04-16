#!/usr/bin/env node
'use strict';

/**
 * generate-sds-doc.js
 *
 * CLI entry point for SDS document generation, called by /sds Step 4.
 * Delegates to sds-doc.js (which runs mermaid diagram generation) rather
 * than calling generateFromTemplate directly — same pattern as generate-scope-doc.js.
 *
 * Usage:
 *   node scripts/generate-sds-doc.js \
 *     --data      .sdlc/tmp/sds-data.json \
 *     --out       .sdlc/artifacts/sds-v2.docx \
 *     --template  templates/sds-template.json   (optional)
 *     --version   2                             (document version number)
 *     --state     .sdlc/state.json              (optional — for version history)
 */

const fs = require('fs');
const path = require('path');
const { generateSdsDocument } = require('../lib/doc-generator/sds-doc');

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

  const sds = state.artifacts && state.artifacts.sds;
  if (!sds) return [];

  const stored = {};
  if (Array.isArray(sds.versionHistory)) {
    for (const row of sds.versionHistory) {
      const num = parseInt(String(row.version).split('.')[0], 10);
      if (!isNaN(num)) stored[num] = row;
    }
  }

  const createdDate = sds.createdAt ? sds.createdAt.slice(0, 10) : null;
  const updatedDate = sds.updatedAt ? sds.updatedAt.slice(0, 10) : null;

  const rows = [];
  for (let v = 1; v < currentVersion; v++) {
    if (stored[v]) {
      rows.push({
        version: `${v}.0`,
        date: stored[v].date || '—',
        author: stored[v].author || 'ECC-SDLC',
        changes: stored[v].changes || 'SDS updated',
        status: stored[v].status || 'Approved'
      });
    } else {
      const fallbackDate = v === 1 && createdDate ? createdDate : v === currentVersion - 1 && updatedDate ? updatedDate : '—';
      rows.push({
        version: `${v}.0`,
        date: fallbackDate,
        author: 'ECC-SDLC',
        changes: v === 1 ? 'Initial SDS — design extracted from validated requirements' : 'SDS updated — design components revised',
        status: 'Approved'
      });
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.data || !args.out) {
    console.error('Usage: node scripts/generate-sds-doc.js ' + '--data <path> --out <path.docx> [--template <json>] [--version <N>] [--state <state.json>]');
    process.exit(2);
  }

  const dataPath = path.resolve(process.cwd(), args.data);
  const outPath = path.resolve(process.cwd(), args.out);
  const docVersion = parseInt(args.version || '1', 10) || 1;

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  raw._docVersion = docVersion;

  const statePath = args.state ? path.resolve(process.cwd(), args.state) : path.resolve(process.cwd(), '.sdlc', 'state.json');

  raw._versionHistory = readPriorVersionHistory(statePath, docVersion);

  // Inject _statePath so sds-render-data._loadSrsUcDiagrams can load /srs-saved UC PNGs
  raw._statePath = statePath;

  const templatePath = args.template ? path.resolve(process.cwd(), args.template) : path.resolve(__dirname, '..', 'templates', 'sds-template.json');

  try {
    const projectRoot = path.resolve(outPath, '..', '..', '..');
    const result = await generateSdsDocument(raw, outPath, templatePath, { projectRoot });

    // result = { docPath, savedDiagramPaths } since sds-doc.js v7
    // For backwards compat, result may also be just a string (old sds-doc.js)
    const savedDiagramPaths = result && typeof result === 'object' && result.savedDiagramPaths ? result.savedDiagramPaths : {};

    // Write savedDiagramPaths into state.json.artifacts.sds.diagrams
    if (Object.keys(savedDiagramPaths).length > 0 && statePath) {
      try {
        const stateRaw = fs.readFileSync(statePath, 'utf8');
        const stateJson = JSON.parse(stateRaw);
        if (stateJson.artifacts && stateJson.artifacts.sds) {
          stateJson.artifacts.sds.diagrams = savedDiagramPaths;
          fs.writeFileSync(statePath, JSON.stringify(stateJson, null, 2));
          console.error(`[ECC-SDLC] Diagram paths written to state.json`);
        }
      } catch (e) {
        console.error(`[ECC-SDLC] Warning: could not update state.json diagrams: ${e.message}`);
      }
    }

    const outFinal = result && typeof result === 'object' && result.docPath ? result.docPath : outPath;
    console.log(`SDLC:SDS:DOC_GENERATED:${outFinal}`);
  } catch (err) {
    console.error(`ERR:${err.message}`);
    process.exit(1);
  }
}

main();
