'use strict';

/**
 * sds-doc.js — diagram pipeline + docx generation for SDS.
 *
 * UC diagram priority:
 *   1. SRS pre-rendered PNGs from .sdlc/artifacts/diagrams/srs/ (if available)
 *      → loaded from state.json.artifacts.srs.diagrams, keyed by uc-FEAT-NN
 *      → SKIPS re-rendering entirely (faster, consistent images)
 *   2. Fresh render via buildSdsDiagrams (fallback when SRS run hasn't happened)
 */

const path = require('path');
const { generateFromTemplate } = require('./generic-doc');
const { buildSdsRenderData } = require('./sds-render-data');
const { buildSdsDiagrams, saveDiagramsToDisk } = require('./mermaid-generator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getDims(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return null;
  try {
    const sharp = require('sharp');
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) return { w: meta.width, h: meta.height };
  } catch {
    /* no sharp */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Load SRS pre-rendered UC PNGs from disk
// Returns an ordered array of { title, png, dims } from state.json.artifacts.srs.diagrams
// Keys are 'uc-FEAT-01', 'uc-FEAT-02' etc. — sorted numerically.
// Returns null if not available.
// ---------------------------------------------------------------------------

async function loadSrsUcDiagramsOrdered(statePath) {
  if (!statePath) return null;
  try {
    const fs = require('fs');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const srsDiagrams = state?.artifacts?.srs?.diagrams;
    if (!srsDiagrams || typeof srsDiagrams !== 'object') return null;

    // Get only uc-* entries, sorted numerically (uc-FEAT-01 before uc-FEAT-02)
    const ucEntries = Object.entries(srsDiagrams)
      .filter(([key]) => key.startsWith('uc-'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    if (ucEntries.length === 0) return null;

    const results = [];
    for (const [key, fpath] of ucEntries) {
      try {
        const fs2 = require('fs');
        const png = fs2.readFileSync(fpath);
        const dims = await getDims(png);
        // title = the feature label, e.g. "uc-FEAT-01" → "FEAT-01"
        const title = key.replace(/^uc-/, '');
        results.push({ title, png, dims });
      } catch {
        /* file missing — skip */
      }
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function generateSdsDocument(sdsData, outputPath, templatePath, options) {
  const resolvedTemplate = templatePath || path.join(__dirname, '..', '..', 'templates', 'sds-template.json');

  const data = buildSdsRenderData(sdsData || {});

  // ── Try to load SRS UC diagrams before running the full diagram pipeline ──
  const statePath = sdsData && sdsData._statePath;
  const srsUcDiagrams = await loadSrsUcDiagramsOrdered(statePath);

  if (srsUcDiagrams && srsUcDiagrams.length > 0) {
    process.stderr.write(`[ECC-SDLC][SDS] Using ${srsUcDiagrams.length} SRS UC diagram(s) — skipping re-render\n`);
    // Replace the structured useCaseDiagrams with the pre-rendered SRS PNGs directly.
    // The useCaseDiagrams section renderer in generic-doc just needs { title, png, dims }.
    data.useCaseDiagrams = srsUcDiagrams;
    data.useCasePng = srsUcDiagrams[0]?.png || null;
    data.useCaseDims = srsUcDiagrams[0]?.dims || null;
  }

  // ── Run main diagram pipeline (all diagrams except UC if SRS PNGs available) ─
  let diagrams = {};
  try {
    // If SRS UC diagrams loaded, temporarily clear useCaseDiagrams so
    // buildSdsDiagrams doesn't waste time re-rendering them.
    const savedUcDiagrams = data.useCaseDiagrams;
    if (srsUcDiagrams && srsUcDiagrams.length > 0) {
      data.useCaseDiagrams = []; // prevent re-render
    }

    diagrams = await buildSdsDiagrams(data);

    // Restore
    data.useCaseDiagrams = savedUcDiagrams;

    data.architecturePng = diagrams.architecturePng || null;
    data.architectureDims = diagrams.architectureDims || null;
    data.erDiagramPng = diagrams.erDiagramPng || null;
    data.erDiagramDims = diagrams.erDiagramDims || null;
    data.dataFlowPng = diagrams.dataFlowPng || null;
    data.dataFlowDims = diagrams.dataFlowDims || null;
    data.networkPng = diagrams.networkPng || null;
    data.networkDims = diagrams.networkDims || null;
    data.flowchartPng = diagrams.flowchartPng || null;
    data.flowchartDims = diagrams.flowchartDims || null;
    data.deploymentPng = diagrams.deploymentPng || null;
    data.deploymentDims = diagrams.deploymentDims || null;

    // ── UC diagrams: use SRS PNGs if loaded, otherwise use fresh render ──────
    if (srsUcDiagrams && srsUcDiagrams.length > 0) {
      // Already set above — SRS PNGs are used as-is
      // ALSO inject into diagrams.ucPngsWithDims so saveDiagramsToDisk writes
      // use-case-*.png to .sdlc/artifacts/diagrams/ for /proposal to pick up
      diagrams.ucPngsWithDims = srsUcDiagrams.map(d => ({ png: d.png, dims: d.dims }));
      process.stderr.write(`[ECC-SDLC][SDS] UC: ${srsUcDiagrams.length} SRS diagrams injected + queued for disk save\n`);
    } else {
      // No SRS PNGs — fall back to fresh render from buildSdsDiagrams
      const ucPngs = diagrams.ucPngsWithDims || [];
      if (Array.isArray(data.useCaseDiagrams)) {
        data.useCaseDiagrams = await Promise.all(
          data.useCaseDiagrams.map(async (diag, i) => ({
            ...diag,
            png: ucPngs[i]?.png || null,
            dims: ucPngs[i]?.dims || null
          }))
        );
      }
      data.useCasePng = ucPngs[0]?.png || null;
      data.useCaseDims = ucPngs[0]?.dims || null;
      const ucOk = (data.useCaseDiagrams || []).filter(d => d?.png).length;
      process.stderr.write(`[ECC-SDLC][SDS] UC: ${ucOk}/${(data.useCaseDiagrams || []).length} freshly rendered\n`);
    }

    // ── Sequence diagrams ────────────────────────────────────────────────────
    const seqPngs = diagrams.seqPngsWithDims || [];
    if (Array.isArray(data.sequenceDiagrams)) {
      data.sequenceDiagrams = data.sequenceDiagrams.map((diag, i) => ({
        ...diag,
        png: seqPngs[i]?.png || null,
        dims: seqPngs[i]?.dims || null
      }));
    }
    data.sequencePng = seqPngs[0]?.png || null;
    data.sequenceDims = seqPngs[0]?.dims || null;
    const seqOk = seqPngs.filter(s => s?.png).length;
    process.stderr.write(`[ECC-SDLC][SDS] Seq: ${seqOk}/${seqPngs.length}\n`);
  } catch (err) {
    process.stderr.write(`[ECC-SDLC][SDS] Diagram generation error: ${err.message}\n`);
  }

  // ── Save all PNGs to disk for /proposal reuse ─────────────────────────────
  let savedDiagramPaths = {};
  try {
    const projectRoot = (options && options.projectRoot) || path.resolve(outputPath, '..', '..', '..');
    savedDiagramPaths = await saveDiagramsToDisk(diagrams, projectRoot);
    process.stderr.write(`[ECC-SDLC][SDS] Saved ${Object.keys(savedDiagramPaths).length} diagram(s)\n`);
  } catch (e) {
    process.stderr.write(`[ECC-SDLC][SDS] Diagram save warning: ${e.message}\n`);
  }

  const docPath = await generateFromTemplate({ templatePath: resolvedTemplate, data, outputPath });
  return { docPath, savedDiagramPaths };
}

module.exports = { generateSdsDocument };
