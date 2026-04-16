'use strict';

/**
 * Tests for agents/compliance-checker.md output contract.
 *
 * The compliance-checker agent is an AI agent invoked by /srs and /compliance.
 * These tests validate the OUTPUT CONTRACT — the JSON structure the agent must
 * produce — using real fixtures, not the agent itself. This ensures:
 *   1. Fixture shapes conform to the documented output contract
 *   2. Validation logic (keyword matching, severity counting, status rules) is correct
 *   3. Integration helpers that process agent output work correctly
 *
 * Test groups:
 *   Unit 1  — valid /srs mode output (requirements mode) fixture shape
 *   Unit 2  — valid /compliance mode output (full mode) fixture shape
 *   Unit 3  — invalid fixture correctly fails structural validation
 *   Unit 4  — complianceFlags field rules (status, severity, required fields)
 *   Unit 5  — requirementUpdates matches flagged requirements (srs mode)
 *   Unit 6  — summary.bySeverity counts match actual flags
 *   Unit 7  — summary.flagged matches complianceFlags.length
 *   Unit 8  — gapAnalysis counts match complianceMatrix entries (full mode)
 *   Unit 9  — all flagged REQ IDs match REQ-* pattern
 *   Unit 10 — no duplicate flags for same (controlId, triggeredBy) pair
 *   Unit 11 — srs mode: all statuses must be "pending-review"
 *   Unit 12 — full mode: status values are from allowed set
 *   Unit 13 — full mode: criticalGaps contain only critical-severity entries
 *   Unit 14 — full mode: compliant controls have empty gaps[]
 *   Unit 15 — full mode: non-compliant controls have empty evidenceFound[]
 *   Integration 1 — mergeComplianceUpdates correctly adds frameworks to requirements
 *   Integration 2 — mergeComplianceFlags correctly appends to state complianceFlags
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}\n    Error: ${err.message}`);
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'sdlc', 'fixtures');

const SRS_FIXTURE = path.join(FIXTURES_DIR, 'valid-compliance-output.json');
const FULL_FIXTURE = path.join(FIXTURES_DIR, 'valid-compliance-full-output.json');
const BAD_FIXTURE = path.join(FIXTURES_DIR, 'invalid-compliance-output.json');

const REQ_PATTERN = /^REQ-(FUNC|NFUNC|CON)-\d{3}$/;
const SEVERITY_SET = new Set(['critical', 'high', 'medium', 'low']);
const SRS_STATUS = 'pending-review';
const FULL_STATUS = new Set(['compliant', 'partial', 'non-compliant', 'not-applicable']);
const FRAMEWORK_SET = new Set(['SBP-2024', 'PPRA-2024', 'P3A-Act-2017', 'GDPR', 'ISO-27001', 'PCI-DSS', 'SAMA-2024', 'CBUAE', 'AAOIFI']);

/**
 * Validates the top-level shape of a compliance-checker output object.
 * Returns { valid: true } or { valid: false, reason: string }
 */
function validateShape(output, expectedMode) {
  if (!output || typeof output !== 'object') {
    return { valid: false, reason: 'output is not an object' };
  }
  if (output.mode !== expectedMode) {
    return { valid: false, reason: `mode must be "${expectedMode}", got "${output.mode}"` };
  }
  if (!Array.isArray(output.complianceFlags)) {
    return { valid: false, reason: 'complianceFlags must be an array' };
  }
  if (output.summary === null || typeof output.summary !== 'object') {
    return { valid: false, reason: 'summary must be an object' };
  }
  if (typeof output.summary.totalScanned !== 'number') {
    return { valid: false, reason: 'summary.totalScanned must be a number' };
  }
  if (typeof output.summary.flagged !== 'number') {
    return { valid: false, reason: 'summary.flagged must be a number' };
  }
  return { valid: true };
}

/**
 * Validates every flag in complianceFlags[].
 */
