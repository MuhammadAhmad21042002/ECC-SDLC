'use strict';

/**
 * sds-diagrams.js  v1
 *
 * Custom SVG diagram builders for every SDS diagram type.
 * Zero Mermaid / browser dependency — uses @dagrejs/dagre (pure JS) + sharp (SVG→PNG).
 *
 * Diagram types supported:
 *   1. System Architecture   — layered tier blocks with service nodes (buildArchitectureSvg)
 *   2. ER Diagram            — database-style boxes: header + PK/FK/field/type rows (buildErSvg)
 *   3. Data Flow             — swimlane-style sequence diagram (buildDataFlowSvg)
 *   4. Network Architecture  — zone-based network topology (buildNetworkSvg)
 *   5. Use Case              — actor + oval use cases with association lines (buildUseCaseSvg)
 *   6. Flowchart             — decision/process boxes with dagre layout (buildFlowchartSvg)
 *
 * Fallback:
 *   If @dagrejs/dagre or sharp are unavailable, each builder returns null.
 *   The caller (sds-doc.js) skips the diagram section and shows
 *   "[Diagram not available — sharp + @dagrejs/dagre required]"
 *   — matching the existing generic-doc.js placeholder behaviour.
 *
 * Input format (passed from sdsRenderData):
 *   Each diagram uses a dedicated object from sdsData:
 *     architectureDiagram     → { title, layers: [{ name, services[] }] }
 *     databaseErDiagram       → { title, entities: [{ name, fields: [{ name, type, pk?, fk? }] }], relations: [{ from, to, label, cardinality }] }
 *     dataFlowDiagram         → { title, actors: string[], steps: [{ from, to, message, sequence? }] }
 *     networkDiagram          → { title, zones: [{ name, color?, nodes: [{ id, label, type? }] }], connections: [{ from, to, label? }] }
 *     useCaseDiagram          → { title, actors: [{ id, name }], useCases: [{ id, name }], associations: [{ actorId, useCaseId }] }
 *     flowchartDiagram        → { title, nodes: [{ id, label, type: 'process'|'decision'|'start'|'end' }], edges: [{ from, to, label? }] }
 *
 * All inputs default gracefully — if a field is missing, a placeholder is shown.
 */

const { svgToPng } = require('./svg-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT = 'Arial,Helvetica,sans-serif';

const C = {
  navy: '#1F3864',
  navyMid: '#2E5496',
  navyLight: '#D6E4F7',
  navyPale: '#EBF0F5',
  slate: '#44546A',
  green: '#375623',
  greenPale: '#E2EFDA',
  greenMid: '#70AD47',
  red: '#7B2C2C',
  redPale: '#FDECEA',
  orange: '#C55A11',
  orangePale: '#FCE4D6',
  purple: '#4B0082',
  purplePale: '#EDE7F6',
  teal: '#006060',
  tealPale: '#E0F2F1',
  white: '#FFFFFF',
  border: '#A8B8CC',
  textDark: '#1a252f',
  textMuted: '#44546A',
  arrow: '#2E5496',
  pkBadge: '#1F3864',
  fkBadge: '#C55A11'
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(str, maxChars) {
  const words = String(str || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

function titleBar(x, y, w, h, text, bgColor, textColor, fontSize) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bgColor}" rx="3" ry="3"/>
<text x="${x + w / 2}" y="${y + h / 2 + 1}" font-family="${FONT}" font-size="${fontSize || 12}" font-weight="700" fill="${textColor || C.white}" text-anchor="middle" dominant-baseline="middle">${esc(text)}</text>`;
}

function svgWrapper(w, h, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${C.white}"/>
  ${content}
</svg>`;
}

function arrowMarker(id, color) {
  return `<marker id="${id}" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
    <polygon points="0 0,9 3.5,0 7" fill="${color || C.arrow}"/>
  </marker>`;
}

// ---------------------------------------------------------------------------
// 1. System Architecture Diagram
// ---------------------------------------------------------------------------
// Input: { title, layers: [{ name, color?, services: string[] }] }
// Renders a layered tier diagram: each layer is a labeled horizontal band
// containing service boxes arranged in a row.

function buildArchitectureSvg(input) {
  const title = input.title || 'System Architecture';
  const layers =
    Array.isArray(input.layers) && input.layers.length > 0
      ? input.layers
      : [
          { name: 'Presentation Tier', services: ['Web UI', 'Mobile App'] },
          { name: 'Application Tier', services: ['API Gateway', 'Auth Service', 'Business Logic'] },
          { name: 'Data Tier', services: ['Primary DB', 'Cache', 'File Storage'] }
        ];

  const PAD = 24;
  const TITLE_H = 40;
  const LAYER_LABEL_W = 130;
  const SERVICE_W = 140;
  const SERVICE_H = 44;
  const SERVICE_GAP = 16;
  const LAYER_PAD_V = 20;
  const LAYER_GAP = 14;

  const layerColors = [
    [C.navy, C.navyLight],
    [C.teal, C.tealPale],
    [C.green, C.greenPale],
    [C.orange, C.orangePale],
    [C.purple, C.purplePale]
  ];

  // Compute layer heights
  const layerHeights = layers.map(() => SERVICE_H + LAYER_PAD_V * 2);

  // Compute total canvas width from widest layer
  const maxServices = Math.max(...layers.map(l => (Array.isArray(l.services) ? l.services.length : 1)));
  const contentW = LAYER_LABEL_W + PAD + maxServices * SERVICE_W + (maxServices - 1) * SERVICE_GAP + PAD;
  const W = Math.max(contentW + PAD * 2, 700);

  const totalLayerH = layerHeights.reduce((a, b) => a + b, 0) + (layers.length - 1) * LAYER_GAP;
  const H = TITLE_H + PAD + totalLayerH + PAD;

  let svg = '';

  // Title
  svg += `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="15" font-weight="700" fill="${C.navy}" text-anchor="middle">${esc(title)}</text>`;

  // Connector arrows between layers
  let arrowSvg = '';
  let currentY = TITLE_H + PAD;
  const layerMidXs = [];

  layers.forEach((layer, li) => {
    const lh = layerHeights[li];
    const services = Array.isArray(layer.services) && layer.services.length > 0 ? layer.services : ['(service)'];
    const totalServW = services.length * SERVICE_W + (services.length - 1) * SERVICE_GAP;
    const startX = LAYER_LABEL_W + PAD + (W - LAYER_LABEL_W - PAD * 3 - totalServW) / 2;
    layerMidXs.push(startX + totalServW / 2);
    currentY += lh + LAYER_GAP;
  });

  // Draw arrows between layer centres
  currentY = TITLE_H + PAD;
  layers.forEach((layer, li) => {
    const lh = layerHeights[li];
    if (li < layers.length - 1) {
      const mx = layerMidXs[li];
      const y1 = currentY + lh;
      const y2 = currentY + lh + LAYER_GAP;
      arrowSvg += `<line x1="${mx}" y1="${y1}" x2="${mx}" y2="${y2}" stroke="${C.arrow}" stroke-width="1.5" marker-end="url(#arch-arr)"/>`;
    }
    currentY += lh + LAYER_GAP;
  });

  svg += `<defs>${arrowMarker('arch-arr', C.arrow)}</defs>`;
  svg += arrowSvg;

  // Draw layers
  currentY = TITLE_H + PAD;
  layers.forEach((layer, li) => {
    const lh = layerHeights[li];
    const [hdrColor, bodyColor] = layerColors[li % layerColors.length];
    const services = Array.isArray(layer.services) && layer.services.length > 0 ? layer.services : ['(service)'];
    const totalServW = services.length * SERVICE_W + (services.length - 1) * SERVICE_GAP;
    const bodyX = LAYER_LABEL_W + PAD;
    const bodyW = W - LAYER_LABEL_W - PAD * 3;

    // Layer background
    svg += `<rect x="${PAD}" y="${currentY}" width="${W - PAD * 2}" height="${lh}" fill="${bodyColor}" stroke="${hdrColor}" stroke-width="1.5" rx="5"/>`;
    // Layer label band
    svg += `<rect x="${PAD}" y="${currentY}" width="${LAYER_LABEL_W}" height="${lh}" fill="${hdrColor}" rx="5" ry="5"/>`;
    // Clip right corners of label
    svg += `<rect x="${PAD + LAYER_LABEL_W - 6}" y="${currentY}" width="6" height="${lh}" fill="${hdrColor}"/>`;
    // Layer name (rotated vertical text or wrapped)
    const labelLines = wrapText(layer.name || `Layer ${li + 1}`, 12);
    const lineH = 14;
    const startLY = currentY + lh / 2 - (labelLines.length * lineH) / 2 + lineH / 2;
    labelLines.forEach((line, i) => {
      svg += `<text x="${PAD + LAYER_LABEL_W / 2}" y="${startLY + i * lineH}" font-family="${FONT}" font-size="11" font-weight="700" fill="${C.white}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });

    // Service boxes
    const servStartX = bodyX + (bodyW - totalServW) / 2;
    services.forEach((svc, si) => {
      const sx = servStartX + si * (SERVICE_W + SERVICE_GAP);
      const sy = currentY + LAYER_PAD_V;
      svg += `<rect x="${sx}" y="${sy}" width="${SERVICE_W}" height="${SERVICE_H}" fill="${C.white}" stroke="${hdrColor}" stroke-width="1.5" rx="4"/>`;
      const svcLines = wrapText(svc, 18);
      const svcLineH = 14;
      const svcStartY = sy + SERVICE_H / 2 - (svcLines.length * svcLineH) / 2 + svcLineH / 2;
      svcLines.forEach((line, li2) => {
        svg += `<text x="${sx + SERVICE_W / 2}" y="${svcStartY + li2 * svcLineH}" font-family="${FONT}" font-size="10" fill="${C.textDark}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
      });
    });

    currentY += lh + LAYER_GAP;
  });

  return svgWrapper(W, H, svg);
}

