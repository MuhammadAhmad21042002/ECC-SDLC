'use strict';

/**
 * mermaid-generator.js  v7.2 (2026-04-14)
 *
 * Converts Mermaid diagram syntax (string[]) to PNG buffers for embedding
 * in the SDS docx via ImageRun.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ZERO BROWSER DEPENDENCY — works on Windows, macOS, Linux, any machine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pipeline:
 *   Mermaid source
 *     → parse nodes + edges  (built-in, no dependencies)
 *     → dagre layout         (@dagrejs/dagre — pure JS, no browser)
 *     → hand-built SVG       (web-safe fonts that sharp/librsvg supports)
 *     → sharp SVG→PNG        (sharp — Node C++ bindings, no browser)
 *     → embedded in docx
 *
 * Requirements (both must be installed in the ECC project):
 *   npm install @dagrejs/dagre
 *   npm install sharp
 *
 * If either is missing the code falls back gracefully to the mermaidBlock
 * code-listing section (Tier 3) — the docx still generates cleanly with
 * Mermaid source the reader can paste into mermaid.live.
 *
 * v7.2 fixes vs v7.1:
 *   - buildErSvg: stub PK row when agent omits attribute blocks
 *   - buildSequenceSvg: adaptive scaling for large diagrams (many participants)
 *   - svgToPng: native-size rendering, no forced downscale
 *   - Placeholder text updated
 *
 * v7.1 fixes vs v7:
 *   - parseErDiagram: detects both type-first and name-first attribute ordering
 *   - buildSequenceSvg: participant box widths and canvas width now data-driven
 *
 * v7 changes vs v6:
 *   - sequenceDiagram: new parser + swimlane SVG builder
 *   - erDiagram:       upgraded to full field-row table rendering
 *                      (PK/FK badges, field name, type — matching the
 *                       reference ERD image style)
 *                      Parses Mermaid erDiagram attribute lines:
 *                        string name PK
 *                        int    id   FK
 *   - buildSdsDiagrams: now also handles network/useCase/flowchart diagram
 *                        types via structured-input builders from sds-diagrams.js
 *                        so ALL diagram slots produce a PNG on first attempt
 *
 * Supports:
 *   flowchart TD/LR/BT/RL, graph TD/LR
 *   erDiagram  (with attribute lines for fields + PK/FK)
 *   sequenceDiagram
 */