function validateFlags(flags, allowedStatuses) {
  const errors = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const loc = `complianceFlags[${i}]`;
    if (!f.frameworkCode || typeof f.frameworkCode !== 'string' || !f.frameworkCode.trim()) {
      errors.push(`${loc}.frameworkCode is missing or empty`);
    }
    if (!f.controlId || typeof f.controlId !== 'string' || !f.controlId.trim()) {
      errors.push(`${loc}.controlId is missing or empty`);
    }
    if (!SEVERITY_SET.has(f.severity)) {
      errors.push(`${loc}.severity "${f.severity}" is not one of: ${[...SEVERITY_SET].join(', ')}`);
    }
    if (!allowedStatuses.has(f.status)) {
      errors.push(`${loc}.status "${f.status}" is not in allowed set`);
    }
  }
  return errors;
}

/**
 * Simulate what the /srs command does with requirementUpdates[]:
 * merges complianceFrameworks back into a requirements array.
 */
function mergeComplianceUpdates(requirements, requirementUpdates) {
  const updateMap = {};
  for (const update of requirementUpdates) {
    updateMap[update.id] = update.complianceFrameworks || [];
  }

  return requirements.map(req => {
    if (!updateMap[req.id]) return req;
    const merged = [...new Set([...(req.complianceFrameworks || []), ...updateMap[req.id]])];
    return { ...req, complianceFrameworks: merged };
  });
}

/**
 * Simulate what the /srs command does with complianceFlags[]:
 * appends new flags to state.complianceFlags (deduplicating by controlId+triggeredBy).
 */
function mergeComplianceFlags(existingFlags, newFlags) {
  const existing = new Set(existingFlags.map(f => `${f.frameworkCode}:${f.controlId}:${f.triggeredBy}`));
  const result = [...existingFlags];
  for (const f of newFlags) {
    const key = `${f.frameworkCode}:${f.controlId}:${f.triggeredBy}`;
    if (!existing.has(key)) {
      result.push(f);
      existing.add(key);
    }
  }
  return result;
}

console.log('\n=== Compliance Checker Output Contract Tests ===\n');

let passed = 0;
let failed = 0;
function record(r) {
  if (r) passed++;
  else failed++;
}

const srsOutput = readJson(SRS_FIXTURE);
const fullOutput = readJson(FULL_FIXTURE);
const badOutput = readJson(BAD_FIXTURE);

// State fixture for integration tests
const STATE_FIXTURE = path.join(FIXTURES_DIR, 'state-with-valid-requirements.json');
const stateRequirements = readJson(STATE_FIXTURE).requirements;

// ---------------------------------------------------------------------------
// Unit 1 — valid srs mode fixture shape
// ---------------------------------------------------------------------------

record(
  test('Unit 1a: srs fixture has mode = "requirements"', () => {
    assert.strictEqual(srsOutput.mode, 'requirements');
  })
);

record(
  test('Unit 1b: srs fixture has complianceFlags array', () => {
    assert.ok(Array.isArray(srsOutput.complianceFlags));
    assert.ok(srsOutput.complianceFlags.length > 0, 'Expected at least one flag');
  })
);

record(
  test('Unit 1c: srs fixture has requirementUpdates array', () => {
    assert.ok(Array.isArray(srsOutput.requirementUpdates));
    assert.ok(srsOutput.requirementUpdates.length > 0, 'Expected at least one update');
  })
);

record(
  test('Unit 1d: srs fixture has summary with required keys', () => {
    const s = srsOutput.summary;
    assert.ok(s && typeof s === 'object');
    assert.ok(typeof s.totalScanned === 'number');
    assert.ok(typeof s.flagged === 'number');
    assert.ok(s.bySeverity && typeof s.bySeverity === 'object');
    assert.ok(s.byFramework && typeof s.byFramework === 'object');
  })
);

record(
  test('Unit 1e: validateShape passes for srs fixture', () => {
    const result = validateShape(srsOutput, 'requirements');
    assert.ok(result.valid, result.reason);
  })
);

// ---------------------------------------------------------------------------
// Unit 2 — valid full mode fixture shape
// ---------------------------------------------------------------------------