// ---------------------------------------------------------------------------
// 2. ER Diagram — database-style with PK/FK/field/type rows
// ---------------------------------------------------------------------------
// Input: {
//   title,
//   entities: [{ name, fields: [{ name, type, pk?: bool, fk?: bool }] }],
//   relations: [{ from, to, label?, cardinality?: '1:1'|'1:N'|'N:M' }]
// }

function buildErSvg(input) {
  const title = (input && input.title) || 'Entity-Relationship Diagram';
  const entities = Array.isArray(input && input.entities) && input.entities.length > 0 ? input.entities : [{ name: 'Entity', fields: [{ name: 'id', type: 'UUID', pk: true }] }];
  const relations = Array.isArray(input && input.relations) ? input.relations : [];

  const FONT = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const HEADER_H = 22;
  const ROW_H = 16;
  const TABLE_W = 165;
  const MAX_FIELDS = 6;
  const H_GAP = 30; // horizontal gap between entity columns
  const V_GAP = 40; // vertical gap between entity rows
  const PAD = 30;
  const TITLE_H = 28;
  const BADGE_W = 26;
  const TYPE_W = 54;

  // Cap fields: PKs first, then FKs, then rest
  function capFields(fields) {
    if (!Array.isArray(fields) || fields.length === 0) return [{ name: 'id', type: 'UUID', pk: true, fk: false }];
    const pks = fields.filter(f => f.pk);
    const fks = fields.filter(f => f.fk && !f.pk);
    const rest = fields.filter(f => !f.pk && !f.fk);
    const capped = [...pks, ...fks, ...rest].slice(0, MAX_FIELDS);
    const total = pks.length + fks.length + rest.length;
    if (total > MAX_FIELDS) capped.push({ name: `+${total - MAX_FIELDS} more`, type: '', pk: false, fk: false, ellipsis: true });
    return capped;
  }

  function entityH(ent) {
    return HEADER_H + capFields(ent.fields || []).length * ROW_H + 4;
  }

  // ── Manual grid layout ──────────────────────────────────────────────────────
  // dagre ignores width hints for disconnected graphs, always putting them in one rank.
  // Manual grid: target ~4:3 aspect canvas, sqrt(N) cols × rows.
  // FK-linked entities are grouped into the same row when possible.
  const N = entities.length;
  const COLS = Math.max(3, Math.ceil(Math.sqrt(N * 1.8))); // 1.8 multiplier → ~13×7 for 83 tables → 3 inches tall

  // Group connected entities together (simple BFS on relations)
  const adjMap = {};
  entities.forEach(e => {
    adjMap[e.name] = [];
  });
  relations.forEach(r => {
    if (adjMap[r.from]) adjMap[r.from].push(r.to);
    if (adjMap[r.to]) adjMap[r.to].push(r.from);
  });

  const ordered = [];
  const visited = new Set();

  function bfsGroup(start) {
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const curr = queue.shift();
      ordered.push(curr);
      (adjMap[curr] || []).forEach(nb => {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      });
    }
  }

  // Sort entities so connected ones come first
  const connected = new Set(relations.flatMap(r => [r.from, r.to]));
  [...connected].forEach(n => {
    if (!visited.has(n)) bfsGroup(n);
  });
  entities.forEach(e => {
    if (!visited.has(e.name)) bfsGroup(e.name);
  });

  // Assign grid positions
  const nodePos = {};
  const colHeights = new Array(COLS).fill(0); // track max height in each column slot per row

  ordered.forEach((name, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    nodePos[name] = { col, row };
  });

  // Compute column x positions and row y positions
  const colX = [];
  let curX = PAD;
  for (let c = 0; c < COLS; c++) {
    colX[c] = curX;
    curX += TABLE_W + H_GAP;
  }

  const ROWS = Math.ceil(N / COLS);
  const rowY = [];
  let curY = TITLE_H + PAD;
  for (let r = 0; r < ROWS; r++) {
    rowY[r] = curY;
    // Max entity height in this row
    const rowEntities = entities.filter(e => nodePos[e.name] && nodePos[e.name].row === r);
    const maxH = Math.max(...rowEntities.map(e => entityH(e)), HEADER_H + ROW_H + 4);
    curY += maxH + V_GAP;
  }

  const W = curX - H_GAP + PAD;
  const H = curY - V_GAP + PAD;

  // Entity centre positions
  function entityCentre(name) {
    const pos = nodePos[name];
    if (!pos) return null;
    const ent = entities.find(e => e.name === name);
    const eh = ent ? entityH(ent) : HEADER_H + ROW_H;
    return { x: colX[pos.col] + TABLE_W / 2, y: rowY[pos.row] + eh / 2 };
  }

  const C_NAVY = '#1F3864';
  const C_MID = '#2E5496';
  const C_WHITE = '#FFFFFF';
  const C_TEXT = '#1a252f';
  const C_MUTED = '#44546A';
  const C_ORANGE = '#C55A11';
  const C_ALT = '#F5F8FC';
  const C_BORDER = '#A8B8CC';

  const defs = `<defs>
    <marker id="earr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="${C_MID}"/>
    </marker>
  </defs>`;

  let edges = '',
    tables = '';

  // Title
  const titleSvg = `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="13" font-weight="700" fill="${C_NAVY}" text-anchor="middle">${esc(title)}</text>`;

  // Draw edges
  relations.forEach(r => {
    const fc = entityCentre(r.from);
    const tc = entityCentre(r.to);
    if (!fc || !tc || r.from === r.to) return;
    const lbl = r.label || '';
    const mx = (fc.x + tc.x) / 2;
    const my = (fc.y + tc.y) / 2;
    edges += `<line x1="${fc.x.toFixed(1)}" y1="${fc.y.toFixed(1)}" x2="${tc.x.toFixed(1)}" y2="${tc.y.toFixed(1)}" stroke="${C_MID}" stroke-width="1.1" marker-end="url(#earr)"/>`;
    if (lbl) {
      const lw = lbl.length * 5 + 6;
      edges += `<rect x="${(mx - lw / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${lw}" height="11" rx="2" fill="${C_WHITE}" opacity="0.9"/>`;
      edges += `<text x="${mx.toFixed(1)}" y="${(my + 1).toFixed(1)}" font-family="${FONT}" font-size="7.5" text-anchor="middle" fill="${C_MUTED}">${esc(lbl)}</text>`;
    }
  });

  // Draw entity tables
  entities.forEach(entity => {
    const pos = nodePos[entity.name];
    if (!pos) return;
    const fields = capFields(entity.fields || []);
    const th = entityH(entity);
    const ex = colX[pos.col];
    const ey = rowY[pos.row];

    // Shadow
    tables += `<rect x="${(ex + 2).toFixed(1)}" y="${(ey + 2).toFixed(1)}" width="${TABLE_W}" height="${th}" rx="3" fill="rgba(0,0,0,0.06)"/>`;
    // Body
    tables += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${TABLE_W}" height="${th}" rx="3" fill="${C_WHITE}" stroke="${C_MID}" stroke-width="1.2"/>`;
    // Header
    tables += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${TABLE_W}" height="${HEADER_H}" rx="3" fill="${C_NAVY}"/>`;
    tables += `<rect x="${ex.toFixed(1)}" y="${(ey + HEADER_H - 3).toFixed(1)}" width="${TABLE_W}" height="3" fill="${C_NAVY}"/>`;
    const nameCh = Math.floor((TABLE_W - 8) / 5.5);
    const nameStr = entity.name.length > nameCh ? entity.name.slice(0, nameCh - 1) + '\u2026' : entity.name;
    tables += `<text x="${(ex + TABLE_W / 2).toFixed(1)}" y="${(ey + HEADER_H / 2 + 1).toFixed(1)}" font-family="${FONT}" font-size="9.5" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(nameStr)}</text>`;

    tables += `<line x1="${ex.toFixed(1)}" y1="${(ey + HEADER_H).toFixed(1)}" x2="${(ex + TABLE_W).toFixed(1)}" y2="${(ey + HEADER_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.6"/>`;

    fields.forEach((field, fi) => {
      const fy = ey + HEADER_H + fi * ROW_H;
      const isLast = fi === fields.length - 1;
      tables += `<rect x="${(ex + 1).toFixed(1)}" y="${fy.toFixed(1)}" width="${TABLE_W - 2}" height="${ROW_H}" fill="${fi % 2 === 0 ? C_WHITE : C_ALT}" ${isLast ? 'ry="3"' : ''}/>`;

      if (field.pk) {
        tables += `<rect x="${(ex + 2).toFixed(1)}" y="${(fy + 3).toFixed(1)}" width="18" height="10" rx="2" fill="${C_NAVY}"/>`;
        tables += `<text x="${(ex + 11).toFixed(1)}" y="${(fy + 9).toFixed(1)}" font-family="${FONT}" font-size="6.5" font-weight="700" fill="${C_WHITE}" text-anchor="middle">PK</text>`;
      } else if (field.fk) {
        tables += `<rect x="${(ex + 2).toFixed(1)}" y="${(fy + 3).toFixed(1)}" width="18" height="10" rx="2" fill="${C_ORANGE}"/>`;
        tables += `<text x="${(ex + 11).toFixed(1)}" y="${(fy + 9).toFixed(1)}" font-family="${FONT}" font-size="6.5" font-weight="700" fill="${C_WHITE}" text-anchor="middle">FK</text>`;
      }

      const maxCh = Math.floor((TABLE_W - BADGE_W - TYPE_W - 4) / 5.2);
      const ns = String(field.name || '');
      const nd = field.ellipsis ? ns : ns.length > maxCh ? ns.slice(0, maxCh - 1) + '\u2026' : ns;
      tables += `<text x="${(ex + BADGE_W + 2).toFixed(1)}" y="${(fy + ROW_H / 2 + 1).toFixed(1)}" font-family="${FONT}" font-size="${field.ellipsis ? 7 : 8}" fill="${field.ellipsis ? C_MUTED : C_TEXT}" dominant-baseline="middle" ${field.pk ? 'font-weight="700"' : ''}>${esc(nd)}</text>`;

      if (!field.ellipsis) {
        tables += `<text x="${(ex + TABLE_W - 2).toFixed(1)}" y="${(fy + ROW_H / 2 + 1).toFixed(1)}" font-family="${FONT}" font-size="7.5" fill="${C_MUTED}" text-anchor="end" dominant-baseline="middle">${esc(String(field.type || ''))}</text>`;
      }

      tables += `<line x1="${(ex + BADGE_W).toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(ex + BADGE_W).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.3"/>`;
      tables += `<line x1="${(ex + TABLE_W - TYPE_W).toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(ex + TABLE_W - TYPE_W).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.3"/>`;
      if (!isLast)
        tables += `<line x1="${(ex + 1).toFixed(1)}" y1="${(fy + ROW_H).toFixed(1)}" x2="${(ex + TABLE_W - 1).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.3"/>`;
    });
  });

  return svgWrapper(W, H, defs + edges + tables + titleSvg);
}
function buildDataFlowSvg(input) {
  const title = input.title || 'Data Flow Diagram';
  const actors = Array.isArray(input.actors) && input.actors.length > 0 ? input.actors : ['Client', 'API Gateway', 'Service', 'Database'];
  const steps =
    Array.isArray(input.steps) && input.steps.length > 0
      ? input.steps
      : [
          { from: 'Client', to: 'API Gateway', message: 'HTTP Request', sequence: 1 },
          { from: 'API Gateway', to: 'Service', message: 'Forward Request', sequence: 2 },
          { from: 'Service', to: 'Database', message: 'Query', sequence: 3 },
          { from: 'Database', to: 'Service', message: 'Result Set', sequence: 4, type: 'return' },
          { from: 'Service', to: 'API Gateway', message: 'Response', sequence: 5, type: 'return' },
          { from: 'API Gateway', to: 'Client', message: 'HTTP Response', sequence: 6, type: 'return' }
        ];

  const ACTOR_W = 120;
  const ACTOR_H = 36;
  const ACTOR_GAP = 60;
  const TITLE_H = 36;
  const LIFELINE_EXTEND = 20;
  const STEP_H = 44;
  const STEP_PAD = 30;
  const MSG_LABEL_H = 14;
  const PAD = 30;

  const N = actors.length;
  const W = PAD * 2 + N * ACTOR_W + (N - 1) * ACTOR_GAP;
  const H = TITLE_H + ACTOR_H + steps.length * STEP_H + STEP_PAD + LIFELINE_EXTEND + PAD;

  // Actor centre X positions
  const actorCX = actors.map((_, i) => PAD + i * (ACTOR_W + ACTOR_GAP) + ACTOR_W / 2);
  const actorIndex = name => actors.findIndex(a => a === name);

  let defs = `<defs>${arrowMarker('df-arr', C.navy)}
    <marker id="df-ret" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0,9 3.5,0 7" fill="${C.slate}"/>
    </marker>
  </defs>`;

  let svg = '';

  // Title
  svg += `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.navy}" text-anchor="middle">${esc(title)}</text>`;

  const actorTopY = TITLE_H;
  const lifelineTopY = actorTopY + ACTOR_H;
  const lifelineBottomY = lifelineTopY + steps.length * STEP_H + STEP_PAD + LIFELINE_EXTEND;

  // Actor boxes
  actors.forEach((actor, i) => {
    const ax = actorCX[i] - ACTOR_W / 2;
    svg += `<rect x="${ax}" y="${actorTopY}" width="${ACTOR_W}" height="${ACTOR_H}" rx="4" fill="${C.navy}" stroke="${C.navyMid}" stroke-width="1.2"/>`;
    svg += `<text x="${actorCX[i]}" y="${actorTopY + ACTOR_H / 2 + 1}" font-family="${FONT}" font-size="10" font-weight="700" fill="${C.white}" text-anchor="middle" dominant-baseline="middle">${esc(actor)}</text>`;
  });

  // Lifelines
  actors.forEach((_, i) => {
    svg += `<line x1="${actorCX[i]}" y1="${lifelineTopY}" x2="${actorCX[i]}" y2="${lifelineBottomY}" stroke="${C.border}" stroke-width="1" stroke-dasharray="5,4"/>`;
  });

  // Activation boxes (narrow rect on lifeline during processing)
  const ACT_W = 10;
  steps.forEach((step, si) => {
    const fromIdx = actorIndex(step.from);
    const y = lifelineTopY + si * STEP_H + STEP_PAD / 2;
    if (fromIdx >= 0) {
      svg += `<rect x="${actorCX[fromIdx] - ACT_W / 2}" y="${y}" width="${ACT_W}" height="${STEP_H}" fill="${C.navyLight}" stroke="${C.navyMid}" stroke-width="0.8"/>`;
    }
  });

  // Message arrows
  steps.forEach((step, si) => {
    const fromIdx = actorIndex(step.from);
    const toIdx = actorIndex(step.to);
    if (fromIdx < 0 || toIdx < 0) return;

    const y = lifelineTopY + si * STEP_H + STEP_PAD / 2 + STEP_H / 2;
    const x1 = actorCX[fromIdx] + (fromIdx < toIdx ? ACT_W / 2 : -ACT_W / 2);
    const x2 = actorCX[toIdx] + (fromIdx < toIdx ? -ACT_W / 2 : ACT_W / 2);
    const isReturn = step.type === 'return';
    const isAsync = step.type === 'async';

    const dash = isReturn ? '6,3' : isAsync ? '3,3' : '';
    const marker = isReturn ? 'url(#df-ret)' : 'url(#df-arr)';
    const color = isReturn ? C.slate : C.navy;

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.4" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="${marker}"/>`;

    // Sequence number badge
    const seqNum = step.sequence || si + 1;
    const badgeX = (x1 + x2) / 2;
    svg += `<circle cx="${badgeX}" cy="${y - 8}" r="8" fill="${isReturn ? C.slate : C.navy}"/>`;
    svg += `<text x="${badgeX}" y="${y - 8}" font-family="${FONT}" font-size="8" font-weight="700" fill="${C.white}" text-anchor="middle" dominant-baseline="middle">${seqNum}</text>`;

    // Message label
    const maxLen = Math.floor(Math.abs(x2 - x1) / 6.5);
    const msgStr = String(step.message || '').length > maxLen ? String(step.message).slice(0, maxLen - 1) + '…' : String(step.message || '');
    svg += `<text x="${badgeX}" y="${y + 12}" font-family="${FONT}" font-size="9" fill="${color}" text-anchor="middle">${esc(msgStr)}</text>`;
  });

  // Bottom actor boxes (mirror)
  actors.forEach((actor, i) => {
    const ax = actorCX[i] - ACTOR_W / 2;
    svg += `<rect x="${ax}" y="${lifelineBottomY}" width="${ACTOR_W}" height="${ACTOR_H}" rx="4" fill="${C.navy}" stroke="${C.navyMid}" stroke-width="1.2"/>`;
    svg += `<text x="${actorCX[i]}" y="${lifelineBottomY + ACTOR_H / 2 + 1}" font-family="${FONT}" font-size="10" font-weight="700" fill="${C.white}" text-anchor="middle" dominant-baseline="middle">${esc(actor)}</text>`;
  });

  return svgWrapper(W, H + ACTOR_H, defs + svg);
}

