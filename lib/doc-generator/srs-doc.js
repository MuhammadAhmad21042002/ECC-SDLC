'use strict';

/**
 * srs-doc.js — diagram pipeline + docx generation for SRS.
 * Diagrams: Gantt (custom SVG→sharp PNG) + per-feature UC (SVG→sharp PNG)
 * Same async svgToPng pattern as sds-doc.js. No duplicate functions.
 */

const path = require('path');
const { generateFromTemplate, buildGanttSvg } = require('./generic-doc');
const { buildSrsRenderData } = require('./srs-render-data');

async function svgToPng(svgString, width) {
  if (!svgString) return null;
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.from(svgString, 'utf8');
    return width ? await sharp(buf).resize({ width, withoutEnlargement: false }).png().toBuffer() : await sharp(buf).png().toBuffer();
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
    /* no sharp */
  }
  return null;
}

async function buildFeatureUcDiagramsMap(useCases, systemFeatures) {
  const map = {};
  if (!Array.isArray(useCases) || useCases.length === 0) return map;
  let buildUseCaseSvg;
  try {
    buildUseCaseSvg = require('./sds-diagrams').buildUseCaseSvg;
  } catch {
    return map;
  }

  const featureNames = {};
  if (Array.isArray(systemFeatures)) {
    for (const f of systemFeatures) {
      if (f && f.featureId) featureNames[f.featureId] = f.name || f.featureId;
    }
  }

  const groups = {};
  for (const uc of useCases) {
    if (!uc) continue;
    const fid = uc.featureId && uc.featureId !== 'N/A' ? uc.featureId : 'GENERAL';
    if (!groups[fid]) groups[fid] = [];
    groups[fid].push(uc);
  }

  for (const [featureId, ucs] of Object.entries(groups)) {
    try {
      const actorMap = new Map();
      for (const uc of ucs) {
        if (uc.primaryActor && uc.primaryActor !== 'N/A' && !actorMap.has(uc.primaryActor)) actorMap.set(uc.primaryActor, `a${actorMap.size}`);
        if (Array.isArray(uc.secondaryActors)) {
          for (const sa of uc.secondaryActors) if (sa && sa !== 'N/A' && !actorMap.has(sa)) actorMap.set(sa, `a${actorMap.size}`);
        }
      }
      if (actorMap.size === 0) actorMap.set('Actor', 'a0');

      const actors = Array.from(actorMap.entries()).map(([name, id]) => ({ id, name }));
      const ucNodes = ucs.map(uc => ({ id: uc.id, name: uc.name || uc.id }));
      const associations = [];
      for (const uc of ucs) {
        // Primary actor → this UC
        const primaryId = uc.primaryActor && actorMap.has(uc.primaryActor) ? actorMap.get(uc.primaryActor) : actors[0].id;
        associations.push({ actorId: primaryId, useCaseId: uc.id });

        // Secondary actors → this UC (they appear on the right side)
        if (Array.isArray(uc.secondaryActors)) {
          for (const sa of uc.secondaryActors) {
            if (sa && sa !== 'N/A' && actorMap.has(sa)) {
              associations.push({ actorId: actorMap.get(sa), useCaseId: uc.id });
            }
          }
        }
      }
      const featureName = featureNames[featureId] || featureId;
      const svg = buildUseCaseSvg({
        title: `${featureId} — ${featureName}`,
        actors,
        useCases: ucNodes,
        associations,
        includes: [],
        extends: []
      });
      if (!svg) continue;
      const png = await svgToPng(svg, 1400);
      if (!png) continue;
      map[featureId] = { png, dims: await getDims(png), title: `${featureId} — ${featureName}`, ucIds: ucs.map(u => u.id) };
    } catch {
      /* skip */
    }
  }
  return map;
}

