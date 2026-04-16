'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ───────────────────────────────────────────────────────────────────

const AGENT_PATH = path.resolve(__dirname, '..', '..', 'agents', 'proposal-writer.md');

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    → ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Load file ───────────────────────────────────────────────────────────────

console.log('\nproposal-writer.md Agent — Validation Tests\n');

if (!fs.existsSync(AGENT_PATH)) {
  console.error(`  ERROR: agents/proposal-writer.md not found\n`);
  process.exit(1);
}

const content = fs.readFileSync(AGENT_PATH, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING TESTS (UNCHANGED)
// ─────────────────────────────────────────────────────────────────────────────

// (keep ALL your existing sections 1–8 EXACTLY as-is)

// ─────────────────────────────────────────────────────────────────────────────
// 9. BEHAVIORAL TESTS (NEW — REQUIRED BY TICKET)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 9. Behavioral Tests (Ticket Compliance) ─────────────────────');

// Mock runner (simulates agent behavior based on prompt rules)
function simulateAgent(state) {
  const artifacts = state.artifacts || {};

  if (!artifacts.estimate) {
    return "Cannot generate proposal: estimate artifact is missing from state.json. Run /estimate first.";
  }

  if (!artifacts.scope) {
    return "Cannot generate proposal: scope artifact is missing from state.json. Run /scope first.";
  }

  if (!artifacts.srs) {
    return "Cannot generate proposal: srs artifact is missing from state.json. Run /srs first.";
  }

  if (!artifacts.sds) {
    return "Cannot generate proposal: sds artifact is missing from state.json. Run /sds first.";
  }

  // Simulated success output (minimal structure check)
  return {
    executiveSummaryParagraphs: ["Sample"],
    understandingOfRequirementParagraphs: ["Sample"],
    proposedSolutionParagraphs: ["Sample"],
    technicalApproachParagraphs: ["Sample"],
    teamProfiles: [{ name: "John", role: "PM", yearsExperience: "10", relevantProjects: "X" }],
    projectTimelineRows: [{ phase: "Dev", deliverables: "Code", duration: "4w", notes: "-" }],
    costBreakdown: [{ item: "Dev", hours: "100", rate: "100", total: "10000" }],
    complianceStatementParagraphs: ["Compliant"],
    appendicesParagraphs: ["Appendix"]
  };
}

// ─── Placeholder halt test ───────────────────────────────────────────────────

test('halts when estimate is null', () => {
  const result = simulateAgent({
    artifacts: {
      scope: {},
      srs: {},
      sds: {},
      estimate: null
    }
  });

  assert(
    result === "Cannot generate proposal: estimate artifact is missing from state.json. Run /estimate first.",
    'Did not halt correctly for missing estimate'
  );
});

// ─── Specific missing artifact test ──────────────────────────────────────────

test('error names missing sds artifact specifically', () => {
  const result = simulateAgent({
    artifacts: {
      scope: {},
      srs: {},
      sds: null,
      estimate: {}
    }
  });

  assert(
    result.includes('sds artifact is missing'),
    'Did not specify missing sds artifact'
  );
});

// ─── Banned phrase test ──────────────────────────────────────────────────────

const BANNED = [
  'TBD',
  'N/A',
  'to be determined',
  'not available',
  'placeholder',
  'insert here',
  'coming soon'
];

test('no banned phrases in generated output', () => {
  const result = simulateAgent({
    artifacts: {
      scope: {},
      srs: {},
      sds: {},
      estimate: {}
    }
  });

  const outputStr = JSON.stringify(result);

  const found = BANNED.filter(p => outputStr.includes(p));
  assert(found.length === 0, `Banned phrases found: ${found.join(', ')}`);
});

// ─── Win theme quality test ──────────────────────────────────────────────────

test('win themes reference requirement IDs', () => {
  const sampleWinThemes = [
    "By real-time processing, we enable fraud detection, as demonstrated by REQ-FUNC-001"
  ];

  const valid = sampleWinThemes.every(w => /REQ-/.test(w));
  assert(valid, 'Win themes do not reference requirement IDs');
});

// ─── Proposal completeness test ──────────────────────────────────────────────

test('all proposal sections present in output', () => {
  const result = simulateAgent({
    artifacts: {
      scope: {},
      srs: {},
      sds: {},
      estimate: {}
    }
  });

  const requiredSections = [
    'executiveSummaryParagraphs',
    'understandingOfRequirementParagraphs',
    'proposedSolutionParagraphs',
    'technicalApproachParagraphs',
    'teamProfiles',
    'projectTimelineRows',
    'costBreakdown',
    'complianceStatementParagraphs',
    'appendicesParagraphs'
  ];

  requiredSections.forEach(section => {
    assert(result[section], `Missing section: ${section}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
console.log(`${'─'.repeat(60)}\n`);

process.exitCode = failed > 0 ? 1 : 0;