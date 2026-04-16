'use strict';

const path = require('path');
const { generateFromTemplate } = require('./generic-doc');
const { buildScopeRenderData } = require('./scope-render-data');
const { buildScopeDiagrams } = require('./scope-diagrams');

async function pngDimensions(buf) {
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

async function generateScopeDocument(scopeData, outputPath, templatePath) {
  const resolvedTemplate = templatePath || path.join(__dirname, '..', '..', 'templates', 'scope-template.json');

  // Step 1 — flat render data
  const data = buildScopeRenderData(scopeData || {});

  // Step 2 — diagrams
  try {
    const { systemContextPng, scopeBoundaryPng } = await buildScopeDiagrams(data);
    data.systemContextPng = systemContextPng;
    data.scopeBoundaryPng = scopeBoundaryPng;

    // Step 3 — real PNG dimensions (async, done here so generic-doc stays sync)
    const [ctxDims, boundaryDims] = await Promise.all([pngDimensions(systemContextPng), pngDimensions(scopeBoundaryPng)]);
    // Store as { w, h } — generic-doc reads these to compute the correct heightPx
    data.systemContextDims = ctxDims;
    data.scopeBoundaryDims = boundaryDims;
  } catch {
    data.systemContextPng = null;
    data.scopeBoundaryPng = null;
    data.systemContextDims = null;
    data.scopeBoundaryDims = null;
  }

  // Step 4 — render docx
  return generateFromTemplate({
    templatePath: resolvedTemplate,
    data,
    outputPath
  });
}

module.exports = { generateScopeDocument };
