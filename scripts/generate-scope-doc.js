#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generateScopeDocument } = require('../lib/doc-generator/scope-doc');

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

  const scope = state.artifacts && state.artifacts.scope;
  if (!scope) return [];

  // The stored versionHistory is our source of truth for versions that have
  // real data. Index them by their version number for fast lookup.
  const stored = {};
  if (Array.isArray(scope.versionHistory)) {
    for (const row of scope.versionHistory) {
      const num = parseInt(String(row.version).split('.')[0], 10);
      if (!isNaN(num)) stored[num] = row;
    }
  }

  // Fallback dates when a version has no stored row (pre-fix runs)
  const createdDate = scope.createdAt ? scope.createdAt.slice(0, 10) : null;
  const updatedDate = scope.updatedAt ? scope.updatedAt.slice(0, 10) : null;

  // Build rows for every prior version 1..(currentVersion-1)
  const rows = [];
  for (let v = 1; v < currentVersion; v++) {
    if (stored[v]) {
      // Real data — use it exactly as stored
      rows.push({
        version: `${v}.0`,
        date: stored[v].date || '—',
        author: stored[v].author || 'ECC-SDLC',
        changes: stored[v].changes || 'Scope document updated'
      });
    } else {
      // No stored entry for this version — best-effort reconstruction
      const fallbackDate = v === 1 && createdDate ? createdDate : v === currentVersion - 1 && updatedDate ? updatedDate : '—';
      rows.push({
        version: `${v}.0`,
        date: fallbackDate,
        author: 'ECC-SDLC',
        changes: v === 1 ? 'Initial draft' : 'Scope document updated'
      });
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.data || !args.out) {
    console.error('Usage: node scripts/generate-scope-doc.js ' + '--data <path> --out <path.docx> [--template <json>] [--version <N>] [--state <state.json>]');
    process.exit(2);
  }

  const dataPath = path.resolve(process.cwd(), args.data);
  const outPath = path.resolve(process.cwd(), args.out);
  const docVersion = parseInt(args.version || '1', 10) || 1;

  // Read scope data
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // Inject version number
  raw._docVersion = docVersion;

  // Inject prior version history from state.json
  const statePath = args.state ? path.resolve(process.cwd(), args.state) : path.resolve(process.cwd(), '.sdlc', 'state.json');

  raw._versionHistory = readPriorVersionHistory(statePath, docVersion);

  const templatePath = args.template ? path.resolve(process.cwd(), args.template) : path.resolve(__dirname, '..', 'templates', 'scope-template.json');

  try {
    await generateScopeDocument(raw, outPath, templatePath);
  } catch (err) {
    console.error(`ERR:${err.message}`);
    process.exit(1);
  }
}

main();
