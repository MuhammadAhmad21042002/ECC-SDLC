#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createSchemaValidator } = require('../lib/schema-validator');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') args.state = argv[++i];
    else if (a === '--repoRoot') args.repoRoot = argv[++i];
    else if (a === '--enforceMustDcCoverage') args.enforceMustDcCoverage = true;
    else args._.push(a);
  }
  return args;
}

function uniqSorted(items) {
  return Array.from(new Set(items)).sort();
}

function countFilledCategories(entry) {
  const dc = Array.isArray(entry.designComponents) && entry.designComponents.length > 0;
  const tc = Array.isArray(entry.testCases) && entry.testCases.length > 0;
  const cost = Array.isArray(entry.costLineItems) && entry.costLineItems.length > 0;
  return (dc ? 1 : 0) + (tc ? 1 : 0) + (cost ? 1 : 0);
}

function coverageScoreFromFilledCount(filledCount) {
  // Match rules/sdlc/traceability.md scoring: 0, 33, 67, 100
  if (filledCount <= 0) return 0;
  if (filledCount === 1) return 33;
  if (filledCount === 2) return 67;
  return 100;
}

function buildReqToDcs(designComponents) {
  const map = new Map();
  for (const dc of designComponents) {
    const dcId = dc && typeof dc.id === 'string' ? dc.id : '';
    const reqs = (dc && Array.isArray(dc.requirementIds)) ? dc.requirementIds : [];
    for (const reqId of reqs) {
      if (!map.has(reqId)) map.set(reqId, []);
      map.get(reqId).push(dcId);
    }
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.state) {
    console.error('Usage: node scripts/traceability-update.js --state <path-to-.sdlc/state.json> [--enforceMustDcCoverage] [--repoRoot <path>]');
    process.exit(2);
  }

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(__dirname, '..');
  const validator = createSchemaValidator({ repoRoot });

  const statePath = path.resolve(process.cwd(), args.state);
  const state = readJson(statePath);
  validator.assertValid(state, 'state');

  const requirements = Array.isArray(state.requirements) ? state.requirements : [];
  const designComponents = Array.isArray(state.designComponents) ? state.designComponents : [];

  // Ensure design components validate (defense-in-depth)
  for (const dc of designComponents) {
    validator.assertValid(dc, 'design-component');
  }

  const reqToDcs = buildReqToDcs(designComponents);

  const updatedRequirements = requirements.map(req => {
    const reqId = req && typeof req.id === 'string' ? req.id : '';
    const dcIds = uniqSorted(reqToDcs.get(reqId) || []);
    const prevTrace = (req && typeof req.traceForward === 'object' && req.traceForward) ? req.traceForward : {};
    return {
      ...req,
      traceForward: {
        designComponentIds: dcIds,
        testCaseIds: Array.isArray(prevTrace.testCaseIds) ? prevTrace.testCaseIds : [],
        costLineItemIds: Array.isArray(prevTrace.costLineItemIds) ? prevTrace.costLineItemIds : [],
      },
    };
  });

  if (args.enforceMustDcCoverage) {
    const missing = updatedRequirements
      .filter(r => r && r.priority === 'must')
      .filter(r => !r.traceForward || !Array.isArray(r.traceForward.designComponentIds) || r.traceForward.designComponentIds.length === 0)
      .map(r => r.id);

    if (missing.length > 0) {
      console.error(`ERR:must-dc-coverage:Missing DC mapping for: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  const prevMatrix = (state.traceabilityMatrix && typeof state.traceabilityMatrix === 'object') ? state.traceabilityMatrix : {};
  const nextMatrix = { ...prevMatrix };

  for (const req of updatedRequirements) {
    const reqId = req && typeof req.id === 'string' ? req.id : '';
    if (!reqId) continue;
    const prev = prevMatrix[reqId] && typeof prevMatrix[reqId] === 'object' ? prevMatrix[reqId] : {};
    const designComponentsList = (req.traceForward && Array.isArray(req.traceForward.designComponentIds))
      ? req.traceForward.designComponentIds
      : [];

    const testCasesList = Array.isArray(prev.testCases) ? prev.testCases : [];
    const costLineItemsList = Array.isArray(prev.costLineItems) ? prev.costLineItems : [];

    const entry = {
      title: typeof req.title === 'string' ? req.title : '',
      designComponents: designComponentsList,
      testCases: testCasesList,
      costLineItems: costLineItemsList,
    };

    nextMatrix[reqId] = {
      ...entry,
      coverageScore: coverageScoreFromFilledCount(countFilledCategories(entry)),
    };
  }

  const nextState = {
    ...state,
    requirements: updatedRequirements,
    traceabilityMatrix: nextMatrix,
  };

  validator.assertValid(nextState, 'state');
  writeJson(statePath, nextState);
  console.log(`OK:traceability-updated:${args.state}`);
}

main();