record(
  test('Unit 2a: full fixture has mode = "full"', () => {
    assert.strictEqual(fullOutput.mode, 'full');
  })
);

record(
  test('Unit 2b: full fixture has complianceMatrix array', () => {
    assert.ok(Array.isArray(fullOutput.complianceMatrix));
    assert.ok(fullOutput.complianceMatrix.length > 0, 'Expected at least one matrix entry');
  })
);

record(
  test('Unit 2c: full fixture has gapAnalysis object', () => {
    const g = fullOutput.gapAnalysis;
    assert.ok(g && typeof g === 'object');
    assert.ok(typeof g.totalControls === 'number');
    assert.ok(typeof g.compliant === 'number');
    assert.ok(typeof g.partial === 'number');
    assert.ok(typeof g.nonCompliant === 'number');
  })
);

record(
  test('Unit 2d: full fixture has summary with overallRiskLevel and recommendation', () => {
    const s = fullOutput.summary;
    assert.ok(typeof s.overallRiskLevel === 'string' && s.overallRiskLevel.length > 0);
    assert.ok(typeof s.recommendation === 'string' && s.recommendation.length > 0);
    assert.ok(Array.isArray(s.frameworksCovered) && s.frameworksCovered.length > 0);
  })
);

record(
  test('Unit 2e: validateShape passes for full fixture', () => {
    const result = validateShape(fullOutput, 'full');
    assert.ok(result.valid, result.reason);
  })
);

// ---------------------------------------------------------------------------
// Unit 3 — invalid fixture fails structural validation
// ---------------------------------------------------------------------------

record(
  test('Unit 3a: invalid fixture has empty controlId — caught by validateFlags', () => {
    const errors = validateFlags(badOutput.complianceFlags, new Set([SRS_STATUS, 'unknown-status']));
    const controlIdErrors = errors.filter(e => e.includes('controlId'));
    assert.ok(controlIdErrors.length > 0, `Expected controlId error, got: ${JSON.stringify(errors)}`);
  })
);

record(
  test('Unit 3b: invalid fixture has bad severity — caught by validateFlags', () => {
    const errors = validateFlags(badOutput.complianceFlags, new Set([SRS_STATUS, 'unknown-status']));
    const severityErrors = errors.filter(e => e.includes('severity'));
    assert.ok(severityErrors.length > 0, `Expected severity error, got: ${JSON.stringify(errors)}`);
  })
);

record(
  test('Unit 3c: invalid fixture summary.flagged exceeds actual flags (integrity check)', () => {
    // flagged says 5 but complianceFlags has 1 entry — mismatch
    assert.notStrictEqual(badOutput.summary.flagged, badOutput.complianceFlags.length, 'Expected flagged count to mismatch complianceFlags.length in invalid fixture');
  })
);

// ---------------------------------------------------------------------------
// Unit 4 — complianceFlags field rules
// ---------------------------------------------------------------------------

record(
  test('Unit 4a: all srs flags have non-empty frameworkCode', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(typeof f.frameworkCode === 'string' && f.frameworkCode.trim().length > 0, `frameworkCode empty on flag: ${JSON.stringify(f)}`);
    }
  })
);

record(
  test('Unit 4b: all srs flags have non-empty controlId', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(typeof f.controlId === 'string' && f.controlId.trim().length > 0, `controlId empty on flag: ${JSON.stringify(f)}`);
    }
  })
);

record(
  test('Unit 4c: all srs flags have valid severity', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(SEVERITY_SET.has(f.severity), `Invalid severity "${f.severity}" on flag ${f.controlId}`);
    }
  })
);

record(
  test('Unit 4d: all srs flags have non-empty keyword', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(typeof f.keyword === 'string' && f.keyword.trim().length > 0, `keyword empty on flag: ${f.controlId}`);
    }
  })
);

record(
  test('Unit 4e: all srs flags have requiredEvidence array', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(Array.isArray(f.requiredEvidence), `requiredEvidence not an array on flag: ${f.controlId}`);
    }
  })
);

