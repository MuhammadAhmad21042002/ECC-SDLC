const fs = require('fs');
const path = require('path');

const SDLC_DIR = '.sdlc';
const STATE_FILE = 'state.json';
const LOG_FILE = 'sessions.log';

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function loadState(projectRoot) {
  const statePath = path.join(projectRoot, SDLC_DIR, STATE_FILE);
  if (!fs.existsSync(statePath)) return { state: null, statePath };
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return { state: JSON.parse(raw), statePath };
  } catch (err) {
    return { state: null, statePath, error: err };
  }
}

function artifactExists(projectRoot, artifact) {
  if (!artifact || typeof artifact !== 'object') return false;
  const p = typeof artifact.path === 'string' ? artifact.path : '';
  if (!p) return false;
  const resolved = path.isAbsolute(p) ? p : path.join(projectRoot, p);
  return fs.existsSync(resolved);
}

function resolveArtifactPath(projectRoot, artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const p = typeof artifact.path === 'string' ? artifact.path : '';
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(projectRoot, p);
}

function appendSessionsLog(projectRoot, entry) {
  try {
    const logPath = path.join(projectRoot, SDLC_DIR, LOG_FILE);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Never block the session if logging fails.
  }
}

function getMissingForPhase(projectRoot, state, targetPhase) {
  const artifacts = (state && state.artifacts) || {};
  const hasScope = artifactExists(projectRoot, artifacts.scope);
  const hasSrs = artifactExists(projectRoot, artifacts.srs);
  const hasSds = artifactExists(projectRoot, artifacts.sds);
  const hasSts = artifactExists(projectRoot, artifacts.sts);
  const hasEstimate = artifactExists(projectRoot, artifacts.estimate);
  const hasProposal = artifactExists(projectRoot, artifacts.proposal);

  // Minimal prerequisite chain per technical doc:
  // scope -> srs -> sds -> sts -> estimate -> proposal
  const missing = [];
  if (targetPhase === 'requirements' && !hasScope) missing.push('scope');
  if (targetPhase === 'design' && !hasSrs) missing.push('srs');
  if (targetPhase === 'test-planning' && !hasSds) missing.push('sds');
  if (targetPhase === 'estimation' && !hasSts) missing.push('sts');
  if (targetPhase === 'proposal' && !hasEstimate) missing.push('estimate');
  if (targetPhase === 'compliance' && !hasSrs) missing.push('srs');
  if (targetPhase === 'handoff') {
    if (!hasScope) missing.push('scope');
    if (!hasSrs) missing.push('srs');
    if (!hasSds) missing.push('sds');
    if (!hasSts) missing.push('sts');
    if (!hasEstimate) missing.push('estimate');
    if (!hasProposal) missing.push('proposal');
  }

  return missing;
}

function log(line) {
  process.stderr.write(`[ECC-SDLC][phase-gate] ${line}\n`);
}

function main() {
  const raw = readStdin();
  const payload = safeJsonParse(raw);

  // If Claude Code provides a cwd/project root in payload, prefer it; otherwise use process.cwd().
  const projectRoot = (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) || process.cwd();

  const bypass = String(process.env.ECC_PHASE_GATE_BYPASS || '').toLowerCase() === 'true';
  const enabledRaw =
    process.env.ECC_PHASE_GATE_ENABLED ??
    process.env.ECC_PHASE_GATE_ON ??
    process.env.ECC_PHASE_GATE ??
    '';

  const enabled = String(enabledRaw).trim().toLowerCase();
  const modeFromToggle =
    enabled === 'on' || enabled === 'true' || enabled === '1'
      ? 'enforcing'
      : enabled === 'off' || enabled === 'false' || enabled === '0'
        ? 'logging'
        : null;

  const mode = String(modeFromToggle || process.env.ECC_PHASE_GATE_MODE || 'logging').toLowerCase(); // logging | enforcing

  const { state, statePath, error } = loadState(projectRoot);
  if (error) {
    log(`WARNING: failed to parse state at ${statePath}: ${error.message}`);
    process.exit(0);
  }

  if (!state) {
    log(`INFO: no state found at ${statePath}. Logging-only mode; nothing to enforce.`);
    process.exit(0);
  }

  const currentPhase = typeof state.currentPhase === 'string' ? state.currentPhase : 'unknown';
  log(`mode=${mode} currentPhase=${currentPhase}`);

  if (bypass) {
    log('BYPASS enabled via ECC_PHASE_GATE_BYPASS=true — allowing operation');
    appendSessionsLog(projectRoot, {
      type: 'phase-gate',
      mode,
      bypass: true,
      timestamp: new Date().toISOString(),
      currentPhase,
      result: 'allowed',
      reason: 'bypass',
    });
    process.exit(0);
  }

  // Detect missing-on-disk registered artifacts (critical error per rules).
  const artifacts = (state && state.artifacts) || {};
  const registeredKeys = ['scope', 'srs', 'sds', 'sts', 'estimate', 'proposal'];
  for (const key of registeredKeys) {
    const artifact = artifacts[key];
    if (!artifact || !artifact.path) continue;
    const fullPath = resolveArtifactPath(projectRoot, artifact);
    if (!fullPath || !fs.existsSync(fullPath)) {
      const msg = `SDLC:ERROR:ARTIFACT_MISSING — ${key} registered at ${artifact.path} not found on disk. Re-run /${key} to regenerate it before continuing.`;
      log(msg);
      appendSessionsLog(projectRoot, {
        type: 'phase-gate',
        mode,
        bypass: false,
        timestamp: new Date().toISOString(),
        currentPhase,
        result: mode === 'enforcing' ? 'blocked' : 'would-block',
        reason: 'artifact-missing',
        artifact: { key, path: artifact.path },
      });
      if (mode === 'enforcing') {
        process.exit(2);
      }
      // In logging mode, keep going.
    }
  }

  // Compute what *would* be blocked if user tries to progress.
  const phases = ['requirements', 'design', 'test-planning', 'estimation', 'compliance', 'proposal', 'handoff'];
  for (const phase of phases) {
    const missing = getMissingForPhase(projectRoot, state, phase);
    if (missing.length > 0) {
      log(`WOULD_BLOCK phase=${phase} missingArtifacts=${missing.join(',')}`);
    }
  }

  // Enforcing behavior: block writes when the *current* phase prerequisites are not met.
  // This matches the "no phase can begin until prerequisites are complete" rule.
  const missingForCurrent = getMissingForPhase(projectRoot, state, currentPhase);
  if (missingForCurrent.length > 0) {
    const msg =
      mode === 'enforcing'
        ? `SDLC:GATE:BLOCKED — phase=${currentPhase} missingArtifacts=${missingForCurrent.join(',')}`
        : `SDLC:GATE:WOULD_BLOCK — phase=${currentPhase} missingArtifacts=${missingForCurrent.join(',')}`;
    log(msg);
    appendSessionsLog(projectRoot, {
      type: 'phase-gate',
      mode,
      bypass: false,
      timestamp: new Date().toISOString(),
      currentPhase,
      result: mode === 'enforcing' ? 'blocked' : 'would-block',
      reason: 'missing-prerequisites',
      missingArtifacts: missingForCurrent,
    });
    if (mode === 'enforcing') {
      process.exit(2);
    }

    // In logging mode, allow operation, but don't emit an additional "allowed" log entry.
    process.exit(0);
  }

  appendSessionsLog(projectRoot, {
    type: 'phase-gate',
    mode,
    bypass: false,
    timestamp: new Date().toISOString(),
    currentPhase,
    result: 'allowed',
  });

  process.exit(0);
}

main();