async function saveSrsDiagramsToDisk(ucDiagramsMap, ganttPng, projectRoot) {
  const fs = require('fs');
  const dir = path.join(projectRoot, '.sdlc', 'artifacts', 'diagrams', 'srs');
  fs.mkdirSync(dir, { recursive: true });

  // Remove stale UC diagram PNGs from previous runs (e.g. phantom FEAT-26+)
  // so the folder always reflects exactly what the current run produced.
  try {
    const existing = fs.readdirSync(dir).filter(f => f.startsWith('uc-') && f.endsWith('.png'));
    for (const stale of existing) {
      try {
        fs.unlinkSync(path.join(dir, stale));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  const saved = {};
  // Per-feature UC diagrams (keys = featureIds like FEAT-01)
  for (const [featureId, entry] of Object.entries(ucDiagramsMap || {})) {
    if (!entry?.png || !Buffer.isBuffer(entry.png)) continue;
    const safeName = featureId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const fpath = path.join(dir, `uc-${safeName}.png`);
    try {
      fs.writeFileSync(fpath, entry.png);
      saved[`uc-${safeName}`] = fpath;
    } catch {
      /* skip */
    }
  }
  // Gantt chart
  if (ganttPng && Buffer.isBuffer(ganttPng)) {
    const fpath = path.join(dir, 'gantt.png');
    try {
      fs.writeFileSync(fpath, ganttPng);
      saved['gantt'] = fpath;
    } catch {
      /* skip */
    }
  }
  return saved;
}

async function generateSrsDocument(srsData, outputPath, templatePath, options) {
  const resolvedTemplate = templatePath || path.join(__dirname, '..', '..', 'templates', 'srs-template.json');

  const data = buildSrsRenderData(srsData || {});

  // Gantt PNG — same async SVG→sharp pipeline as all other custom diagrams
  let ganttPng = null,
    ganttDims = null;
  try {
    const tasks = Array.isArray(data.ganttTasks) ? data.ganttTasks : [];
    const chartTitle = data.projectName ? `${data.projectName} — Project Schedule` : 'Project Schedule';
    if (tasks.length > 0) {
      const svgStr = buildGanttSvg(tasks, chartTitle);
      if (svgStr) {
        ganttPng = await svgToPng(svgStr, 2200);
        ganttDims = await getDims(ganttPng);
        process.stderr.write(`[ECC-SDLC][SRS] Gantt PNG: ${ganttPng ? ganttPng.length + 'b' : 'null'}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[ECC-SDLC][SRS] Gantt warning: ${err.message}\n`);
  }
  data.ganttPng = ganttPng;
  data.ganttDims = ganttDims;

  // Per-feature UC diagrams
  // IMPORTANT: Only generate diagrams for featureIds that actually exist in
  // systemFeatures[]. UCs with phantom featureIds (e.g. FEAT-26 when only
  // FEAT-01..FEAT-14 exist) produce useless "FEAT-26 — FEAT-26" headings.
  let ucDiagramsMap = {};
  try {
    // Build the set of known featureIds
    const knownFeatureIds = new Set((data.systemFeatures || []).map(f => f && f.featureId).filter(Boolean));

    // Only pass UCs whose featureId is in the known set
    const filteredUseCases = (data.useCases || []).filter(uc => {
      if (!uc || !uc.featureId || uc.featureId === 'N/A') return false;
      return knownFeatureIds.has(uc.featureId);
    });

    ucDiagramsMap = await buildFeatureUcDiagramsMap(filteredUseCases, data.systemFeatures || []);
    const ok = Object.values(ucDiagramsMap).filter(e => e.png).length;
    process.stderr.write(`[ECC-SDLC][SRS] UC diagrams: ${ok}/${Object.keys(ucDiagramsMap).length} (from ${filteredUseCases.length}/${(data.useCases || []).length} filtered UCs)\n`);
  } catch (err) {
    process.stderr.write(`[ECC-SDLC][SRS] UC diagram warning: ${err.message}\n`);
  }
  data.ucDiagramsMap = ucDiagramsMap;

  // Save to disk for /sds reuse
  let savedDiagramPaths = {};
  try {
    const projectRoot = (options && options.projectRoot) || path.resolve(outputPath, '..', '..', '..');
    savedDiagramPaths = await saveSrsDiagramsToDisk(ucDiagramsMap, ganttPng, projectRoot);
    process.stderr.write(`[ECC-SDLC][SRS] Saved ${Object.keys(savedDiagramPaths).length} diagram(s)\n`);
  } catch (e) {
    process.stderr.write(`[ECC-SDLC][SRS] Save warning: ${e.message}\n`);
  }

  // Write diagram paths into state.json for /sds
  const statePath = srsData && srsData._statePath;
  if (statePath && Object.keys(savedDiagramPaths).length > 0) {
    try {
      const fs = require('fs');
      const stateJson = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stateJson.artifacts && stateJson.artifacts.srs) {
        stateJson.artifacts.srs.diagrams = savedDiagramPaths;
        fs.writeFileSync(statePath, JSON.stringify(stateJson, null, 2));
      }
    } catch {
      /* best effort */
    }
  }

  const docPath = await generateFromTemplate({ templatePath: resolvedTemplate, data, outputPath });
  return { docPath, savedDiagramPaths };
}

module.exports = { generateSrsDocument };