// ---------------------------------------------------------------------------
// 4. Network Architecture Diagram
// ---------------------------------------------------------------------------
// Input: {
//   title,
//   zones: [{ name, color?, nodes: [{ id, label, type?: 'server'|'db'|'firewall'|'client'|'cloud'|'loadbalancer' }] }],
//   connections: [{ from, to, label?, protocol? }]
// }

function buildNetworkSvg(input) {
  const title = input.title || 'Network Architecture';
  const zones =
    Array.isArray(input.zones) && input.zones.length > 0
      ? input.zones
      : [
          { name: 'Internet', nodes: [{ id: 'client', label: 'Client', type: 'client' }] },
          {
            name: 'DMZ',
            nodes: [
              { id: 'fw', label: 'Firewall', type: 'firewall' },
              { id: 'lb', label: 'Load Balancer', type: 'loadbalancer' }
            ]
          },
          {
            name: 'App Zone',
            nodes: [
              { id: 'app1', label: 'App Server 1', type: 'server' },
              { id: 'app2', label: 'App Server 2', type: 'server' }
            ]
          },
          {
            name: 'Data Zone',
            nodes: [
              { id: 'db', label: 'Primary DB', type: 'db' },
              { id: 'cache', label: 'Cache', type: 'db' }
            ]
          }
        ];
  const connections = Array.isArray(input.connections) ? input.connections : [];

  const ZONE_PAD = 16;
  const NODE_W = 110;
  const NODE_H = 46;
  const NODE_GAP = 20;
  const ZONE_HEADER_H = 24;
  const ZONE_GAP = 30;
  const TITLE_H = 36;
  const PAD = 20;

  // Zone colors
  const zoneBg = [
    [C.navyLight, C.navyMid],
    [C.orangePale, C.orange],
    [C.tealPale, C.teal],
    [C.greenPale, C.green],
    [C.purplePale, C.purple]
  ];

  // Compute zone sizes
  const zoneWidths = zones.map(z => {
    const nodes = Array.isArray(z.nodes) ? z.nodes : [];
    return ZONE_PAD * 2 + nodes.length * NODE_W + Math.max(nodes.length - 1, 0) * NODE_GAP;
  });
  const maxZoneW = Math.max(...zoneWidths, 200);
  const W = maxZoneW + PAD * 2;
  const ZONE_H = ZONE_HEADER_H + ZONE_PAD * 2 + NODE_H;
  const totalZoneH = zones.length * ZONE_H + (zones.length - 1) * ZONE_GAP;
  const H = TITLE_H + totalZoneH + PAD * 2;

  // Build node position map: id → { cx, cy }
  const nodePositions = {};
  let zoneY = TITLE_H + PAD;
  zones.forEach((zone, zi) => {
    const nodes = Array.isArray(zone.nodes) ? zone.nodes : [];
    const totalNodeW = nodes.length * NODE_W + Math.max(nodes.length - 1, 0) * NODE_GAP;
    const startX = (W - totalNodeW) / 2;
    nodes.forEach((node, ni) => {
      const cx = startX + ni * (NODE_W + NODE_GAP) + NODE_W / 2;
      const cy = zoneY + ZONE_HEADER_H + ZONE_PAD + NODE_H / 2;
      nodePositions[node.id] = { cx, cy };
    });
    zoneY += ZONE_H + ZONE_GAP;
  });

  let defs = `<defs>${arrowMarker('net-arr', C.slate)}</defs>`;
  let svg = '';

  // Title
  svg += `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.navy}" text-anchor="middle">${esc(title)}</text>`;

  // Connection lines
  connections.forEach(conn => {
    const from = nodePositions[conn.from];
    const to = nodePositions[conn.to];
    if (!from || !to) return;
    const lbl = conn.label || conn.protocol || '';
    svg += `<line x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="${C.slate}" stroke-width="1.3" stroke-dasharray="4,3" marker-end="url(#net-arr)"/>`;
    if (lbl) {
      const mx = (from.cx + to.cx) / 2;
      const my = (from.cy + to.cy) / 2;
      svg += `<rect x="${(mx - lbl.length * 3).toFixed(1)}" y="${(my - 10).toFixed(1)}" width="${(lbl.length * 6 + 6).toFixed(1)}" height="13" fill="white" opacity="0.85"/>`;
      svg += `<text x="${mx}" y="${(my + 2).toFixed(1)}" font-family="${FONT}" font-size="8" fill="${C.slate}" text-anchor="middle">${esc(lbl)}</text>`;
    }
  });

  // Zones and nodes
  zoneY = TITLE_H + PAD;
  zones.forEach((zone, zi) => {
    const [bgColor, borderColor] = zoneBg[zi % zoneBg.length];
    const nodes = Array.isArray(zone.nodes) ? zone.nodes : [];

    // Zone box
    svg += `<rect x="${PAD}" y="${zoneY}" width="${W - PAD * 2}" height="${ZONE_H}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="1.5" stroke-dasharray="6,3"/>`;
    // Zone label
    svg += `<rect x="${PAD}" y="${zoneY}" width="${W - PAD * 2}" height="${ZONE_HEADER_H}" rx="6" fill="${borderColor}"/>`;
    svg += `<rect x="${PAD}" y="${zoneY + ZONE_HEADER_H - 6}" width="${W - PAD * 2}" height="6" fill="${borderColor}"/>`;
    svg += `<text x="${W / 2}" y="${zoneY + ZONE_HEADER_H / 2 + 1}" font-family="${FONT}" font-size="10" font-weight="700" fill="${C.white}" text-anchor="middle" dominant-baseline="middle">${esc(zone.name || `Zone ${zi + 1}`)}</text>`;

    // Node boxes
    const totalNodeW = nodes.length * NODE_W + Math.max(nodes.length - 1, 0) * NODE_GAP;
    const startX = (W - totalNodeW) / 2;
    nodes.forEach((node, ni) => {
      const nx = startX + ni * (NODE_W + NODE_GAP);
      const ny = zoneY + ZONE_HEADER_H + ZONE_PAD;
      const nodeType = node.type || 'server';
      const nodeColor =
        {
          server: C.navyMid,
          db: C.green,
          firewall: C.red,
          client: C.teal,
          cloud: C.purple,
          loadbalancer: C.orange
        }[nodeType] || C.navyMid;

      svg += `<rect x="${nx}" y="${ny}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${C.white}" stroke="${nodeColor}" stroke-width="1.5"/>`;
      // Type indicator strip at top
      svg += `<rect x="${nx}" y="${ny}" width="${NODE_W}" height="6" rx="2" fill="${nodeColor}"/>`;

      const lblLines = wrapText(node.label || node.id || nodeType, 14);
      const lineH = 13;
      const startLY = ny + 6 + (NODE_H - 6) / 2 - (lblLines.length * lineH) / 2 + lineH / 2;
      lblLines.forEach((line, li) => {
        svg += `<text x="${nx + NODE_W / 2}" y="${startLY + li * lineH}" font-family="${FONT}" font-size="9" fill="${C.textDark}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
      });
    });

    zoneY += ZONE_H + ZONE_GAP;
  });

  return svgWrapper(W, H, defs + svg);
}

// ---------------------------------------------------------------------------
// 5. Use Case Diagram
// ---------------------------------------------------------------------------
// Input: {
//   title,
//   actors: [{ id, name }],
//   useCases: [{ id, name, description? }],
//   associations: [{ actorId, useCaseId }],
//   includes?: [{ from, to }],
//   extends?: [{ from, to }]
// }

function buildUseCaseSvg(input) {
  const title = input.title || 'Use Case Diagram';
  const actors = Array.isArray(input.actors) && input.actors.length > 0 ? input.actors : [{ id: 'user', name: 'User' }];
  const useCases = Array.isArray(input.useCases) && input.useCases.length > 0 ? input.useCases : [{ id: 'uc1', name: 'Perform Action' }];
  const assocs = Array.isArray(input.associations) ? input.associations : [];
  const includes = Array.isArray(input.includes) ? input.includes : [];
  const extendsRel = Array.isArray(input.extends) ? input.extends : [];

  const FONT_FACE = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const FONT_SIZE_UC = 8.5;
  const FONT_SIZE_ACT = 8; // smaller: fits longer names
  const CHARS_PER_LINE = 22; // wider wrap: fewer line breaks in actor names
  const PX_PER_CH = 5.2;
  const LINE_H = 12;
  const UC_RY_BASE = 18;
  const UC_VPAD = 8;
  const UC_HPAD = 14;
  const UC_GAP_V = 12;
  const UC_GAP_H = 20; // horizontal gap between columns
  const ACTOR_W = 58; // wider: more space for actor name
  const ACTOR_H = 86; // taller: room for name below figure
  const TITLE_H = 32;
  const PAD = 40;
  const BORDER_PAD = 24;

  // Use 2-column layout when there are more than 5 use cases
  // This keeps the diagram wide and short rather than narrow and tall
  const USE_2COL = useCases.length > 5;
  const COLS = USE_2COL ? 2 : 1;

  // Pre-compute each UC's ellipse size
  const ucData = useCases.map(uc => {
    const lines = wrapText(uc.name || uc.id, CHARS_PER_LINE);
    const maxLen = Math.max(...lines.map(l => l.length));
    const rx = Math.max(68, Math.ceil((maxLen * PX_PER_CH) / 2) + UC_HPAD);
    const ry = Math.max(UC_RY_BASE, Math.ceil((lines.length * LINE_H) / 2) + UC_VPAD);
    return { uc, lines, rx, ry };
  });

  // Layout UCs in columns
  const col0 = ucData.filter((_, i) => i % COLS === 0);
  const col1 = ucData.filter((_, i) => i % COLS === 1);
  const cols = USE_2COL ? [col0, col1] : [col0];

  // Column widths = max ellipse diameter in that column + gap
  const colWidths = cols.map(col => (col.length > 0 ? Math.max(...col.map(d => d.rx)) * 2 + UC_GAP_H : 0));

  // System box dimensions
  const systemBoxW = colWidths.reduce((a, b) => a + b, 0) + BORDER_PAD * 2;
  const colHeights = cols.map(col => col.reduce((sum, d) => sum + d.ry * 2 + UC_GAP_V, BORDER_PAD));
  const systemBoxH = Math.max(...colHeights);

  const systemBoxX = PAD + ACTOR_W + 20;
  const systemBoxY = TITLE_H + PAD;

  // Assign positions to each UC
  let colX = systemBoxX + BORDER_PAD;
  cols.forEach((col, ci) => {
    const colMaxRx = col.length > 0 ? Math.max(...col.map(d => d.rx)) : 68;
    let curY = systemBoxY + BORDER_PAD + (col[0] ? col[0].ry : 0);
    col.forEach(d => {
      d.cx = colX + colMaxRx;
      d.cy = curY;
      curY += d.ry * 2 + UC_GAP_V;
    });
    colX += colWidths[ci];
  });

  const ucPos = {};
  ucData.forEach(d => {
    ucPos[d.uc.id] = d;
  });

  // Actor positions — bilateral layout:
  // Left side: first actor (primary); Right side: remaining actors.
  // Prevents actors being cut off and makes associations clearer.
  const actorPositions = {};
  const leftActors = [actors[0]].filter(Boolean);
  const rightActors = actors.slice(1);

  function placeActorGroup(actorList, xCenter) {
    if (actorList.length === 0) return;
    const totalH = actorList.length * ACTOR_H + Math.max(0, actorList.length - 1) * 16;
    const startY = systemBoxY + Math.max(0, (systemBoxH - totalH) / 2) + ACTOR_H / 2;
    actorList.forEach((actor, i) => {
      actorPositions[actor.id] = {
        cx: xCenter,
        cy: startY + i * (ACTOR_H + 16),
        side: xCenter < systemBoxX ? 'left' : 'right'
      };
    });
  }

  const leftCX = PAD + ACTOR_W / 2;
  const rightCX = systemBoxX + systemBoxW + PAD + ACTOR_W / 2;
  placeActorGroup(leftActors, leftCX);
  placeActorGroup(rightActors, rightCX);

  // Width accommodates right-side actors when present
  const W = systemBoxX + systemBoxW + (rightActors.length > 0 ? PAD + ACTOR_W + PAD : PAD + 20);
  const H = TITLE_H + PAD * 2 + systemBoxH + 20;

  const C_NAVY = '#1F3864';
  const C_NAVY_MID = '#2E5496';
  const C_TEAL = '#006060';
  const C_ORANGE = '#C55A11';
  const C_WHITE = '#FFFFFF';
  const C_TEXT = '#1a252f';
  const C_MUTED = '#44546A';

  let defs = `<defs><marker id="uc-arr" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0,9 3.5,0 7" fill="${C_MUTED}"/></marker></defs>`;
  let svg = '';

  // Title
  svg += `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT_FACE}" font-size="13" font-weight="700" fill="${C_NAVY}" text-anchor="middle">${esc(title)}</text>`;

  // System boundary
  svg += `<rect x="${systemBoxX}" y="${systemBoxY}" width="${systemBoxW}" height="${systemBoxH + 14}" rx="6" fill="#EBF0F5" stroke="${C_NAVY_MID}" stroke-width="1.5" stroke-dasharray="7,4"/>`;
  svg += `<text x="${systemBoxX + systemBoxW / 2}" y="${systemBoxY + 13}" font-family="${FONT_FACE}" font-size="9" fill="${C_NAVY_MID}" text-anchor="middle" font-style="italic">\u00absystem\u00bb</text>`;

  // Actors
  actors.forEach(actor => {
    const { cx, cy } = actorPositions[actor.id];
    const HEAD_R = 7,
      BODY_H = 18;
    const headY = cy - ACTOR_H / 2 + HEAD_R;
    const neckY = headY + HEAD_R;
    const botY = neckY + BODY_H;
    svg += `<circle cx="${cx}" cy="${headY}" r="${HEAD_R}" fill="none" stroke="${C_NAVY}" stroke-width="1.4"/>`;
    svg += `<line x1="${cx}" y1="${neckY}" x2="${cx}" y2="${botY}" stroke="${C_NAVY}" stroke-width="1.4"/>`;
    svg += `<line x1="${cx - 13}" y1="${neckY + 8}" x2="${cx + 13}" y2="${neckY + 8}" stroke="${C_NAVY}" stroke-width="1.4"/>`;
    svg += `<line x1="${cx}" y1="${botY}" x2="${cx - 10}" y2="${botY + 13}" stroke="${C_NAVY}" stroke-width="1.4"/>`;
    svg += `<line x1="${cx}" y1="${botY}" x2="${cx + 10}" y2="${botY + 13}" stroke="${C_NAVY}" stroke-width="1.4"/>`;
    const nameLines = wrapText(actor.name, 16);
    nameLines.forEach((line, li) => {
      svg += `<text x="${cx}" y="${cy + ACTOR_H / 2 - (nameLines.length - 1 - li) * LINE_H}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_ACT}" fill="${C_TEXT}" text-anchor="middle" font-weight="600">${esc(line)}</text>`;
    });
  });

  // Use cases
  ucData.forEach(({ uc, lines, rx, ry, cx, cy }) => {
    if (cx === undefined) return;
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C_WHITE}" stroke="${C_NAVY_MID}" stroke-width="1.4"/>`;
    const startY = cy - ((lines.length - 1) * LINE_H) / 2;
    lines.forEach((line, li) => {
      svg += `<text x="${cx}" y="${startY + li * LINE_H}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_UC}" fill="${C_TEXT}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });
  });

  // Associations — direction-aware based on which side the actor is on
  assocs.forEach(a => {
    const from = actorPositions[a.actorId];
    const tod = ucPos[a.useCaseId];
    if (!from || !tod || tod.cx === undefined) return;
    if (from.side === 'right') {
      // Right actor: line from actor's LEFT edge → UC's RIGHT edge
      svg += `<line x1="${from.cx - ACTOR_W / 2}" y1="${from.cy - 4}" x2="${tod.cx + tod.rx}" y2="${tod.cy}" stroke="${C_NAVY}" stroke-width="1"/>`;
    } else {
      // Left actor (default): line from actor's RIGHT edge → UC's LEFT edge
      svg += `<line x1="${from.cx + ACTOR_W / 2}" y1="${from.cy - 4}" x2="${tod.cx - tod.rx}" y2="${tod.cy}" stroke="${C_NAVY}" stroke-width="1"/>`;
    }
  });

  // Include arrows
  includes.forEach(inc => {
    const f = ucPos[inc.from],
      t = ucPos[inc.to];
    if (!f || !t || f.cx === undefined || t.cx === undefined) return;
    svg += `<line x1="${f.cx}" y1="${f.cy - f.ry}" x2="${t.cx}" y2="${t.cy + t.ry}" stroke="${C_TEAL}" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#uc-arr)"/>`;
    svg += `<text x="${(f.cx + t.cx) / 2 + 4}" y="${(f.cy + t.cy) / 2}" font-family="${FONT_FACE}" font-size="8" fill="${C_TEAL}" font-style="italic">\u00abinclude\u00bb</text>`;
  });

  // Extend arrows
  extendsRel.forEach(ext => {
    const f = ucPos[ext.from],
      t = ucPos[ext.to];
    if (!f || !t || f.cx === undefined || t.cx === undefined) return;
    svg += `<line x1="${f.cx}" y1="${f.cy - f.ry}" x2="${t.cx}" y2="${t.cy + t.ry}" stroke="${C_ORANGE}" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#uc-arr)"/>`;
    svg += `<text x="${(f.cx + t.cx) / 2 + 4}" y="${(f.cy + t.cy) / 2}" font-family="${FONT_FACE}" font-size="8" fill="${C_ORANGE}" font-style="italic">\u00abextend\u00bb</text>`;
  });

  return svgWrapper(W, H, defs + svg);
}
function buildFlowchartSvg(input) {
  let dagre;
  try {
    dagre = require('@dagrejs/dagre');
  } catch {
    return null;
  }

  const title = input.title || 'Flow Diagram';
  const nodes =
    Array.isArray(input.nodes) && input.nodes.length > 0
      ? input.nodes
      : [
          { id: 'start', label: 'Start', type: 'start' },
          { id: 'proc1', label: 'Process', type: 'process' },
          { id: 'dec1', label: 'Decision?', type: 'decision' },
          { id: 'end', label: 'End', type: 'end' }
        ];
  const edges = Array.isArray(input.edges) ? input.edges : [];

  const NODE_W = 150;
  const NODE_H = 48;
  const DEC_W = 160;
  const DEC_H = 60;
  const PAD = 40;
  const TITLE_H = 36;

  // Respect direction from input — default TD, but LR produces wide+short canvas
  const rankdir = input && input.direction === 'LR' ? 'LR' : 'TD';
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 40, ranksep: 60, marginx: PAD, marginy: PAD });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => {
    const isDec = n.type === 'decision';
    g.setNode(n.id, { label: n.label, width: isDec ? DEC_W : NODE_W, height: isDec ? DEC_H : NODE_H });
  });
  edges.forEach(e => {
    try {
      g.setEdge(e.from, e.to);
    } catch {
      /* skip */
    }
  });
  dagre.layout(g);

  const gi = g.graph();
  const W = Math.round((gi.width || 600) + PAD * 2);
  const H = Math.round((gi.height || 400) + PAD * 2 + TITLE_H);

  const nodeColors = {
    start: [C.green, C.greenPale],
    end: [C.red, C.redPale],
    process: [C.navyMid, C.navyLight],
    decision: [C.orange, C.orangePale],
    io: [C.teal, C.tealPale],
    connector: [C.purple, C.purplePale]
  };

  let defs = `<defs>${arrowMarker('fc-arr', C.navy)}</defs>`;
  let edgeSvg = '';
  let nodeSvg = '';

  // Title
  nodeSvg += `<text x="${W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="14" font-weight="700" fill="${C.navy}" text-anchor="middle">${esc(title)}</text>`;

  // Edges
  g.edges().forEach(e => {
    const pts = g.edge(e).points;
    if (!pts || pts.length < 2) return;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${(p.y + TITLE_H).toFixed(1)}`).join(' ');
    const edgeDef = edges.find(ed => ed.from === e.v && ed.to === e.w);
    const lbl = edgeDef ? edgeDef.label || '' : '';
    edgeSvg += `<path d="${d}" fill="none" stroke="${C.navy}" stroke-width="1.5" marker-end="url(#fc-arr)"/>`;
    if (lbl) {
      const mid = pts[Math.floor(pts.length / 2)];
      edgeSvg += `<rect x="${(mid.x - lbl.length * 3).toFixed(1)}" y="${(mid.y + TITLE_H - 12).toFixed(1)}" width="${(lbl.length * 6 + 6).toFixed(1)}" height="13" fill="white" opacity="0.9"/>`;
      edgeSvg += `<text x="${mid.x.toFixed(1)}" y="${(mid.y + TITLE_H - 2).toFixed(1)}" font-family="${FONT}" font-size="9" fill="${C.slate}" text-anchor="middle">${esc(lbl)}</text>`;
    }
  });

  // Nodes
  g.nodes().forEach(v => {
    const n = g.node(v);
    if (!n) return;
    const nodeDef = nodes.find(nd => nd.id === v);
    const nodeType = (nodeDef && nodeDef.type) || 'process';
    const [borderColor, fillColor] = nodeColors[nodeType] || nodeColors.process;
    const cx = n.x;
    const cy = n.y + TITLE_H;
    const nw = n.width || NODE_W;
    const nh = n.height || NODE_H;
    const x = cx - nw / 2;
    const y = cy - nh / 2;

    if (nodeType === 'start' || nodeType === 'end' || nodeType === 'connector') {
      // Rounded pill / circle
      nodeSvg += `<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="${nh / 2}" fill="${fillColor}" stroke="${borderColor}" stroke-width="1.8"/>`;
    } else if (nodeType === 'decision') {
      // Diamond
      const hw = nw / 2,
        hh = nh / 2;
      nodeSvg += `<polygon points="${cx},${y} ${cx + hw},${cy} ${cx},${y + nh} ${cx - hw},${cy}" fill="${fillColor}" stroke="${borderColor}" stroke-width="1.8"/>`;
    } else if (nodeType === 'io') {
      // Parallelogram
      const skew = 12;
      nodeSvg += `<polygon points="${x + skew},${y} ${x + nw},${y} ${x + nw - skew},${y + nh} ${x},${y + nh}" fill="${fillColor}" stroke="${borderColor}" stroke-width="1.8"/>`;
    } else {
      // Process rectangle
      nodeSvg += `<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="4" fill="${fillColor}" stroke="${borderColor}" stroke-width="1.8"/>`;
    }

    // Label
    const lblLines = wrapText(n.label, nodeType === 'decision' ? 18 : 20);
    const lineH = 14;
    const startY = cy - (lblLines.length * lineH) / 2 + lineH / 2;
    lblLines.forEach((line, li) => {
      nodeSvg += `<text x="${cx}" y="${startY + li * lineH}" font-family="${FONT}" font-size="10" fill="${C.textDark}" text-anchor="middle" dominant-baseline="middle" font-weight="${nodeType === 'decision' ? '700' : '400'}">${esc(line)}</text>`;
    });
  });

  return svgWrapper(W, H, defs + edgeSvg + nodeSvg);
}

// ---------------------------------------------------------------------------
// Orchestrator — called by sds-doc.js
// ---------------------------------------------------------------------------

async function buildSdsDiagrams(sdsRenderData) {
  const results = {};

  // Helper: build PNG from SVG string, get dims
  async function toPngWithDims(svgString, width) {
    if (!svgString) return { png: null, dims: null };
    const png = await svgToPng(svgString, width || 1100);
    if (!png) return { png: null, dims: null };
    try {
      const sharp = require('sharp');
      const meta = await sharp(png).metadata();
      if (meta.width && meta.height) return { png, dims: { w: meta.width, h: meta.height } };
    } catch {
      /* sharp not available */
    }
    return { png, dims: null };
  }

  async function build(key, builderFn, dataKey, widthPx) {
    const input = sdsRenderData[dataKey];
    if (!input || typeof input !== 'object') return;
    try {
      const svg = builderFn(input);
      const { png, dims } = await toPngWithDims(svg, widthPx || 1100);
      results[`${key}Png`] = png;
      results[`${key}Dims`] = dims;
    } catch (err) {
      process.stderr.write(`[ECC-SDLC] ${key} diagram failed: ${err.message}\n`);
      results[`${key}Png`] = null;
      results[`${key}Dims`] = null;
    }
  }

  await Promise.all([
    build('architecture', buildArchitectureSvg, 'architectureDiagram', 1100),
    build('erDiagram', buildErSvg, 'databaseErDiagram', 1200),
    build('dataFlow', buildDataFlowSvg, 'dataFlowDiagram', 1000),
    build('network', buildNetworkSvg, 'networkDiagram', 1000),
    build('useCase', buildUseCaseSvg, 'useCaseDiagram', 900),
    build('flowchart', buildFlowchartSvg, 'flowchartDiagram', 900)
  ]);

  return results;
}

// ---------------------------------------------------------------------------
// buildSequenceDiagramSvg — UML sequence diagram
//
// Renders a single feature sequence diagram in the correct UML format:
//   - Participant boxes at top and bottom
//   - Vertical dashed lifelines
//   - Horizontal arrows with numbered labels and message text
//   - Activation rectangles on lifelines when active
//   - Return arrows (dashed) for response messages
//
// Input:
//   { title, participants: [{id, label}], messages: [{from, to, label, type, seq}] }
//   type: 'sync' | 'return' | 'async' | 'create'
// ---------------------------------------------------------------------------

function buildSequenceDiagramSvg(input) {
  if (!input || !input.participants || !input.messages) return null;

  const FONT = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const PART_W = 130; // participant box width
  const PART_H = 36; // participant box height
  const PART_GAP = 80; // gap between participant centres — increased for readability
  const MSG_H = 36; // vertical space per message step
  const LIFELINE_X_START = 60;
  const TITLE_H = 30;
  const TOP_PAD = 20;
  const BOT_PAD = 30;
  const ACT_W = 12; // activation box width
  const ACT_HALF = ACT_W / 2;

  const C_NAVY = '#1F3864';
  const C_MID = '#2E5496';
  const C_PALE = '#D6E4F0';
  const C_WHITE = '#FFFFFF';
  const C_TEXT = '#1a252f';
  const C_MUTED = '#44546A';
  const C_RETURN = '#6B7280';
  const C_ASYNC = '#006060';
  const C_BORDER = '#A8B8CC';

  const participants = input.participants || [];
  const messages = input.messages || [];
  const title = input.title || 'Sequence Diagram';

  const N = participants.length;
  const TOTAL_W = LIFELINE_X_START + N * (PART_W + PART_GAP) + 60;
  const TOTAL_H = TITLE_H + TOP_PAD + PART_H + messages.length * MSG_H + PART_H + BOT_PAD;

  // Map participant id → x centre
  const partX = {};
  participants.forEach((p, i) => {
    partX[p.id] = LIFELINE_X_START + i * (PART_W + PART_GAP) + PART_W / 2;
  });

  let svg = '';

  // Title
  svg += `<text x="${TOTAL_W / 2}" y="${TITLE_H / 2 + 10}" font-family="${FONT}" font-size="12" font-weight="700" fill="${C_NAVY}" text-anchor="middle">${esc(title)}</text>`;

  const lifelineTop = TITLE_H + TOP_PAD + PART_H;
  const lifelineBottom = lifelineTop + messages.length * MSG_H;

  // ── Top participant boxes ──────────────────────────────────────────────────
  participants.forEach(p => {
    const cx = partX[p.id];
    const bx = cx - PART_W / 2;
    const by = TITLE_H + TOP_PAD;
    const lbl = String(p.label || p.id);
    svg += `<rect x="${bx}" y="${by}" width="${PART_W}" height="${PART_H}" rx="4" fill="${C_NAVY}" stroke="${C_MID}" stroke-width="1"/>`;
    // Wrap label to two lines if too long
    const lines = lbl.length > 16 ? [lbl.slice(0, Math.ceil(lbl.length / 2)), lbl.slice(Math.ceil(lbl.length / 2))] : [lbl];
    lines.forEach((line, li) => {
      const lineY = by + PART_H / 2 - (lines.length - 1) * 7 + li * 14;
      svg += `<text x="${cx}" y="${lineY}" font-family="${FONT}" font-size="9" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });
  });

  // ── Lifelines (dashed vertical lines) ─────────────────────────────────────
  participants.forEach(p => {
    const cx = partX[p.id];
    svg += `<line x1="${cx}" y1="${lifelineTop}" x2="${cx}" y2="${lifelineBottom}" stroke="${C_BORDER}" stroke-width="1.2" stroke-dasharray="5,4"/>`;
  });

  // Track which participants are "active" (have activation boxes) per message
  // Simple heuristic: a participant is active when it is the target of a sync message
  // until a return message comes back
  const activeStart = {}; // participantId → y start of activation
  const activations = []; // { x, yStart, yEnd }

  // ── Messages ──────────────────────────────────────────────────────────────
  messages.forEach((msg, mi) => {
    const y = lifelineTop + (mi + 0.5) * MSG_H;
    const fromX = partX[msg.from];
    const toX = partX[msg.to];
    if (fromX === undefined || toX === undefined) return;

    const isReturn = msg.type === 'return';
    const isAsync = msg.type === 'async';
    const isSelf = msg.from === msg.to;
    const color = isReturn ? C_RETURN : isAsync ? C_ASYNC : C_MID;
    const dashArr = isReturn ? '6,3' : 'none';

    const ARROW_PAD = ACT_HALF + 2;
    let x1 = fromX + (toX > fromX ? ARROW_PAD : -ARROW_PAD);
    let x2 = toX + (toX > fromX ? -ARROW_PAD : ARROW_PAD);

    if (isSelf) {
      // Self-loop: small arc to the right
      const rx = PART_W / 2 + 20;
      svg += `<path d="M ${fromX + ACT_HALF} ${y - 8} Q ${fromX + rx} ${y - 8} ${fromX + rx} ${y} Q ${fromX + rx} ${y + 8} ${fromX + ACT_HALF} ${y + 8}" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="${dashArr}"/>`;
      svg += `<polygon points="${fromX + ACT_HALF},${y + 5} ${fromX + ACT_HALF + 6},${y + 10} ${fromX + ACT_HALF - 1},${y + 10}" fill="${color}"/>`;
    } else {
      svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.3" stroke-dasharray="${dashArr}"/>`;
      // Arrowhead
      const dir = toX > fromX ? 1 : -1;
      svg += `<polygon points="${x2},${y} ${x2 - dir * 8},${y - 4} ${x2 - dir * 8},${y + 4}" fill="${color}"/>`;
    }

    // Sequence number circle
    const midX = isSelf ? fromX + PART_W / 2 + 25 : (x1 + x2) / 2;
    svg += `<circle cx="${midX}" cy="${y - 8}" r="7" fill="${C_NAVY}" opacity="0.85"/>`;
    svg += `<text x="${midX}" y="${y - 4}" font-family="${FONT}" font-size="7" fill="${C_WHITE}" text-anchor="middle" font-weight="700">${msg.seq || mi + 1}</text>`;

    // Message label
    const labelX = midX;
    const labelY = y - 12;
    // Truncate long labels
    const lbl = String(msg.label || '').length > 40 ? String(msg.label).slice(0, 38) + '…' : String(msg.label || '');
    svg += `<text x="${labelX}" y="${labelY}" font-family="${FONT}" font-size="8.5" fill="${color}" text-anchor="middle">${esc(lbl)}</text>`;

    // Activation boxes
    if (!isReturn && !isSelf) {
      const tgt = msg.to;
      if (!activeStart[tgt]) activeStart[tgt] = y - MSG_H / 2;
    }
    if (isReturn) {
      const src = msg.from;
      if (activeStart[src] !== undefined) {
        activations.push({ x: partX[src] - ACT_HALF, yStart: activeStart[src], yEnd: y });
        delete activeStart[src];
      }
    }
  });

  // Close any open activations
  Object.entries(activeStart).forEach(([id, ys]) => {
    if (partX[id] !== undefined) activations.push({ x: partX[id] - ACT_HALF, yStart: ys, yEnd: lifelineBottom });
  });

  // Draw activation boxes (behind messages, so insert before message SVG)
  let actSvg = '';
  activations.forEach(a => {
    const h = Math.max(8, a.yEnd - a.yStart);
    actSvg += `<rect x="${a.x}" y="${a.yStart.toFixed(1)}" width="${ACT_W}" height="${h.toFixed(1)}" fill="${C_PALE}" stroke="${C_MID}" stroke-width="0.8"/>`;
  });
  svg = actSvg + svg;

  // ── Bottom participant boxes (mirror of top) ───────────────────────────────
  participants.forEach(p => {
    const cx = partX[p.id];
    const bx = cx - PART_W / 2;
    const by = lifelineBottom;
    const lbl = String(p.label || p.id);
    svg += `<rect x="${bx}" y="${by}" width="${PART_W}" height="${PART_H}" rx="4" fill="${C_NAVY}" stroke="${C_MID}" stroke-width="1"/>`;
    const lines = lbl.length > 16 ? [lbl.slice(0, Math.ceil(lbl.length / 2)), lbl.slice(Math.ceil(lbl.length / 2))] : [lbl];
    lines.forEach((line, li) => {
      const lineY = by + PART_H / 2 - (lines.length - 1) * 7 + li * 14;
      svg += `<text x="${cx}" y="${lineY}" font-family="${FONT}" font-size="9" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });
  });

  return svgWrapper(TOTAL_W, TOTAL_H, svg);
}

// ---------------------------------------------------------------------------
// buildDeploymentDiagramSvg — deployment topology diagram for proposal
//
// Shows nodes (servers/services), their environments (zones), and connections.
// Input: { title, environments: [{name, nodes: [{id, label, type}]}], connections: [{from, to, label}] }
// type: 'server' | 'db' | 'client' | 'cloud' | 'loadbalancer' | 'container'
// ---------------------------------------------------------------------------

function buildDeploymentDiagramSvg(input) {
  if (!input) return null;

  const FONT = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const NODE_W = 140;
  const NODE_H = 44;
  const NODE_GAP = 20;
  const ENV_PAD = 20;
  const ENV_GAP = 30;
  const TITLE_H = 30;
  const PAD = 20;

  const C_NAVY = '#1F3864';
  const C_MID = '#2E5496';
  const C_PALE = '#EBF0F5';
  const C_WHITE = '#FFFFFF';
  const C_TEXT = '#1a252f';
  const C_MUTED = '#44546A';
  const C_BORDER = '#A8B8CC';
  const C_ORANGE = '#C55A11';
  const C_GREEN = '#375623';

  const envColors = [
    { bg: '#EBF0F5', stroke: '#2E5496' },
    { bg: '#FFF2E8', stroke: '#C55A11' },
    { bg: '#EFF7EF', stroke: '#375623' },
    { bg: '#F5F0FF', stroke: '#5B2EBF' },
    { bg: '#FFF0F0', stroke: '#C00000' }
  ];

  const title = input.title || 'Deployment Diagram';
  const environments = Array.isArray(input.environments) ? input.environments : [];
  const connections = Array.isArray(input.connections) ? input.connections : [];

  // Layout: environments stacked vertically, nodes horizontal within each
  let curY = TITLE_H + PAD;
  const envLayouts = [];
  const nodePositions = {};

  environments.forEach((env, ei) => {
    const nodes = Array.isArray(env.nodes) ? env.nodes : [];
    const envW = nodes.length * (NODE_W + NODE_GAP) - NODE_GAP + ENV_PAD * 2;
    const envH = NODE_H + ENV_PAD * 2 + 16; // 16 for label
    envLayouts.push({ env, envW, envH, x: PAD, y: curY, ei });
    nodes.forEach((node, ni) => {
      nodePositions[node.id] = {
        cx: PAD + ENV_PAD + ni * (NODE_W + NODE_GAP) + NODE_W / 2,
        cy: curY + 16 + ENV_PAD + NODE_H / 2
      };
    });
    curY += envH + ENV_GAP;
  });

  const maxEnvW = Math.max(...envLayouts.map(e => e.envW), 400);
  const TOTAL_W = maxEnvW + PAD * 2;
  const TOTAL_H = curY - ENV_GAP + PAD;

  let svg = '';

  // Title
  svg += `<text x="${TOTAL_W / 2}" y="${TITLE_H / 2 + 8}" font-family="${FONT}" font-size="12" font-weight="700" fill="${C_NAVY}" text-anchor="middle">${esc(title)}</text>`;

  // Connections (draw first, behind nodes)
  let connSvg = '';
  connections.forEach(conn => {
    const from = nodePositions[conn.from];
    const to = nodePositions[conn.to];
    if (!from || !to) return;
    const midX = (from.cx + to.cx) / 2;
    const midY = (from.cy + to.cy) / 2;
    connSvg += `<line x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="${C_MID}" stroke-width="1.3" stroke-dasharray="5,3"/>`;
    if (conn.label) {
      const lbl = String(conn.label).length > 20 ? String(conn.label).slice(0, 18) + '…' : String(conn.label);
      const lw = lbl.length * 5 + 6;
      connSvg += `<rect x="${midX - lw / 2}" y="${midY - 8}" width="${lw}" height="12" rx="2" fill="${C_WHITE}" opacity="0.9"/>`;
      connSvg += `<text x="${midX}" y="${midY + 2}" font-family="${FONT}" font-size="7.5" fill="${C_MUTED}" text-anchor="middle">${esc(lbl)}</text>`;
    }
  });

  // Environments
  envLayouts.forEach(({ env, envW, envH, x, y, ei }) => {
    const col = envColors[ei % envColors.length];
    svg += `<rect x="${x}" y="${y}" width="${envW}" height="${envH}" rx="6" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    svg += `<text x="${x + 10}" y="${y + 13}" font-family="${FONT}" font-size="9" font-weight="700" fill="${col.stroke}">${esc(env.name || '')}</text>`;

    const nodes = Array.isArray(env.nodes) ? env.nodes : [];
    nodes.forEach((node, ni) => {
      const pos = nodePositions[node.id];
      if (!pos) return;
      const nx = pos.cx - NODE_W / 2;
      const ny = pos.cy - NODE_H / 2;
      const type = (node.type || '').toLowerCase();

      // Node box color by type
      const headerColor = type === 'db' ? C_ORANGE : type === 'client' ? C_GREEN : C_NAVY;
      svg += `<rect x="${nx}" y="${ny}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${C_WHITE}" stroke="${headerColor}" stroke-width="1.3"/>`;
      svg += `<rect x="${nx}" y="${ny}" width="${NODE_W}" height="16" rx="4" fill="${headerColor}"/>`;
      svg += `<rect x="${nx}" y="${ny + 13}" width="${NODE_W}" height="3" fill="${headerColor}"/>`;

      // Type icon label
      const iconLabel = type === 'db' ? 'DB' : type === 'client' ? 'CLIENT' : type === 'container' ? '[]' : type === 'loadbalancer' ? 'LB' : type === 'cloud' ? '☁' : 'SVC';
      svg += `<text x="${nx + 6}" y="${ny + 11}" font-family="${FONT}" font-size="7" font-weight="700" fill="${C_WHITE}">${iconLabel}</text>`;

      // Node label
      const lbl = String(node.label || node.id);
      const lines = lbl.length > 17 ? [lbl.slice(0, Math.ceil(lbl.length / 2)), lbl.slice(Math.ceil(lbl.length / 2))] : [lbl];
      lines.forEach((line, li) => {
        const lineY = ny + 16 + (NODE_H - 16) / 2 - (lines.length - 1) * 6 + li * 12;
        svg += `<text x="${nx + NODE_W / 2}" y="${lineY}" font-family="${FONT}" font-size="8.5" fill="${C_TEXT}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
      });
    });
  });

  return svgWrapper(TOTAL_W, TOTAL_H, connSvg + svg);
}

module.exports = {
  buildSdsDiagrams,
  buildArchitectureSvg,
  buildErSvg,
  buildDataFlowSvg,
  buildNetworkSvg,
  buildUseCaseSvg,
  buildFlowchartSvg,
  buildSequenceDiagramSvg,
  buildDeploymentDiagramSvg
};
