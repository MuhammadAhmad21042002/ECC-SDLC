'use strict';

/**
 * finalize-traceforward.js
 *
 * Atomically performs the final two orchestration duties of /estimate:
 *   1. Reads the tmp estimate JSON, assigns COST-NNN identifiers per
 *      effortBreakdown row, and stamps each requirement's
 *      traceForward.costLineItemIds array in state.json.
 *   2. Sweeps every `estimate-v<N>.json` file from the tmp directory.
 *
 * Both actions live in a single Node.js process so that they cannot be
 * split by the caller. This is the pattern ECC-SDLC uses for every
 * mandatory post-processing duty where a markdown command file alone
 * would be skipped by an interpreting agent.
 *
 * CLI:
 *   node scripts/finalize-traceforward.js --state <state.json path>
 *
 * Exit codes:
 *   0  traceForward updated and tmp swept
 *   1  bad args, unreadable inputs, or empty effortBreakdown
 *
 * Expected invariants when called:
 *   - state.json exists
 *   - .sdlc/tmp/estimate-v<N>.json exists where N = currentVersion + 1
 *     (because /estimate is mid-run and has not yet written Step 5)
 */

const fs   = require('fs');
const path = require('path');

function zeroPad(n) { return String(n).padStart(3, '0'); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--state') args.state = argv[++i];
  }
  return args;
}

function fail(msg, code = 1) {
  console.error(`[finalize-traceforward] ${msg}`);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.state) {
    fail('Usage: node scripts/finalize-traceforward.js --state <state.json>');
  }

  const statePath = path.resolve(process.cwd(), args.state);
  if (!fs.existsSync(statePath)) {
    fail(`state.json not found at: ${statePath}`);
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    fail(`could not parse state.json: ${e.message}`);
  }

  // Locate the tmp JSON produced by Step 2 of /estimate.
  // Version is currentVersion + 1 because Step 5 has not yet written the new artifact.
  const currentVersion =
    (state.artifacts && state.artifacts.estimate && state.artifacts.estimate.version)
      ? state.artifacts.estimate.version
      : 0;
  const nextVersion = Math.floor(Number(currentVersion)) + 1;

  const sdlcDir = path.dirname(statePath);
  const tmpDir  = path.join(sdlcDir, 'tmp');
  const jsonPath = path.join(tmpDir, `estimate-v${nextVersion}.json`);

  if (!fs.existsSync(jsonPath)) {
    fail(`estimate JSON not found at: ${jsonPath}\nThe Estimator agent did not produce the expected file.`);
  }

  let estimateRoot;
  try {
    estimateRoot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    fail(`could not parse estimate JSON: ${e.message}`);
  }

  const plan = estimateRoot.estimatePlan;
  if (!plan || !plan.sheets || !Array.isArray(plan.sheets.effortBreakdown)) {
    fail('estimatePlan.sheets.effortBreakdown missing or not an array');
  }
  if (plan.sheets.effortBreakdown.length === 0) {
    fail('effortBreakdown is empty — nothing to trace');
  }

  // ─── Phase 1 — Build requirementId → COST IDs map ──────────────────────
  const reqCostMap = {};
  let costSeq = 1;

  for (const row of plan.sheets.effortBreakdown) {
    const costId = `COST-${zeroPad(costSeq++)}`;
    const reqIds = String(row.requirementIds || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    for (const reqId of reqIds) {
      if (!reqCostMap[reqId]) reqCostMap[reqId] = new Set();
      reqCostMap[reqId].add(costId);
    }
  }

  const totalCostIds = costSeq - 1;
  if (totalCostIds === 0) {
    fail('No effortBreakdown rows yielded COST IDs — aborting before state.json mutation');
  }

  // ─── Phase 2 — Stamp traceForward on matching requirements ─────────────
  let updatedCount = 0;
  if (!Array.isArray(state.requirements)) state.requirements = [];

  for (const req of state.requirements) {
    if (!req.traceForward) req.traceForward = {};
    if (!Array.isArray(req.traceForward.costLineItemIds)) req.traceForward.costLineItemIds = [];

    const fromMap = reqCostMap[req.id];
    if (!fromMap) continue;

    const existing = new Set(req.traceForward.costLineItemIds);
    const toAdd = [...fromMap].filter(id => !existing.has(id));

    if (toAdd.length > 0) {
      req.traceForward.costLineItemIds = [...req.traceForward.costLineItemIds, ...toAdd];
      updatedCount++;
    }
  }

  // ─── Phase 3 — Persist state.json ──────────────────────────────────────
  const { writeJsonAtomic } = require('./sdlc/utils/state-writer');
  writeJsonAtomic(statePath, state);
  console.log(
    `traceForward updated: ${updatedCount} requirements stamped, ` +
    `${totalCostIds} COST IDs assigned (COST-001 … COST-${zeroPad(totalCostIds)})`
  );

  // ─── Phase 4 — Sweep tmp directory ─────────────────────────────────────
  // This is the atomic pairing — if we reach this line, the traceForward
  // write succeeded, and cleanup MUST follow in the same process so no
  // interpreting caller can drop it.
  let removed = 0;
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const name of entries) {
      if (/^estimate-v\d+\.json$/.test(name)) {
        try {
          fs.unlinkSync(path.join(tmpDir, name));
          removed++;
        } catch (e) {
          console.error(`  warn: could not delete ${name}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`  warn: could not list tmp dir ${tmpDir}: ${e.message}`);
  }
  console.log(`tmp cleanup: removed ${removed} estimate-v*.json file(s) from ${tmpDir}`);
}

if (require.main === module) {
  main();
}
