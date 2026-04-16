'use strict';

/**
 * proposal-doc.js
 *
 * Generates the proposal .docx.
 *
 * Diagram loading priority (same pattern as srs-doc.js and sds-doc.js):
 *   1. Read saved paths from state.json.artifacts.sds.diagrams → load PNG from disk
 *   2. Scan .sdlc/artifacts/diagrams/ folder directly (catches paths missing from state)
 *   3. Try SRS UC diagrams from state.json.artifacts.srs.diagrams for use-case slots
 *   4. Fallback: generate fresh diagram (architecture only, via mermaid-generator)
 *
 * All diagram types covered:
 *   Single slots : architecture, er-diagram, data-flow, network, flowchart, deployment
 *   Arrays       : sequence-0..N, use-case-0..N (or uc-FEAT-* from SRS)
 */

const fs = require('fs');
const path = require('path');
const { generateFromTemplate } = require('./generic-doc');
const { buildProposalRenderData } = require('./proposal-render-data');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPng(fpath) {
  if (!fpath || typeof fpath !== 'string') return null;
  try {
    return fs.readFileSync(fpath);
  } catch {
    return null;
  }
}

async function getDims(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return null;
  try {
    const sharp = require('sharp');
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) return { w: meta.width, h: meta.height };
  } catch {
    /* sharp unavailable */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolve diagrams folder from statePath
// ---------------------------------------------------------------------------
function diagramsDir(statePath) {
  // statePath = /project/.sdlc/state.json → dir = /project/.sdlc/artifacts/diagrams
  const sdlcDir = path.dirname(statePath);
  return path.join(sdlcDir, 'artifacts', 'diagrams');
}

// ---------------------------------------------------------------------------
// Load a PNG: try savedDiagrams path first, then scan diagrams folder by filename
// ---------------------------------------------------------------------------
function resolveOnePng(key, savedDiagrams, diagDir) {
  // 1. From state.json saved path
  const saved = savedDiagrams[key];
  if (saved) {
    const buf = loadPng(saved);
    if (buf) return buf;
  }
  // 2. Scan diagrams folder directly
  const candidate = path.join(diagDir, `${key}.png`);
  return loadPng(candidate);
}

// ---------------------------------------------------------------------------
// Load ordered array of PNGs (sequence-0, sequence-1... or use-case-0...)
// Falls back to scanning the diagrams folder if state paths are missing.
// ---------------------------------------------------------------------------
async function resolveArrayPngs(prefix, savedDiagrams, diagDir) {
  const results = [];

  // Collect from state keys
  const stateKeys = Object.keys(savedDiagrams)
    .filter(k => k.startsWith(prefix + '-'))
    .sort((a, b) => {
      const ai = parseInt(a.replace(prefix + '-', ''), 10);
      const bi = parseInt(b.replace(prefix + '-', ''), 10);
      return ai - bi;
    });

  if (stateKeys.length > 0) {
    for (const key of stateKeys) {
      const buf = loadPng(savedDiagrams[key]);
      if (buf) results.push({ key, png: buf });
    }
  }

  // If none from state, scan diagrams folder directly
  if (results.length === 0 && fs.existsSync(diagDir)) {
    try {
      const files = fs
        .readdirSync(diagDir)
        .filter(f => f.startsWith(prefix + '-') && f.endsWith('.png'))
        .sort((a, b) => {
          const ai = parseInt(a.replace(prefix + '-', '').replace('.png', ''), 10);
          const bi = parseInt(b.replace(prefix + '-', '').replace('.png', ''), 10);
          return ai - bi;
        });
      for (const fname of files) {
        const buf = loadPng(path.join(diagDir, fname));
        if (buf) results.push({ key: fname.replace('.png', ''), png: buf });
      }
    } catch {
      /* ignore */
    }
  }

  // Enrich with dims
  return Promise.all(
    results.map(async (r, i) => ({
      index: i,
      png: r.png,
      dims: await getDims(r.png)
    }))
  );
}

// ---------------------------------------------------------------------------
// Load SRS UC diagrams (uc-FEAT-*.png) as fallback for use-case slots
// ---------------------------------------------------------------------------
async function loadSrsUcDiagramsForProposal(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const srsDiagrams = state?.artifacts?.srs?.diagrams;
    if (!srsDiagrams || typeof srsDiagrams !== 'object') return [];

    const entries = Object.entries(srsDiagrams)
      .filter(([key]) => key.startsWith('uc-'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    const results = [];
    for (const [key, fpath] of entries) {
      const buf = loadPng(fpath);
      if (buf) results.push({ key, png: buf, dims: await getDims(buf) });
    }
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function generateProposalDoc(proposalData, outputPath, templatePath, options) {
  const resolvedTemplate = templatePath || path.join(__dirname, '..', '..', 'templates', 'proposal-template.json');

  // Build render data
  const data = buildProposalRenderData(proposalData || {});

  // Resolve state.json path and diagrams folder
  const statePath = (options && options.statePath) || path.resolve(outputPath, '..', '..', '..', '.sdlc', 'state.json');

  let savedDiagrams = {};
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    savedDiagrams = state?.artifacts?.sds?.diagrams || {};
  } catch {
    /* state.json not found */
  }

  const diagDir = diagramsDir(statePath);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] Diagrams folder: ${diagDir}\n`);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] State SDS diagram keys: ${Object.keys(savedDiagrams).join(', ') || 'none'}\n`);

  // ── Single-slot diagrams ─────────────────────────────────────────────────
  // All 6 slots: architecture, er-diagram, data-flow, network, flowchart, deployment
  const singleSlots = [
    ['architecture', 'architecturePng', 'architectureDims'],
    ['er-diagram', 'erDiagramPng', 'erDiagramDims'],
    ['data-flow', 'dataFlowPng', 'dataFlowDims'],
    ['network', 'networkPng', 'networkDims'],
    ['flowchart', 'flowchartPng', 'flowchartDims'],
    ['deployment', 'deploymentPng', 'deploymentDims']
  ];

  for (const [key, pngField, dimsField] of singleSlots) {
    if (data[pngField] && Buffer.isBuffer(data[pngField])) continue; // already set
    const buf = resolveOnePng(key, savedDiagrams, diagDir);
    if (buf) {
      data[pngField] = buf;
      data[dimsField] = await getDims(buf);
      process.stderr.write(`[ECC-SDLC][PROPOSAL] Loaded ${key}: ${buf.length}b\n`);
    } else {
      process.stderr.write(`[ECC-SDLC][PROPOSAL] MISSING ${key}\n`);
    }
  }

  // ── Architecture fallback: generate via mermaid if still missing ──────────
  if (!data.architecturePng && (data.architectureDiagramLines || []).length > 1) {
    try {
      const { mermaidToPng } = require('./mermaid-generator');
      const png = await mermaidToPng(data.architectureDiagramLines, { width: 1800 });
      if (png) {
        data.architecturePng = png;
        data.architectureDims = await getDims(png);
        process.stderr.write(`[ECC-SDLC][PROPOSAL] Architecture: generated fresh from Mermaid source\n`);
      }
    } catch {
      /* dagre not available */
    }
  }

  // ── Sequence diagrams ────────────────────────────────────────────────────
  const seqPngs = await resolveArrayPngs('sequence', savedDiagrams, diagDir);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] Sequence diagrams loaded: ${seqPngs.length}\n`);

  if (seqPngs.length > 0) {
    if (!Array.isArray(data.sequenceDiagrams) || data.sequenceDiagrams.length === 0) {
      // No titles from agent — use generic titles
      data.sequenceDiagrams = seqPngs.map((s, i) => ({
        title: `Sequence Diagram ${i + 1}`,
        png: s.png,
        dims: s.dims
      }));
    } else {
      // Inject PNGs into existing titled entries
      data.sequenceDiagrams = await Promise.all(
        data.sequenceDiagrams.map(async (diag, i) => {
          if (diag.png && Buffer.isBuffer(diag.png)) return diag;
          const s = seqPngs[i];
          return { ...diag, png: s?.png || null, dims: s?.dims || null };
        })
      );
      // If agent provided more titles than saved PNGs, trim to available
      data.sequenceDiagrams = data.sequenceDiagrams.filter(d => d.png);
    }
  }

  // ── Use case diagrams ─────────────────────────────────────────────────────
  // Priority: use-case-*.png from SDS diagrams folder → uc-FEAT-*.png from SRS folder
  let ucPngs = await resolveArrayPngs('use-case', savedDiagrams, diagDir);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] UC diagrams (SDS): ${ucPngs.length}\n`);

  if (ucPngs.length === 0) {
    // Fallback: load SRS per-feature UC diagrams
    const srsUc = await loadSrsUcDiagramsForProposal(statePath);
    process.stderr.write(`[ECC-SDLC][PROPOSAL] UC diagrams (SRS fallback): ${srsUc.length}\n`);
    ucPngs = srsUc.map((s, i) => ({ index: i, png: s.png, dims: s.dims, title: s.key.replace('uc-', '') }));
  }

  if (ucPngs.length > 0) {
    if (!Array.isArray(data.useCaseDiagrams) || data.useCaseDiagrams.length === 0) {
      data.useCaseDiagrams = ucPngs.map((s, i) => ({
        title: s.title || `Use Case Diagram ${i + 1}`,
        png: s.png,
        dims: s.dims
      }));
    } else {
      data.useCaseDiagrams = await Promise.all(
        data.useCaseDiagrams.map(async (diag, i) => {
          if (diag.png && Buffer.isBuffer(diag.png)) return diag;
          const s = ucPngs[i];
          return { ...diag, png: s?.png || null, dims: s?.dims || null };
        })
      );
      data.useCaseDiagrams = data.useCaseDiagrams.filter(d => d.png);
    }
  }

  // ── Summary log ──────────────────────────────────────────────────────────
  const loaded = singleSlots.filter(([, pf]) => data[pf] && Buffer.isBuffer(data[pf])).map(([k]) => k);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] Single diagrams: ${loaded.join(', ') || 'none'}\n`);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] Sequence: ${(data.sequenceDiagrams || []).filter(d => d.png).length}\n`);
  process.stderr.write(`[ECC-SDLC][PROPOSAL] UC: ${(data.useCaseDiagrams || []).filter(d => d.png).length}\n`);

  return generateFromTemplate({ templatePath: resolvedTemplate, data, outputPath });
}

module.exports = { generateProposalDoc };