record(
  test('Unit 4f: all srs flags have detectedAt string', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(typeof f.detectedAt === 'string' && f.detectedAt.length > 0, `detectedAt missing on flag: ${f.controlId}`);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 5 — requirementUpdates matches flagged requirements (srs mode)
// ---------------------------------------------------------------------------

record(
  test('Unit 5a: every requirementUpdates entry has an id', () => {
    for (const u of srsOutput.requirementUpdates) {
      assert.ok(typeof u.id === 'string' && u.id.length > 0, `requirementUpdates entry missing id: ${JSON.stringify(u)}`);
    }
  })
);

record(
  test('Unit 5b: every requirementUpdates entry has complianceFrameworks array', () => {
    for (const u of srsOutput.requirementUpdates) {
      assert.ok(Array.isArray(u.complianceFrameworks), `requirementUpdates entry missing complianceFrameworks: ${u.id}`);
      assert.ok(u.complianceFrameworks.length > 0, `requirementUpdates entry has empty complianceFrameworks: ${u.id}`);
    }
  })
);

record(
  test('Unit 5c: every triggered REQ-* has a corresponding requirementUpdates entry', () => {
    const updatedIds = new Set(srsOutput.requirementUpdates.map(u => u.id));
    for (const f of srsOutput.complianceFlags) {
      assert.ok(updatedIds.has(f.triggeredBy), `Flag triggered by ${f.triggeredBy} but no requirementUpdates entry for it`);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 6 — summary.bySeverity counts match actual flags
// ---------------------------------------------------------------------------

record(
  test('Unit 6: summary.bySeverity counts match actual complianceFlags severity distribution', () => {
    const actual = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of srsOutput.complianceFlags) {
      if (actual[f.severity] !== undefined) actual[f.severity]++;
    }
    const s = srsOutput.summary.bySeverity;
    assert.strictEqual(s.critical, actual.critical, `critical count mismatch: expected ${actual.critical}, got ${s.critical}`);
    assert.strictEqual(s.high, actual.high, `high count mismatch: expected ${actual.high}, got ${s.high}`);
    assert.strictEqual(s.medium, actual.medium, `medium count mismatch`);
    assert.strictEqual(s.low, actual.low, `low count mismatch`);
  })
);

// ---------------------------------------------------------------------------
// Unit 7 — summary.flagged matches complianceFlags.length
// ---------------------------------------------------------------------------

record(
  test('Unit 7: summary.flagged equals complianceFlags.length', () => {
    assert.strictEqual(srsOutput.summary.flagged, srsOutput.complianceFlags.length, `summary.flagged=${srsOutput.summary.flagged} but complianceFlags has ${srsOutput.complianceFlags.length} entries`);
  })
);

// ---------------------------------------------------------------------------
// Unit 8 — gapAnalysis counts match complianceMatrix (full mode)
// ---------------------------------------------------------------------------

record(
  test('Unit 8a: gapAnalysis.totalControls equals complianceMatrix.length', () => {
    assert.strictEqual(
      fullOutput.gapAnalysis.totalControls,
      fullOutput.complianceMatrix.length,
      `gapAnalysis.totalControls=${fullOutput.gapAnalysis.totalControls} but complianceMatrix has ${fullOutput.complianceMatrix.length} entries`
    );
  })
);

record(
  test('Unit 8b: gapAnalysis counts (compliant+partial+nonCompliant+notApplicable) sum to totalControls', () => {
    const g = fullOutput.gapAnalysis;
    const sum = g.compliant + g.partial + g.nonCompliant + (g.notApplicable || 0);
    assert.strictEqual(sum, g.totalControls, `counts sum to ${sum} but totalControls is ${g.totalControls}`);
  })
);

record(
  test('Unit 8c: compliant count matches matrix entries with status=compliant', () => {
    const actual = fullOutput.complianceMatrix.filter(e => e.status === 'compliant').length;
    assert.strictEqual(fullOutput.gapAnalysis.compliant, actual);
  })
);

record(
  test('Unit 8d: nonCompliant count matches matrix entries with status=non-compliant', () => {
    const actual = fullOutput.complianceMatrix.filter(e => e.status === 'non-compliant').length;
    assert.strictEqual(fullOutput.gapAnalysis.nonCompliant, actual);
  })
);

// ---------------------------------------------------------------------------
// Unit 9 — all triggeredBy values match REQ-* or DC-* pattern
// ---------------------------------------------------------------------------

const DC_PATTERN = /^DC-\d{3}$/;

record(
  test('Unit 9: srs mode triggeredBy values match REQ-* pattern', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.ok(REQ_PATTERN.test(f.triggeredBy), `triggeredBy "${f.triggeredBy}" does not match REQ-FUNC/NFUNC/CON-NNN`);
    }
  })
);

record(
  test('Unit 9b: full mode triggeredBy arrays contain valid REQ-* or DC-* IDs', () => {
    for (const e of fullOutput.complianceMatrix) {
      for (const id of e.triggeredBy) {
        const valid = REQ_PATTERN.test(id) || DC_PATTERN.test(id);
        assert.ok(valid, `triggeredBy "${id}" in ${e.controlId} is not a valid REQ-* or DC-*`);
      }
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 10 — no duplicate (controlId, triggeredBy) pairs in srs mode
// ---------------------------------------------------------------------------

record(
  test('Unit 10: no duplicate (frameworkCode, controlId, triggeredBy) pairs', () => {
    const seen = new Set();
    for (const f of srsOutput.complianceFlags) {
      const key = `${f.frameworkCode}:${f.controlId}:${f.triggeredBy}`;
      assert.ok(!seen.has(key), `Duplicate flag: ${key}`);
      seen.add(key);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 11 — srs mode: all statuses must be "pending-review"
// ---------------------------------------------------------------------------

record(
  test('Unit 11: all srs mode flags have status="pending-review"', () => {
    for (const f of srsOutput.complianceFlags) {
      assert.strictEqual(f.status, SRS_STATUS, `Flag ${f.controlId} has status "${f.status}", expected "pending-review" in srs mode`);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 12 — full mode: status values from allowed set
// ---------------------------------------------------------------------------

record(
  test('Unit 12: all full mode matrix entries have valid status', () => {
    for (const e of fullOutput.complianceMatrix) {
      assert.ok(FULL_STATUS.has(e.status), `complianceMatrix entry ${e.controlId} has invalid status "${e.status}"`);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 13 — full mode: criticalGaps only contain critical severity
// ---------------------------------------------------------------------------

record(
  test('Unit 13: all criticalGaps entries have severity="critical"', () => {
    for (const g of fullOutput.criticalGaps) {
      assert.strictEqual(g.severity, 'critical', `criticalGaps entry ${g.controlId} has severity "${g.severity}", not "critical"`);
    }
  })
);

record(
  test('Unit 13b: criticalGaps count matches matrix entries with critical severity and gaps', () => {
    const actualCritical = fullOutput.complianceMatrix.filter(e => e.severity === 'critical' && Array.isArray(e.gaps) && e.gaps.length > 0).length;
    assert.strictEqual(fullOutput.criticalGaps.length, actualCritical, `criticalGaps has ${fullOutput.criticalGaps.length} entries but ${actualCritical} matrix entries qualify`);
  })
);

// ---------------------------------------------------------------------------
// Unit 14 — full mode: compliant controls have empty gaps[]
// ---------------------------------------------------------------------------

record(
  test('Unit 14: compliant matrix entries have empty gaps[]', () => {
    const compliant = fullOutput.complianceMatrix.filter(e => e.status === 'compliant');
    for (const e of compliant) {
      assert.ok(Array.isArray(e.gaps) && e.gaps.length === 0, `Compliant entry ${e.controlId} has non-empty gaps: ${JSON.stringify(e.gaps)}`);
    }
  })
);

// ---------------------------------------------------------------------------
// Unit 15 — full mode: non-compliant controls have empty evidenceFound[]
// ---------------------------------------------------------------------------

record(
  test('Unit 15: non-compliant matrix entries have empty evidenceFound[]', () => {
    const nonCompliant = fullOutput.complianceMatrix.filter(e => e.status === 'non-compliant');
    for (const e of nonCompliant) {
      assert.ok(Array.isArray(e.evidenceFound) && e.evidenceFound.length === 0, `Non-compliant entry ${e.controlId} has evidenceFound: ${JSON.stringify(e.evidenceFound)}`);
    }
  })
);

// ---------------------------------------------------------------------------
// Integration 1 — mergeComplianceUpdates adds frameworks to requirements
// ---------------------------------------------------------------------------

record(
  test('Integration 1a: mergeComplianceUpdates adds frameworks to flagged requirements', () => {
    const updated = mergeComplianceUpdates(stateRequirements, srsOutput.requirementUpdates);

    // REQ-FUNC-001 should now have SBP-2024 (it was already there in fixture — stays)
    const func001 = updated.find(r => r.id === 'REQ-FUNC-001');
    assert.ok(func001, 'REQ-FUNC-001 not found after merge');
    assert.ok(func001.complianceFrameworks.includes('SBP-2024'), `REQ-FUNC-001 should have SBP-2024, got: ${JSON.stringify(func001.complianceFrameworks)}`);
  })
);

record(
  test('Integration 1b: mergeComplianceUpdates does not modify unflagged requirements', () => {
    const updated = mergeComplianceUpdates(stateRequirements, srsOutput.requirementUpdates);
    const func002 = updated.find(r => r.id === 'REQ-FUNC-002');
    assert.ok(func002, 'REQ-FUNC-002 not found after merge');
    // REQ-FUNC-002 is not in requirementUpdates — should be unchanged
    const original = stateRequirements.find(r => r.id === 'REQ-FUNC-002');
    assert.deepStrictEqual(func002.complianceFrameworks, original.complianceFrameworks, 'Unflagged requirement should not be modified');
  })
);

record(
  test('Integration 1c: mergeComplianceUpdates deduplicates frameworks', () => {
    // REQ-FUNC-001 already has SBP-2024 in the fixture — merging again should not duplicate
    const updated = mergeComplianceUpdates(stateRequirements, srsOutput.requirementUpdates);
    const func001 = updated.find(r => r.id === 'REQ-FUNC-001');
    const sbpCount = func001.complianceFrameworks.filter(f => f === 'SBP-2024').length;
    assert.strictEqual(sbpCount, 1, `SBP-2024 should appear exactly once, got ${sbpCount} times`);
  })
);

// ---------------------------------------------------------------------------
// Integration 2 — mergeComplianceFlags appends without duplicating
// ---------------------------------------------------------------------------

record(
  test('Integration 2a: mergeComplianceFlags appends new flags to empty state', () => {
    const result = mergeComplianceFlags([], srsOutput.complianceFlags);
    assert.strictEqual(result.length, srsOutput.complianceFlags.length);
  })
);

record(
  test('Integration 2b: mergeComplianceFlags does not duplicate existing flags', () => {
    // First merge
    const firstPass = mergeComplianceFlags([], srsOutput.complianceFlags);
    // Second merge with same flags — should not add duplicates
    const secondPass = mergeComplianceFlags(firstPass, srsOutput.complianceFlags);
    assert.strictEqual(secondPass.length, firstPass.length, `Expected no new flags added, but length grew from ${firstPass.length} to ${secondPass.length}`);
  })
);

record(
  test('Integration 2c: mergeComplianceFlags preserves existing flags and appends new ones', () => {
    const existing = [srsOutput.complianceFlags[0]];
    const newFlag = { ...srsOutput.complianceFlags[1] }; // already unique key
    const result = mergeComplianceFlags(existing, [newFlag]);
    assert.strictEqual(result.length, 2, `Expected 2 flags after merge, got ${result.length}`);
  })
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
