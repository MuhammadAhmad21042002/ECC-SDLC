'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const os           = require('os');

// ─── Test runner ──────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runStatus(stateData, opts = {}) {
  const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-status-'));
  const sdlcDir   = path.join(tmpDir, '.sdlc');
  const statePath = path.join(sdlcDir, 'state.json');

  fs.mkdirSync(sdlcDir);

  if (opts.malformed) {
    fs.writeFileSync(statePath, '{ invalid json }');
  } else if (stateData !== null) {
    fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));
  }

  const stateBefore = (stateData !== null && !opts.malformed)
    ? Buffer.from(fs.readFileSync(statePath))
    : null;

  const scriptPath = path.join(tmpDir, 'run.js');
  fs.writeFileSync(scriptPath, buildScript());

  let output = '';
  try {
    output = execSync(`node "${scriptPath}"`, {
      cwd     : tmpDir,
      encoding: 'utf8',
      timeout : 5000,
    });
  } catch (err) {
    output = (err.stdout || '') + (err.stderr || '');
  }

  if (stateBefore !== null) {
    const stateAfter = fs.readFileSync(statePath);
    assert(stateBefore.equals(stateAfter), 'state.json was modified');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { output };
}

// ─── Script Builder ───────────────────────────────────────────────────────────

function buildScript() {
  return `
const fs = require('fs');
const statePath = '.sdlc/state.json';

if (!fs.existsSync(statePath)) {
  const line = '━'.repeat(46);
  console.log(line);
  console.log('  ECC-SDLC Project Status');
  console.log(line);
  console.log('  Phase: not started');
  console.log('');
  console.log('  No project found in this directory.');
  console.log('  Run /scope to initialize a new project and');
  console.log('  generate the first scope document.');
  console.log(line);
  process.exit(0);
}

let s;
try {
  s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (e) {
  console.log('ERROR: .sdlc/state.json exists but could not be parsed.');
  process.exit(1);
}

const line = '━'.repeat(50);
console.log(line);
console.log('  ECC-SDLC Project Status');
console.log(line);
console.log('  Project : ' + (s.projectName || 'Unknown'));
console.log('  Client  : ' + (s.clientName  || 'Unknown'));
console.log('  Phase   : ' + (s.currentPhase || 'not started'));
console.log('');

// ─── Artifacts ───────────────────────────────────────────────────────────────
console.log('  Artifacts:');
const keys = ['scope','srs','sds','sts','estimate','proposal'];
for (const key of keys) {
  const a = s.artifacts && s.artifacts[key];
  if (a && a.path) {
    let shortHash = 'no hash';
    if (a.hash) {
      const raw = a.hash.replace('sha256:', '');
      shortHash = 'sha256:' + raw.substring(0, 8) + '...';
    }
    console.log('    ' + key.padEnd(10) + ' v' + a.version + '  ' + shortHash);
  } else {
    console.log('    ' + key.padEnd(10) + ' ✗ not generated');
  }
}
console.log('');

// ─── Requirements ────────────────────────────────────────────────────────────
const reqs = Array.isArray(s.requirements) ? s.requirements : [];
const func  = reqs.filter(r => r.type === 'functional').length;
const nfunc = reqs.filter(r => r.type === 'non-functional').length;
const con   = reqs.filter(r => r.type === 'constraint').length;

console.log('  Requirements: ' + reqs.length + ' total');
console.log('    REQ-FUNC  : ' + func);
console.log('    REQ-NFUNC : ' + nfunc);
console.log('    REQ-CON   : ' + con);

const must   = reqs.filter(r => r.priority === 'must').length;
const should = reqs.filter(r => r.priority === 'should').length;
const could  = reqs.filter(r => r.priority === 'could').length;
const wont   = reqs.filter(r => r.priority === 'wont').length;

console.log('    Must/Should/Could/Wont: ' + must + '/' + should + '/' + could + '/' + wont);
console.log('');

// ─── Compliance ──────────────────────────────────────────────────────────────
const flags = Array.isArray(s.complianceFlags) ? s.complianceFlags : [];

if (flags.length === 0) {
  console.log('  Compliance: not yet run — execute /compliance first');
} else {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of flags) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  console.log(
    '  Compliance: ' +
    'critical ' + counts.critical + ' | ' +
    'high ' + counts.high + ' | ' +
    'medium ' + counts.medium + ' | ' +
    'low ' + counts.low
  );
}
console.log('');

// ─── Traceability ────────────────────────────────────────────────────────────
const hasTrace = reqs.some(r => r.traceForward);

if (reqs.length === 0 || !hasTrace) {
  console.log('  Traceability: not yet run — execute /traceability first');
} else {
  const full = reqs.filter(r =>
    r.traceForward &&
    Array.isArray(r.traceForward.designComponentIds) && r.traceForward.designComponentIds.length > 0 &&
    Array.isArray(r.traceForward.testCaseIds) && r.traceForward.testCaseIds.length > 0 &&
    Array.isArray(r.traceForward.costLineItemIds) && r.traceForward.costLineItemIds.length > 0
  ).length;

  const pct = ((full / reqs.length) * 100).toFixed(1);
  console.log('  Traceability: ' + pct + '%');
}
console.log('');
`;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STATE = {
  projectName : 'Test Project',
  clientName  : 'Test Client',
  currentPhase: 'design',
  artifacts: {
    scope    : { path: 'x', version: 1, hash: 'sha256:abcdef1234567890' },
    srs      : null,
    sds      : null,
    sts      : null,
    estimate : null,
    proposal : null,
  },
  requirements: [
    { type: 'functional', priority: 'must', traceForward: { designComponentIds: ['1'], testCaseIds: ['1'], costLineItemIds: ['1'] } },
    { type: 'functional', priority: 'must', traceForward: { designComponentIds: [],    testCaseIds: [],    costLineItemIds: []    } },
  ],
  complianceFlags: [
    { severity: 'critical' },
    { severity: 'high' },
    { severity: 'high' },
  ],
  phaseHistory: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n/sdlc-status Tests (Sprint 2)\n');

test('short SHA-256 hash displayed', () => {
  const { output } = runStatus(STATE);
  assert(/sha256:abcdef12\.\.\./i.test(output), output);
});

test('compliance grouped correctly', () => {
  const { output } = runStatus(STATE);
  assert(/critical 1 \| high 2 \| medium 0 \| low 0/i.test(output), output);
});

test('compliance not yet run when empty', () => {
  const s = { ...STATE, complianceFlags: [] };
  const { output } = runStatus(s);
  assert(/not yet run.*compliance/i.test(output), output);
});

test('traceability percentage correct (50.0%)', () => {
  const { output } = runStatus(STATE);
  assert(/50\.0%/.test(output), output);
});

test('traceability not yet run when missing', () => {
  const s = { ...STATE, requirements: [] };
  const { output } = runStatus(s);
  assert(/not yet run.*traceability/i.test(output), output);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;