const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write('[ECC-SDLC] ' + msg + '\n');
}
function dbg(msg) {
  if (process.env.ECC_MERMAID_DEBUG === '1') process.stderr.write('[mermaid-generator] ' + msg + '\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words = String(text || '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ---------------------------------------------------------------------------
// Mermaid source sanitisation
// ---------------------------------------------------------------------------

function sanitise(source) {
  return source.replace(/<br\s*\/?>/gi, ' ').replace(/  +/g, ' ');
}

// ---------------------------------------------------------------------------
// Flowchart parser
// Handles: flowchart TD/LR/BT/RL, graph TD/LR
// ---------------------------------------------------------------------------

function parseFlowchart(lines) {
  const nodes = new Map();
  const edges = [];

  function parseNodeRef(token) {
    const t = token.trim();
    const idMatch = t.match(/^([\w-]+)/);
    if (!idMatch) return null;
    const id = idMatch[1];
    const rest = t.slice(id.length);
    if (!rest) return [id, null];
    const open = rest[0];
    const closeChar = { '[': ']', '(': ')', '{': '}' }[open];
    if (!closeChar) return [id, null];
    const lastClose = rest.lastIndexOf(closeChar);
    if (lastClose === -1) return [id, null];
    let label = rest
      .slice(1, lastClose)
      .replace(/^["']+|["']+$/g, '')
      .replace(/^\((.+)\)$/, '$1')
      .trim();
    return [id, label || null];
  }

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('```') || /^(flowchart|graph)\s/i.test(t) || t.startsWith('%%') || /^subgraph/i.test(t) || t === 'end') continue;
    const normalised = t.replace(/--[->]+\|[^|]*\|/g, '-->');
    if (normalised.includes('-->') || normalised.includes('---')) {
      const parts = normalised.split(/\s+--[->]+\s+/);
      for (let i = 0; i < parts.length - 1; i++) {
        const fromTokens = parts[i].split(/\s*&\s*/);
        const toTokens = parts[i + 1].split(/\s*&\s*/);
        for (const ft of fromTokens) {
          for (const tt of toTokens) {
            const from = parseNodeRef(ft.trim());
            const to = parseNodeRef(tt.trim());
            if (!from || !to) continue;
            const [fId, fLbl] = from;
            const [tId, tLbl] = to;
            if (!nodes.has(fId)) nodes.set(fId, fLbl || fId);
            if (!nodes.has(tId)) nodes.set(tId, tLbl || tId);
            edges.push([fId, tId]);
          }
        }
      }
      continue;
    }
    const nm = t.match(/^([\w-]+)[\[({]["\'']?([^\])"\'>}]+)/);
    if (nm && !nodes.has(nm[1])) nodes.set(nm[1], nm[2].replace(/^\(|\)$/g, '').trim());
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// ER diagram parser  (v7 — parses attribute lines for fields + PK/FK)
//
// Mermaid erDiagram syntax:
//   TABLE_NAME {
//     type  fieldName  PK
//     type  fieldName  FK
//     type  fieldName
//   }
//   TABLE_A ||--o{ TABLE_B : "label"
// ---------------------------------------------------------------------------

function parseErDiagram(lines) {
  const entities = new Map(); // name → { fields: [{name, type, pk, fk}] }
  const edges = []; // [fromName, toName, label]

  let insideBlock = null; // entity name currently being parsed

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || /^erDiagram/i.test(t) || t.startsWith('%%')) continue;

    // Opening brace — start of attribute block
    const blockOpen = t.match(/^(\w+)\s*\{/);
    if (blockOpen) {
      insideBlock = blockOpen[1];
      if (!entities.has(insideBlock)) entities.set(insideBlock, { fields: [] });
      continue;
    }

    // Closing brace — end of attribute block
    if (t === '}') {
      insideBlock = null;
      continue;
    }

    // Attribute line inside a block.
    // Mermaid spec:  type  fieldName  [PK|FK]  ["optional comment"]
    // Agents sometimes write name-first:  fieldName  type  [PK|FK]
    // We detect which token is the type by checking known type keywords
    // and capitalisation conventions, then normalise to {name, type, pk, fk}.
    if (insideBlock) {
      // Strip trailing quoted comment first
      const stripped = t.replace(/"[^"]*"\s*$/, '').trim();
      const attrMatch = stripped.match(/^(\S+)\s+(\S+)(?:\s+(PK|FK))?/i);
      if (attrMatch) {
        const [, tok0, tok1, modifier] = attrMatch;

        // Known SQL / MongoDB / general type keywords
        const TYPE_WORDS = /^(string|int|integer|float|double|boolean|bool|date|datetime|timestamp|objectid|object|array|number|bigint|text|varchar|uuid|json|blob|binary|decimal|char|enum)$/i;

        let fieldType, fieldName;
        if (TYPE_WORDS.test(tok0)) {
          // Spec order: type fieldName
          fieldType = tok0;
          fieldName = tok1;
        } else if (TYPE_WORDS.test(tok1)) {
          // Agent wrote name-first: fieldName type
          fieldType = tok1;
          fieldName = tok0;
        } else if (/^[A-Z]/.test(tok0) && /^[a-z_]/.test(tok1)) {
          // tok0 capitalised → looks like a Type; tok1 lowercase → looks like fieldName
          fieldType = tok0;
          fieldName = tok1;
        } else if (/^[A-Z]/.test(tok1) && /^[a-z_]/.test(tok0)) {
          // tok1 capitalised, tok0 lowercase → name-first order
          fieldType = tok1;
          fieldName = tok0;
        } else {
          // Fallback: trust Mermaid spec order
          fieldType = tok0;
          fieldName = tok1;
        }

        entities.get(insideBlock).fields.push({
          name: fieldName,
          type: fieldType,
          pk: !!(modifier && modifier.toUpperCase() === 'PK'),
          fk: !!(modifier && modifier.toUpperCase() === 'FK')
        });
      }
      continue;
    }

    // Relationship line:  TABLE_A ||--o{ TABLE_B : "label"
    const relMatch = t.match(/^(\w+)\s+[|o<>{}*+\-]+\s+(\w+)\s*:\s*(.+)/);
    if (relMatch) {
      const [, a, b, lbl] = relMatch;
      // Ensure entity stubs exist even if no attribute block was declared
      if (!entities.has(a)) entities.set(a, { fields: [] });
      if (!entities.has(b)) entities.set(b, { fields: [] });
      edges.push([a, b, lbl.replace(/"/g, '').trim()]);
    }
  }

  // Build the nodes Map expected by buildSdsDiagrams (id → label)
  const nodes = new Map();
  entities.forEach((_, name) => nodes.set(name, name));

  return { nodes, edges, entities };
}

// ---------------------------------------------------------------------------
// Sequence diagram parser
//
// Handles:
//   participant A as "Label"
//   participant B
//   A->>B: Message
//   A-->>B: Response
//   Note over A,B: text
// ---------------------------------------------------------------------------

function parseSequenceDiagram(lines) {
  const participants = []; // ordered list of { id, label }
  const participantSeen = new Set();
  const steps = []; // { from, to, message, type, note }

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || /^sequenceDiagram/i.test(t) || t.startsWith('%%')) continue;

    // participant declaration
    const pMatch = t.match(/^participant\s+(\S+)(?:\s+as\s+"?([^"]+)"?)?/i);
    if (pMatch) {
      const id = pMatch[1];
      const label = pMatch[2] ? pMatch[2].trim() : id;
      if (!participantSeen.has(id)) {
        participants.push({ id, label });
        participantSeen.add(id);
      }
      continue;
    }

    // actor declaration (treat same as participant)
    const actorMatch = t.match(/^actor\s+(\S+)(?:\s+as\s+"?([^"]+)"?)?/i);
    if (actorMatch) {
      const id = actorMatch[1];
      const label = actorMatch[2] ? actorMatch[2].trim() : id;
      if (!participantSeen.has(id)) {
        participants.push({ id, label });
        participantSeen.add(id);
      }
      continue;
    }

    // Note
    const noteMatch = t.match(/^[Nn]ote\s+(?:over|right of|left of)\s+([\w,\s]+):\s*(.+)/);
    if (noteMatch) {
      steps.push({ type: 'note', participants: noteMatch[1].split(',').map(s => s.trim()), message: noteMatch[2].trim() });
      continue;
    }

    // Message arrows:  A->>B: msg  A-->B: msg  A->B: msg
    // Arrow types: ->> solid, -->> dashed, -> solid no head, --> dashed no head, -x lost
    const msgMatch = t.match(/^(\S+)\s*(-[-x]?-?>>?|--?>>?|--?x)\s*(\S+)\s*:\s*(.+)/);
    if (msgMatch) {
      const [, from, arrow, to, message] = msgMatch;
      const isReturn = arrow.includes('--');
      const isAsync = arrow.includes('-x');
      const type = isAsync ? 'async' : isReturn ? 'return' : 'sync';

      // Auto-register participants seen in arrows
      if (!participantSeen.has(from)) {
        participants.push({ id: from, label: from });
        participantSeen.add(from);
      }
      if (!participantSeen.has(to)) {
        participants.push({ id: to, label: to });
        participantSeen.add(to);
      }

      steps.push({ from, to, message: message.trim(), type });
      continue;
    }

    // activate / deactivate — ignored (activation boxes handled by index)
    // loop / alt / else / end — ignored (too complex for flat SVG, steps still capture messages inside)
  }

  return { participants, steps };
}

// ---------------------------------------------------------------------------
// SVG builder — flowchart  (unchanged from v6)
// ---------------------------------------------------------------------------

function buildFlowchartSvg(lines) {
  let dagre;
  try {
    dagre = require('@dagrejs/dagre');
  } catch {
    dbg('dagre not installed — run: npm install @dagrejs/dagre');
    return null;
  }

  const { nodes, edges } = parseFlowchart(lines);
  if (nodes.size === 0) {
    dbg('flowchart: no nodes parsed');
    return null;
  }
  dbg(`flowchart: ${nodes.size} nodes, ${edges.length} edges`);

  const NODE_W = 165,
    NODE_H = 46,
    PAD = 40,
    FONT = 12,
    LINE_H = 15,
    MAX_CHARS = 22;

  const dirMatch = lines.map(l => l.trim()).find(l => /^(flowchart|graph)\s/i.test(l));
  const rankdir = dirMatch ? (dirMatch.match(/\b(LR|RL|BT|TD|TB)\b/i) || [, 'TD'])[1].toUpperCase() : 'TD';

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 45, ranksep: 55, marginx: PAD, marginy: PAD });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((label, id) => g.setNode(id, { label, width: NODE_W, height: NODE_H }));
  edges.forEach(([f, t]) => {
    try {
      g.setEdge(f, t);
    } catch {
      /* skip */
    }
  });
  dagre.layout(g);

  const gi = g.graph();
  const W = Math.round((gi.width || 800) + PAD * 2);
  const H = Math.round((gi.height || 500) + PAD * 2);

  const FONT_FACE = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const defs = `<defs><marker id="arr" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0,9 3.5,0 7" fill="#4a7aab"/></marker></defs>`;
  let edgeSvg = '',
    nodeSvg = '';

  g.edges().forEach(e => {
    const pts = g.edge(e).points;
    if (!pts || pts.length < 2) return;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    edgeSvg += `<path d="${d}" fill="none" stroke="#4a7aab" stroke-width="1.4" marker-end="url(#arr)"/>`;
  });

  g.nodes().forEach(v => {
    const n = g.node(v);
    if (!n) return;
    const x = (n.x - NODE_W / 2).toFixed(1);
    const y = (n.y - NODE_H / 2).toFixed(1);
    nodeSvg += `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="5" ry="5" fill="#dce8f7" stroke="#5b9bd5" stroke-width="1.2"/>`;
    const lblLines = wrapText(n.label, MAX_CHARS);
    const totalH = lblLines.length * LINE_H;
    const startY = n.y - totalH / 2 + LINE_H * 0.5;
    lblLines.forEach((line, i) => {
      nodeSvg += `<text x="${n.x.toFixed(1)}" y="${(startY + i * LINE_H).toFixed(1)}" font-family="${FONT_FACE}" font-size="${FONT}" text-anchor="middle" dominant-baseline="middle" fill="#1a3a6b">${esc(line)}</text>`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  ${defs}${edgeSvg}${nodeSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// SVG builder — ER diagram  (v7 — full field-row table rendering)
//
// Each entity renders as a database-style table:
//   ┌─────────────────────────────────────┐
//   │          entity_name  (navy header) │
//   ├──────┬──────────────────┬───────────┤
//   │ [PK] │ field_name       │ Type      │  ← alternating row shading
//   │ [FK] │ other_field      │ String    │
//   └──────┴──────────────────┴───────────┘
// ---------------------------------------------------------------------------

function buildErSvg(lines) {
  let dagre;
  try {
    dagre = require('@dagrejs/dagre');
  } catch {
    dbg('dagre not installed');
    return null;
  }

  const { nodes, edges, entities } = parseErDiagram(lines);
  if (nodes.size === 0) {
    dbg('erDiagram: no entities parsed');
    return null;
  }
  dbg(`erDiagram: ${nodes.size} entities, ${edges.length} relationships`);

  const FONT_FACE = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const HEADER_H = 26;
  const ROW_H = 20;
  const TABLE_W = 215;
  const PAD = 50;
  const MIN_ROWS = 1; // always show at least one row even if no fields parsed

  // Compute per-entity height based on field count
  function entityH(name) {
    const ent = entities.get(name);
    const rowCount = ent && ent.fields.length > 0 ? ent.fields.length : MIN_ROWS;
    return HEADER_H + rowCount * ROW_H + 4; // +4 bottom padding
  }

  // Dagre layout — each node sized to its actual table height
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 55, ranksep: 100, marginx: PAD, marginy: PAD });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((_, name) => g.setNode(name, { label: name, width: TABLE_W, height: entityH(name) }));
  edges.forEach(([a, b]) => {
    try {
      g.setEdge(a, b);
    } catch {
      /* skip */
    }
  });
  dagre.layout(g);

  const gi = g.graph();
  const W = Math.round((gi.width || 700) + PAD * 2);
  const H = Math.round((gi.height || 300) + PAD * 2);

  // Colours
  const C_NAVY = '#1F3864';
  const C_NAVY_MID = '#2E5496';
  const C_NAVY_PALE = '#EBF0F5';
  const C_WHITE = '#FFFFFF';
  const C_BORDER = '#A8B8CC';
  const C_TEXT = '#1a252f';
  const C_MUTED = '#44546A';
  const C_PK_BG = '#1F3864';
  const C_FK_BG = '#C55A11';
  const C_ROW_ALT = '#F5F8FC';

  const defs = `<defs>
    <marker id="earr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0,10 4,0 8" fill="${C_NAVY_MID}"/>
    </marker>
    <marker id="earr0" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">
      <polygon points="10 0,0 4,10 8" fill="${C_NAVY_MID}"/>
    </marker>
  </defs>`;

  let edgeSvg = '',
    tableSvg = '';

  // Edges
  g.edges().forEach(e => {
    const pts = g.edge(e).points;
    if (!pts || pts.length < 2) return;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const rel = edges.find(([a, b]) => a === e.v && b === e.w);
    const lbl = rel ? rel[2] : '';
    const mid = pts[Math.floor(pts.length / 2)];

    edgeSvg += `<path d="${d}" fill="none" stroke="${C_NAVY_MID}" stroke-width="1.3" marker-end="url(#earr)"/>`;

    if (lbl) {
      const lw = lbl.length * 6 + 8;
      edgeSvg += `<rect x="${(mid.x - lw / 2).toFixed(1)}" y="${(mid.y - 11).toFixed(1)}" width="${lw.toFixed(1)}" height="13" rx="2" fill="${C_WHITE}" opacity="0.9" stroke="${C_BORDER}" stroke-width="0.5"/>`;
      edgeSvg += `<text x="${mid.x.toFixed(1)}" y="${(mid.y + 2).toFixed(1)}" font-family="${FONT_FACE}" font-size="9" text-anchor="middle" fill="${C_MUTED}">${esc(lbl)}</text>`;
    }
  });

  // Entity tables
  nodes.forEach((_, name) => {
    const node = g.node(name);
    if (!node) return;
    const ent = entities.get(name);
    // If agent wrote only relationship lines with no attribute blocks,
    // synthesise a stub row so the table renders visibly and signals the gap.
    const fields = ent && ent.fields.length > 0 ? ent.fields : [{ name: 'id', type: 'PK — add { } attribute blocks to erDiagram', pk: true, fk: false }];
    const th = entityH(name);
    const ex = node.x - TABLE_W / 2;
    const ey = node.y - th / 2;

    // Drop shadow
    tableSvg += `<rect x="${(ex + 3).toFixed(1)}" y="${(ey + 3).toFixed(1)}" width="${TABLE_W}" height="${th}" rx="3" fill="rgba(0,0,0,0.08)"/>`;
    // Table border
    tableSvg += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${TABLE_W}" height="${th}" rx="3" fill="${C_WHITE}" stroke="${C_NAVY_MID}" stroke-width="1.4"/>`;

    // Header
    tableSvg += `<rect x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${TABLE_W}" height="${HEADER_H}" rx="3" fill="${C_NAVY}"/>`;
    // Square off bottom corners of header
    tableSvg += `<rect x="${ex.toFixed(1)}" y="${(ey + HEADER_H - 4).toFixed(1)}" width="${TABLE_W}" height="4" fill="${C_NAVY}"/>`;
    // Entity name
    tableSvg += `<text x="${(ex + TABLE_W / 2).toFixed(1)}" y="${(ey + HEADER_H / 2 + 1).toFixed(1)}" font-family="${FONT_FACE}" font-size="11" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(name)}</text>`;

    // Column widths: badge=30 | name=dynamic | type=72
    const BADGE_W = 30;
    const TYPE_W = 72;
    const NAME_W = TABLE_W - BADGE_W - TYPE_W;

    // Column header divider line
    tableSvg += `<line x1="${ex.toFixed(1)}" y1="${(ey + HEADER_H).toFixed(1)}" x2="${(ex + TABLE_W).toFixed(1)}" y2="${(ey + HEADER_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.8"/>`;

    // Field rows
    fields.forEach((field, fi) => {
      const fy = ey + HEADER_H + fi * ROW_H;
      const rowBg = fi % 2 === 0 ? C_WHITE : C_ROW_ALT;
      const isLast = fi === fields.length - 1;
      const clipR = isLast ? 3 : 0;

      // Row background
      tableSvg += `<rect x="${(ex + 1).toFixed(1)}" y="${fy.toFixed(1)}" width="${TABLE_W - 2}" height="${ROW_H}" fill="${rowBg}" ${isLast ? `ry="${clipR}"` : ''}/>`;

      // PK / FK badge
      if (field.pk || field.fk) {
        const bgColor = field.pk ? C_PK_BG : C_FK_BG;
        const label = field.pk ? 'PK' : 'FK';
        tableSvg += `<rect x="${(ex + 4).toFixed(1)}" y="${(fy + 4).toFixed(1)}" width="22" height="12" rx="2" fill="${bgColor}"/>`;
        tableSvg += `<text x="${(ex + 15).toFixed(1)}" y="${(fy + 12).toFixed(1)}" font-family="${FONT_FACE}" font-size="7.5" font-weight="700" fill="${C_WHITE}" text-anchor="middle">${label}</text>`;
      }

      // Field name (bold if PK)
      const nameX = ex + BADGE_W + 3;
      const maxCh = Math.floor(NAME_W / 6.3);
      const nameStr = String(field.name || '').length > maxCh ? String(field.name).slice(0, maxCh - 1) + '…' : String(field.name || '');
      tableSvg += `<text x="${nameX.toFixed(1)}" y="${(fy + ROW_H / 2 + 1).toFixed(1)}" font-family="${FONT_FACE}" font-size="9" fill="${C_TEXT}" dominant-baseline="middle" ${field.pk ? 'font-weight="700"' : ''}>${esc(nameStr)}</text>`;

      // Field type (right-aligned, muted)
      const typeStr = String(field.type || '');
      tableSvg += `<text x="${(ex + TABLE_W - 4).toFixed(1)}" y="${(fy + ROW_H / 2 + 1).toFixed(1)}" font-family="${FONT_FACE}" font-size="9" fill="${C_MUTED}" text-anchor="end" dominant-baseline="middle">${esc(typeStr)}</text>`;

      // Vertical column dividers
      tableSvg += `<line x1="${(ex + BADGE_W).toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(ex + BADGE_W).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.4"/>`;
      tableSvg += `<line x1="${(ex + TABLE_W - TYPE_W).toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(ex + TABLE_W - TYPE_W).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.4"/>`;

      // Horizontal row divider (skip last row — covered by table border)
      if (!isLast) {
        tableSvg += `<line x1="${(ex + 1).toFixed(1)}" y1="${(fy + ROW_H).toFixed(1)}" x2="${(ex + TABLE_W - 1).toFixed(1)}" y2="${(fy + ROW_H).toFixed(1)}" stroke="${C_BORDER}" stroke-width="0.4"/>`;
      }
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  ${defs}
  ${edgeSvg}
  ${tableSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// SVG builder — sequence diagram  (v7 new)
//
// Renders a proper swimlane sequence diagram:
//   - Participant header boxes (navy) at top and mirrored at bottom
//   - Dashed lifelines
//   - Activation bars (narrow rect) on the sending participant
//   - Numbered sequence badges on each arrow
//   - Solid arrows for sync, dashed for return/async
//   - Note boxes inline
// ---------------------------------------------------------------------------

function buildSequenceSvg(lines) {
  const { participants, steps } = parseSequenceDiagram(lines);
  if (participants.length === 0 || steps.length === 0) {
    dbg('sequenceDiagram: nothing to render');
    return null;
  }
  dbg(`sequenceDiagram: ${participants.length} participants, ${steps.length} steps`);

  const FONT_FACE = 'Liberation Sans,DejaVu Sans,Arial,Helvetica,sans-serif';
  const P_H = 34; // participant box height (fixed)
  const STEP_H = 50; // vertical space per step
  const PAD_TOP = 16;
  const PAD_SIDE = 30;
  const ACT_W = 10; // activation bar width
  const ARROW_PAD = 8; // horizontal inset from lifeline for arrow tips
  const MIN_P_W = 110; // narrowest a participant box may be
  const PX_PER_CH = 7.5; // approximate px per character at font-size 10
  const BOX_H_PAD = 20; // left+right padding inside participant box

  // ── Participant box widths — sized to the longest label line ─────────────
  // wrapText splits labels to 16-char lines; box must fit the widest line.
  // A label like "Payment Gateway Service" wraps to ["Payment Gateway", "Service"]
  // so the box only needs to fit "Payment Gateway" (16 chars → ~140px).
  const N = participants.length;

  // Adaptive scaling — compress layout for large diagrams (many participants / steps)
  // so the SVG stays readable when embedded at A4 body width.
  // Thresholds: <= 6 participants = normal; 7-12 = medium; 13+ = compact
  const SCALE = N <= 6 ? 1.0 : N <= 12 ? 0.75 : 0.6;
  const STEP_H_SCALED = Math.round(STEP_H * SCALE);
  const P_H_SCALED = Math.round(P_H * SCALE);
  const FONT_SIZE_P = Math.max(8, Math.round(10 * SCALE)); // participant label font
  const FONT_SIZE_MSG = Math.max(7, Math.round(9 * SCALE)); // message label font
  const FONT_SIZE_SEQ = Math.max(6, Math.round(8 * SCALE)); // sequence badge font
  const ACT_W_SCALED = Math.max(6, Math.round(ACT_W * SCALE));
  // Wrap chars per line scales with font — fewer chars fit at smaller sizes
  const WRAP_CHARS = N <= 6 ? 16 : N <= 12 ? 13 : 11;

  const pWidths = participants.map(p => {
    const lines = wrapText(p.label, WRAP_CHARS);
    const longest = Math.max(...lines.map(l => l.length));
    // Scale box width with font size
    const pxPerCh = PX_PER_CH * SCALE;
    return Math.max(Math.round(MIN_P_W * SCALE), Math.ceil(longest * pxPerCh + BOX_H_PAD));
  });

  // Minimum arrow-bearing gap: wide enough for the longest message label
  // on any step that connects adjacent participants.
  // We estimate 6px/char for message labels at font-size 9.
  const msgLengths = steps.filter(s => s.type !== 'note' && s.from !== s.to).map(s => (s.message || '').length * 6 + 40); // +40 for badge + padding
  const minGap = msgLengths.length > 0 ? Math.max(60, ...msgLengths.map(l => Math.ceil(l / 2))) : 80;

  // Inter-participant spacing: half the left box width + gap + half the right box width
  // We simplify to: uniform gap = max(minGap, 80), each box its own width.
  const P_GAP = Math.max(minGap, 80);

  // Cumulative X offsets for each participant's centre
  const pCentres = [];
  let xCursor = PAD_SIDE;
  participants.forEach((p, i) => {
    xCursor += pWidths[i] / 2;
    pCentres.push(xCursor);
    xCursor += pWidths[i] / 2 + P_GAP;
  });

  const canvasW = xCursor - P_GAP + PAD_SIDE;
  const lifelineH = (steps.length + 1) * STEP_H_SCALED + 20;
  const canvasH = PAD_TOP + P_H_SCALED + lifelineH + P_H_SCALED + PAD_TOP;

  // Participant centre-X lookup — falls back to first participant if id unknown
  const pIdxMap = new Map(participants.map((p, i) => [p.id, i]));
  const pX = id => {
    const i = pIdxMap.has(id) ? pIdxMap.get(id) : 0;
    return pCentres[i] !== undefined ? pCentres[i] : PAD_SIDE + pWidths[0] / 2;
  };
  const pW = id => {
    const i = pIdxMap.has(id) ? pIdxMap.get(id) : 0;
    return pWidths[i] !== undefined ? pWidths[i] : MIN_P_W;
  };

  const lifelineTop = PAD_TOP + P_H_SCALED;
  const lifelineBottom = lifelineTop + lifelineH;

  const C_NAVY = '#1F3864';
  const C_NAVY_MID = '#2E5496';
  const C_SLATE = '#44546A';
  const C_BORDER = '#A8B8CC';
  const C_WHITE = '#FFFFFF';
  const C_ACT_FILL = '#D6E4F7';
  const C_RET_CLR = '#7F7F7F';
  const C_NOTE_BG = '#FFFDE7';
  const C_NOTE_BDR = '#F9A825';

  let defs = `<defs>
    <marker id="sarr" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0,9 3.5,0 7" fill="${C_NAVY_MID}"/>
    </marker>
    <marker id="rarr" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0,9 3.5,0 7" fill="${C_RET_CLR}"/>
    </marker>
  </defs>`;

  let svg = '';

  // ── Participant boxes (top) — each box width derived from label length ─────
  participants.forEach((p, i) => {
    const cx = pX(p.id);
    const pw = pW(p.id);
    const bx = cx - pw / 2;
    svg += `<rect x="${bx}" y="${PAD_TOP}" width="${pw}" height="${P_H_SCALED}" rx="4" fill="${C_NAVY}" stroke="${C_NAVY_MID}" stroke-width="1.2"/>`;
    const lblLines = wrapText(p.label, WRAP_CHARS);
    const lh = 13;
    const sy = PAD_TOP + P_H_SCALED / 2 - (lblLines.length * lh) / 2 + lh / 2;
    lblLines.forEach((line, li) => {
      svg += `<text x="${cx}" y="${sy + li * lh}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_P}" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });
  });

  // ── Lifelines ─────────────────────────────────────────────────────────────
  participants.forEach(p => {
    const cx = pX(p.id);
    svg += `<line x1="${cx}" y1="${lifelineTop}" x2="${cx}" y2="${lifelineBottom}" stroke="${C_BORDER}" stroke-width="1" stroke-dasharray="5,4"/>`;
  });

  // ── Steps ─────────────────────────────────────────────────────────────────
  let stepY = lifelineTop + STEP_H_SCALED / 2;
  let seqNum = 1;

  steps.forEach(step => {
    if (step.type === 'note') {
      // Note box spanning mentioned participants
      const pIds = step.participants || [];
      const xs = pIds.map(id => pX(id)).filter(x => x !== undefined);
      const nx = xs.length > 0 ? Math.min(...xs) - 10 : PAD_SIDE;
      const nw = xs.length > 1 ? Math.max(...xs) - nx + 10 : MIN_P_W;
      const nh = 26;
      svg += `<rect x="${nx}" y="${stepY - nh / 2}" width="${nw}" height="${nh}" rx="3" fill="${C_NOTE_BG}" stroke="${C_NOTE_BDR}" stroke-width="1"/>`;
      svg += `<text x="${nx + nw / 2}" y="${stepY + 1}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_MSG}" fill="${C_SLATE}" text-anchor="middle" dominant-baseline="middle" font-style="italic">${esc(step.message)}</text>`;
      stepY += STEP_H_SCALED;
      return;
    }

    const fx = pX(step.from);
    const tx = pX(step.to);
    const isReturn = step.type === 'return';
    const isSelf = step.from === step.to;

    // Activation bar on the "from" side
    const actX = fx - ACT_W_SCALED / 2;
    svg += `<rect x="${actX}" y="${stepY - STEP_H_SCALED * 0.35}" width="${ACT_W_SCALED}" height="${STEP_H_SCALED * 0.7}" rx="1" fill="${C_ACT_FILL}" stroke="${C_NAVY_MID}" stroke-width="0.7"/>`;

    if (isSelf) {
      // Self-message: small loop to the right
      const loopW = 36;
      const loopH = STEP_H_SCALED * 0.55;
      const x1 = fx + ACT_W_SCALED / 2;
      const y1 = stepY - loopH / 4;
      const y2 = stepY + loopH / 4;
      svg += `<path d="M${x1},${y1} Q${x1 + loopW},${y1} ${x1 + loopW},${stepY} Q${x1 + loopW},${y2} ${x1},${y2}" fill="none" stroke="${C_NAVY_MID}" stroke-width="1.3" marker-end="url(#sarr)"/>`;
      svg += `<text x="${x1 + loopW + 4}" y="${stepY + 1}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_MSG}" fill="${C_NAVY_MID}" dominant-baseline="middle">${esc(wrapText(step.message, 20)[0])}</text>`;
    } else {
      // Arrow between participants
      const goRight = fx < tx;
      const x1 = fx + (goRight ? ACT_W / 2 : -ACT_W / 2);
      const x2 = tx + (goRight ? -ARROW_PAD : ARROW_PAD);
      const dash = isReturn ? '6,3' : '';
      const marker = isReturn ? 'url(#rarr)' : 'url(#sarr)';
      const clr = isReturn ? C_RET_CLR : C_NAVY_MID;

      svg += `<line x1="${x1}" y1="${stepY}" x2="${x2}" y2="${stepY}" stroke="${clr}" stroke-width="1.4" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="${marker}"/>`;

      // Sequence badge
      const badgeX = (x1 + x2) / 2;
      svg += `<circle cx="${badgeX}" cy="${stepY - 9}" r="8" fill="${isReturn ? C_SLATE : C_NAVY}"/>`;
      svg += `<text x="${badgeX}" y="${stepY - 9}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_SEQ}" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${seqNum}</text>`;

      // Message label
      const maxLabelW = Math.abs(x2 - x1);
      const maxCh = Math.max(Math.floor(maxLabelW / 6.2) - 2, 6);
      const msgStr = step.message.length > maxCh ? step.message.slice(0, maxCh - 1) + '…' : step.message;
      svg += `<text x="${badgeX}" y="${stepY + 13}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_MSG}" fill="${clr}" text-anchor="middle">${esc(msgStr)}</text>`;
    }

    seqNum++;
    stepY += STEP_H_SCALED;
  });

  // ── Participant boxes (bottom mirror) — dynamic width matches top boxes ─────
  participants.forEach((p, i) => {
    const cx = pX(p.id);
    const pw = pW(p.id);
    const bx = cx - pw / 2;
    const by = lifelineBottom;
    svg += `<rect x="${bx}" y="${by}" width="${pw}" height="${P_H_SCALED}" rx="4" fill="${C_NAVY}" stroke="${C_NAVY_MID}" stroke-width="1.2"/>`;
    const lblLines = wrapText(p.label, WRAP_CHARS);
    const lh = 13;
    const sy = by + P_H_SCALED / 2 - (lblLines.length * lh) / 2 + lh / 2;
    lblLines.forEach((line, li) => {
      svg += `<text x="${cx}" y="${sy + li * lh}" font-family="${FONT_FACE}" font-size="${FONT_SIZE_P}" font-weight="700" fill="${C_WHITE}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <rect width="${canvasW}" height="${canvasH}" fill="white"/>
  ${defs}
  ${svg}
</svg>`;
}

// ---------------------------------------------------------------------------
// SVG → PNG via sharp
// ---------------------------------------------------------------------------

async function svgToPng(svgString, width) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    dbg('sharp not installed — run: npm install sharp');
    return null;
  }
  try {
    // Render at native SVG canvas size when the SVG is wider than requested width.
    // withoutEnlargement: true = never upscale small diagrams (they stay at native size).
    // For wide diagrams (sequence, network) the SVG canvas is already correctly sized
    // from the layout engine, so we skip forced downscaling which makes labels unreadable.
    const sharpBuf = Buffer.from(svgString, 'utf8');
    // Parse natural width from SVG viewBox/width to decide whether to resize
    const svgWidthMatch = svgString.match(/(?:width|viewBox)=["'][^"']*?(\d{3,5})/);
    const naturalW = svgWidthMatch ? parseInt(svgWidthMatch[1], 10) : width;
    const buf = naturalW > width ? await sharp(sharpBuf, { density: 150 }).resize({ width, withoutEnlargement: true }).png().toBuffer() : await sharp(sharpBuf, { density: 150 }).png().toBuffer();
    dbg(`SVG→PNG: ${buf.length} bytes`);
    return buf.length > 0 ? buf : null;
  } catch (e) {
    dbg(`sharp error: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: mermaidToPng
// ---------------------------------------------------------------------------

/**
 * Converts Mermaid syntax (string[] or string) to a PNG Buffer.
 *
 * Supports: flowchart, graph, erDiagram, sequenceDiagram
 * Returns null on failure → caller uses mermaidBlock code-listing fallback.
 *
 * @param {string|string[]} mermaidSource
 * @param {object}  [opts]
 * @param {number}  [opts.width=900]
 * @returns {Promise<Buffer|null>}
 */
async function mermaidToPng(mermaidSource, opts = {}) {
  log('mermaid-generator.js v7 — rendering (no browser required)');

  const raw = Array.isArray(mermaidSource) ? mermaidSource.join('\n') : String(mermaidSource || '');
  if (!raw.trim()) return null;

  const source = sanitise(raw);
  const width = opts.width || 900;
  const srcLines = source.split('\n');

  // Detect diagram type from first non-empty line
  const firstLine =
    source
      .trim()
      .split('\n')
      .find(l => l.trim()) || '';
  const isEr = /^erDiagram/i.test(firstLine);
  const isSequence = /^sequenceDiagram/i.test(firstLine);

  dbg(`type: ${isEr ? 'erDiagram' : isSequence ? 'sequenceDiagram' : 'flowchart'}, width: ${width}`);

  let svg;
  if (isEr) svg = buildErSvg(srcLines);
  else if (isSequence) svg = buildSequenceSvg(srcLines);
  else svg = buildFlowchartSvg(srcLines);

  if (!svg) {
    log('Diagram SVG build failed — dagre may not be installed or source is empty.');
    log('Fix: cd <everything-claude-code> && npm install @dagrejs/dagre sharp');
    log('Falling back to Mermaid code block.');
    return null;
  }

  const png = await svgToPng(svg, width);
  if (png) {
    log(`Diagram rendered successfully (${png.length} bytes)`);
    return png;
  }

  log('Diagram PNG conversion failed — sharp may not be installed.');
  log('Fix: cd <everything-claude-code> && npm install sharp');
  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator — called by sds-doc.js
// ---------------------------------------------------------------------------

async function buildSdsDiagrams(sdsRenderData) {
  const {
    architectureDiagramLines = [],
    databaseErDiagramLines = [],
    dataFlowDiagramLines = [],
    networkDiagram,
    useCaseDiagram,
    useCaseDiagrams,
    flowchartDiagram,
    databaseErDiagram,
    sequenceDiagrams, // array — one UML sequence diagram per feature group
    deploymentDiagram // deployment topology diagram
  } = sdsRenderData;

  async function getDims(buf) {
    if (!buf) return null;
    try {
      const sharp = require('sharp');
      const meta = await sharp(buf).metadata();
      if (meta.width && meta.height) return { w: meta.width, h: meta.height };
    } catch {
      /* unavailable */
    }
    return null;
  }

  // ── Tier 1: Mermaid → PNG ─────────────────────────────────────────────────
  // dataFlowDiagramLines = agent's Mermaid flowchart for the data flow overview section
  const [archPng, erPngMermaid, dataFlowPng] = await Promise.all([
    mermaidToPng(architectureDiagramLines, { width: 2400 }),
    mermaidToPng(databaseErDiagramLines, { width: 2800 }),
    mermaidToPng(dataFlowDiagramLines, { width: 2000 })
  ]);

  // ── Tier 2: custom SVG builders ───────────────────────────────────────────
  let netPng = null,
    fcPng = null,
    erCustomPng = null,
    deployPng = null;
  const ucPngsWithDims = []; // { png, dims } per UC domain
  const seqPngsWithDims = []; // { png, dims } per feature sequence diagram

  try {
    const sdsDiagrams = require('./sds-diagrams');

    // Network
    if (networkDiagram && typeof networkDiagram === 'object') {
      const svg = sdsDiagrams.buildNetworkSvg(networkDiagram);
      if (svg) netPng = await svgToPng(svg, 1800);
    }

    // Flowchart
    if (flowchartDiagram && typeof flowchartDiagram === 'object') {
      const svg = sdsDiagrams.buildFlowchartSvg(flowchartDiagram);
      if (svg) fcPng = await svgToPng(svg, 1800);
    }

    // ERD — single image rendered at 4000px wide
    if (databaseErDiagram && typeof databaseErDiagram === 'object' && Array.isArray(databaseErDiagram.entities)) {
      const svg = sdsDiagrams.buildErSvg(databaseErDiagram);
      if (svg) erCustomPng = await svgToPng(svg, 4000);
    }

    // Deployment diagram
    if (deploymentDiagram && typeof deploymentDiagram === 'object') {
      const svg = sdsDiagrams.buildDeploymentDiagramSvg(deploymentDiagram);
      if (svg) deployPng = await svgToPng(svg, 1800);
    }

    // Per-feature sequence diagrams — UML swimlane format
    const seqArray = Array.isArray(sequenceDiagrams) ? sequenceDiagrams : [];
    for (const seqDiag of seqArray) {
      if (!seqDiag || typeof seqDiag !== 'object') {
        seqPngsWithDims.push({ png: null, dims: null });
        continue;
      }
      try {
        const svg = sdsDiagrams.buildSequenceDiagramSvg(seqDiag);
        const png = svg ? await svgToPng(svg, 1600) : null;
        seqPngsWithDims.push({ png, dims: await getDims(png) });
      } catch (e) {
        dbg(`sequenceDiagramSvg failed: ${e.message}`);
        seqPngsWithDims.push({ png: null, dims: null });
      }
    }

    // Use case diagrams — one per domain
    const ucArray = Array.isArray(useCaseDiagrams) && useCaseDiagrams.length > 0 ? useCaseDiagrams : useCaseDiagram ? [useCaseDiagram] : [];

    for (const ucDiag of ucArray) {
      if (!ucDiag || typeof ucDiag !== 'object') {
        ucPngsWithDims.push({ png: null, dims: null });
        continue;
      }
      try {
        const svg = sdsDiagrams.buildUseCaseSvg(ucDiag);
        const png = svg ? await svgToPng(svg, 1400) : null;
        ucPngsWithDims.push({ png, dims: await getDims(png) });
      } catch (e) {
        dbg(`useCaseSvg failed: ${e.message}`);
        ucPngsWithDims.push({ png: null, dims: null });
      }
    }
  } catch (err) {
    dbg(`sds-diagrams.js failed: ${err.message}`);
  }

  // ERD: Tier 2 custom SVG preferred over Tier 1 Mermaid
  const finalErPng = erCustomPng || erPngMermaid || null;

  const [archDims, erDims, netDims, fcDims, deployDims] = await Promise.all([getDims(archPng), getDims(finalErPng), getDims(netPng), getDims(fcPng), getDims(deployPng)]);

  const [dfDims] = await Promise.all([getDims(dataFlowPng)]);

  return {
    architecturePng: archPng,
    architectureDims: archDims,
    erDiagramPng: finalErPng,
    erDiagramDims: erDims,
    dataFlowPng: dataFlowPng,
    dataFlowDims: dfDims,
    networkPng: netPng,
    networkDims: netDims,
    useCasePng: ucPngsWithDims[0]?.png || null,
    useCaseDims: ucPngsWithDims[0]?.dims || null,
    ucPngsWithDims,
    seqPngsWithDims, // array of { png, dims } per feature
    flowchartPng: fcPng,
    flowchartDims: fcDims,
    deploymentPng: deployPng,
    deploymentDims: deployDims
  };
}

// ---------------------------------------------------------------------------
// Save diagrams to .sdlc/artifacts/diagrams/ for /proposal reuse
// ---------------------------------------------------------------------------

async function saveDiagramsToDisk(diagrams, projectRoot) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(projectRoot, '.sdlc', 'artifacts', 'diagrams');
  fs.mkdirSync(dir, { recursive: true });

  const saved = {};

  const slots = [
    ['architecture', diagrams.architecturePng],
    ['er-diagram', diagrams.erDiagramPng],
    ['data-flow', diagrams.dataFlowPng],
    ['network', diagrams.networkPng],
    ['flowchart', diagrams.flowchartPng],
    ['deployment', diagrams.deploymentPng]
  ];

  for (const [key, buf] of slots) {
    if (!buf || !Buffer.isBuffer(buf)) continue;
    const fpath = path.join(dir, `${key}.png`);
    try {
      fs.writeFileSync(fpath, buf);
      saved[key] = fpath;
      log(`Saved: ${fpath}`);
    } catch (e) {
      dbg(`Save failed ${key}: ${e.message}`);
    }
  }

  // Per-feature sequence diagrams
  const seqPngs = diagrams.seqPngsWithDims || [];
  seqPngs.forEach(({ png }, i) => {
    if (!png || !Buffer.isBuffer(png)) return;
    const fpath = path.join(dir, `sequence-${i}.png`);
    try {
      fs.writeFileSync(fpath, png);
      saved[`sequence-${i}`] = fpath;
    } catch (e) {
      dbg(`Save failed sequence-${i}: ${e.message}`);
    }
  });

  // Use case diagrams
  const ucPngs = diagrams.ucPngsWithDims || [];
  ucPngs.forEach(({ png }, i) => {
    if (!png || !Buffer.isBuffer(png)) return;
    const fpath = path.join(dir, `use-case-${i}.png`);
    try {
      fs.writeFileSync(fpath, png);
      saved[`use-case-${i}`] = fpath;
    } catch (e) {
      dbg(`Save failed use-case-${i}: ${e.message}`);
    }
  });

  return saved;
}
module.exports = {
  mermaidToPng,
  buildSdsDiagrams,
  saveDiagramsToDisk,
  // Legacy exports kept for compatibility
  findChrome: () => null,
  findMmdc: () => 'mmdc'
};
