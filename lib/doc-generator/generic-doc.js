'use strict';

const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  PageNumber,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignSection,
  WidthType
} = require('docx');

const {
  buildBaseStylesFromTemplate,
  buildDocumentStyles,
  buildNumberingConfig,
  buildPageSetupFromTemplateFormat,
  buildThreeColumnParagraph,
  mmToTwip,
  tableHeaderShading,
  tableRowShading,
  text,
  THEME
} = require('./styles');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function resolveTokenValue(token, data, fallback) {
  const value = data ? data[token] : undefined;
  if (isEmpty(value)) return fallback;
  return value;
}

function resolveStringTemplate(value, data) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, token) => {
    const v = resolveTokenValue(token, data, 'TBD');
    // Coerce numbers/booleans to string so {sectionNumber} resolves correctly
    if (v == null) return 'TBD';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return 'TBD';
  });
}

function normalizeCellValue(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) {
    const joined = value.map(v => String(v)).join(', ');
    return joined || '—';
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s || '—';
}

function resolvePlaceholder(value, data, placeholderType, tableColumns) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^\{([a-zA-Z0-9_]+)\}$/);
  if (!match) return resolveStringTemplate(value, data);

  const token = match[1];

  if (placeholderType === 'tableRows') {
    const rows = resolveTokenValue(token, data, null);
    if (Array.isArray(rows) && rows.length > 0) return rows;
    const keys = Array.isArray(tableColumns) ? tableColumns.map(c => c.key) : [];
    const row = {};
    for (const k of keys) row[k] = 'TBD';
    return [row];
  }

  if (placeholderType === 'arrayOfStrings') {
    const arr = resolveTokenValue(token, data, null);
    if (Array.isArray(arr) && arr.length > 0) return arr;
    return ['TBD'];
  }

  const s = resolveTokenValue(token, data, 'TBD');
  return typeof s === 'string' ? s : 'TBD';
}

// ---------------------------------------------------------------------------
// Spacing helpers
// ---------------------------------------------------------------------------

function normalSpacing(layout) {
  if (!layout) return undefined;
  return {
    line: layout.lineTwip,
    lineRule: LineRuleType.AUTO,
    after: layout.afterParagraph
  };
}

function headingSpacing(layout, level = 1) {
  if (!layout) return undefined;
  const before = level === 1 ? layout.beforeHeading : layout.beforeH2;
  return {
    line: layout.lineTwip,
    lineRule: LineRuleType.AUTO,
    before,
    after: layout.afterHeading
  };
}

function headingLevelNumber(headingEnum) {
  if (headingEnum === HeadingLevel.TITLE) return 0;
  if (headingEnum === HeadingLevel.HEADING_1) return 1;
  if (headingEnum === HeadingLevel.HEADING_2) return 2;
  if (headingEnum === HeadingLevel.HEADING_3) return 3;
  return 1;
}

function createLayoutContext(template) {
  const format = template && template.format;
  if (!format) return null;
  const d = format.defaults || {};
  const s = (format.layout && format.layout.spacing) || {};
  const page = format.page || {};
  const margins = page.marginsMm || {};
  const pt = (val, fallbackPt) => Math.round(Number(val ?? fallbackPt) * 20);
  const lineSpacing = Number(d.lineSpacing ?? 1.15);
  const lineTwip = Math.round(240 * lineSpacing);
  return {
    lineTwip,
    afterParagraph: pt(s.paragraphAfterPt, d.paragraphSpacingAfterPt ?? 12),
    beforeHeading: pt(s.headingBeforePt, 22),
    afterHeading: pt(s.headingAfterPt, 12),
    afterTable: pt(s.tableAfterPt, 14),
    beforeH2: pt(s.h2BeforePt, 16),
    // Margin twips — used by getBodyWidthTwips for DXA table and image sizing
    leftMarginTwip: mmToTwip(margins.left ?? 25),
    rightMarginTwip: mmToTwip(margins.right ?? 20)
  };
}

// ---------------------------------------------------------------------------
// Paragraph builders
// ---------------------------------------------------------------------------

function paragraphFromText(value, options = {}, layout = null) {
  const isHeading = options.heading !== undefined && options.heading !== null;
  const level = isHeading ? headingLevelNumber(options.heading) : 1;
  const spacing = isHeading ? headingSpacing(layout, level) : normalSpacing(layout);
  return new Paragraph({
    children: [text(value, { bold: options.bold })],
    heading: options.heading,
    alignment: options.alignment,
    spacing
  });
}

/**
 * Proper bullet list using the ecc-bullet numbering reference.
 */
function buildBullets(items, layout) {
  return items.map(
    item =>
      new Paragraph({
        children: [new TextRun({ text: String(item) })],
        numbering: { reference: 'ecc-bullet', level: 0 },
        spacing: normalSpacing(layout)
      })
  );
}

/**
 * Proper numbered list using the ecc-decimal numbering reference.
 * Each call gets a unique instance so Word resets the counter to 1 independently
 * for each list — objectives and deliverables each start from 1.
 */
let _numberedListInstance = 0;
function buildNumbered(items, layout) {
  const instance = ++_numberedListInstance;
  return items.map(
    item =>
      new Paragraph({
        children: [new TextRun({ text: String(item) })],
        numbering: { reference: 'ecc-decimal', level: 0, instance },
        spacing: normalSpacing(layout)
      })
  );
}

// ---------------------------------------------------------------------------
// Table builder — with shaded header, alternating rows, column widths
// ---------------------------------------------------------------------------

/**
 * Compute the page body width in twips from the layout context.
 * Falls back to A4 with standard margins if layout carries no page info.
 *
 * Why DXA (twips) instead of PERCENTAGE:
 *   Word's pct type requires values in fiftieths-of-a-percent but the docx
 *   library serialises them as literal "50%" strings, which desktop Word
 *   tolerates but mobile renderers (Word iOS, Google Docs mobile) reject —
 *   causing columns to collapse or render vertically.
 *   DXA (absolute twip widths) + TableLayoutType.FIXED is the only format
 *   guaranteed to render identically across all platforms and screen sizes.
 */
function getBodyWidthTwips(layout) {
  // A4: 11906 twips. Default margins: left 25mm, right 20mm.
  // These match the scope-template.json page.marginsMm values.
  const pageW = 11906;
  const leftTwip = layout && layout.leftMarginTwip ? layout.leftMarginTwip : mmToTwip(25);
  const rightTwip = layout && layout.rightMarginTwip ? layout.rightMarginTwip : mmToTwip(20);
  return pageW - leftTwip - rightTwip;
}

/**
 * Build a styled table with shaded header and alternating data rows.
 *
 * @param {Array}       columns   — column definitions from template (key, label, widthPct)
 * @param {Array}       rows      — data rows resolved from render data
 * @param {object|null} layout    — layout context
 * @param {object|null} data      — full render data; used to interpolate {tokens} in column labels
 */
function buildTable(columns, rows, layout, data) {
  const cellSpacing = normalSpacing(layout);
  const bodyW = getBodyWidthTwips(layout);

  // Convert percentage widths → absolute DXA twip widths.
  // If no widthPct is given distribute columns evenly.
  const totalPct = columns.reduce((sum, c) => sum + (c.widthPct || 0), 0);
  const colWidths = columns.map(col => {
    if (col.widthPct) return Math.round((bodyW * col.widthPct) / 100);
    return Math.round(bodyW / columns.length);
  });
  // Absorb any rounding remainder into the last column
  const allocated = colWidths.reduce((a, b) => a + b, 0);
  colWidths[colWidths.length - 1] += bodyW - allocated;

  void totalPct; // used implicitly through colWidths

  // ── Header row ────────────────────────────────────────────────────────────
  // Column labels are interpolated against render data so that tokens like
  // {currency} in the template JSON resolve to their actual values (e.g. PKR).
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(
      (col, i) =>
        new TableCell({
          shading: tableHeaderShading(),
          width: { size: colWidths[i], type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [text(resolveStringTemplate(col.label, data), { bold: true, color: 'FFFFFF' })],
              spacing: cellSpacing
            })
          ]
        })
    )
  });

  // ── Data rows ─────────────────────────────────────────────────────────────
  const dataRows = rows.map(
    (row, rowIdx) =>
      new TableRow({
        children: columns.map(
          (col, i) =>
            new TableCell({
              shading: tableRowShading(rowIdx),
              width: { size: colWidths[i], type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: normalizeCellValue(row && row[col.key]) })],
                  spacing: cellSpacing
                })
              ]
            })
        )
      })
  );

  const table = new Table({
    // Absolute width + FIXED layout = consistent across all platforms and screen sizes
    width: { size: bodyW, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    // columnWidths drives the w:tblGrid element — without this every gridCol = 100
    // which causes mobile renderers to ignore FIXED layout and reflow columns freely
    columnWidths: colWidths,
    // Cell padding: 60 twips top/bottom (~1mm), 100 twips left/right (~1.8mm)
    // Without this, text touches the cell border on mobile viewers
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rows: [headerRow, ...dataRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '1F3864' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '1F3864' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' }
    }
  });

  const after = layout ? layout.afterTable : 240;
  return [table, new Paragraph({ text: '', spacing: { after } })];
}

// ---------------------------------------------------------------------------
// Image (diagram) embedding
// ---------------------------------------------------------------------------

/**
 * Wraps a PNG Buffer as a docx ImageRun centred in a Paragraph.
 *
 * In docx v9 the only property that controls rendered size is
 * `transformation.width` / `transformation.height` in **pixels at 96 dpi**.
 * The `emus` property is silently ignored by this version — do not pass it.
 *
 * Conversion: 1 inch = 914400 EMU = 96px  →  1px = 9525 EMU.
 * A4 body width with 25mm left + 20mm right margins = 165mm = ~624px.
 *
 * @param {Buffer}  pngBuffer
 * @param {number}  widthPx   — desired rendered width in px (fits within page body)
 * @param {number}  heightPx  — desired rendered height in px
 * @param {object|null} layout
 * @returns {Paragraph}
 */
function buildImageParagraph(pngBuffer, widthPx, heightPx, layout) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: layout ? layout.beforeH2 : 240, after: layout ? layout.afterTable : 240 },
    children: [
      new ImageRun({
        data: pngBuffer,
        type: 'png',
        transformation: {
          width: Math.round(widthPx),
          height: Math.round(heightPx)
        }
      })
    ]
  });
}

// ---------------------------------------------------------------------------
// Section type handlers
// ---------------------------------------------------------------------------

function buildSubsections(subsections, data, headingLevel, layout) {
  const nodes = [];
  const level = headingLevel || HeadingLevel.HEADING_2;
  for (const subsection of subsections || []) {
    if (!subsection || typeof subsection !== 'object') continue;
    if (typeof subsection.heading === 'string' && subsection.heading.trim()) {
      nodes.push(paragraphFromText(resolveStringTemplate(subsection.heading, data), { heading: level }, layout));
    }
    if (subsection.paragraphs !== undefined) {
      const paras = resolvePlaceholder(subsection.paragraphs, data, 'arrayOfStrings');
      for (const p of paras) {
        nodes.push(new Paragraph({ text: String(p), spacing: normalSpacing(layout) }));
      }
    }
    if (subsection.bullets !== undefined) {
      const bullets = resolvePlaceholder(subsection.bullets, data, 'arrayOfStrings');
      nodes.push(...buildBullets(bullets, layout));
    }
    if (subsection.numbered !== undefined) {
      const numbered = resolvePlaceholder(subsection.numbered, data, 'arrayOfStrings');
      nodes.push(...buildNumbered(numbered, layout));
    }
    // tableId — render the table inline directly under the subsection heading.
    // Column specs come from data._tableDefs[tableId].
    // Row data comes from data._tableRows[tableId] (a mapping set up by srs-render-data).
    // This fixes definitions/userClasses tables appearing as orphaned H1 sections.
    if (typeof subsection.tableId === 'string' && subsection.tableId.trim()) {
      const tid = subsection.tableId;
      const colDefs = data._tableDefs && data._tableDefs[tid];
      // _tableRows maps tableId → actual data array key (e.g. 'userClassesTable' → data.userClasses)
      const rowsKey = data._tableRows && data._tableRows[tid] ? data._tableRows[tid] : tid;
      const tableData = data[rowsKey];
      if (Array.isArray(tableData) && tableData.length > 0 && Array.isArray(colDefs)) {
        nodes.push(...buildTable(colDefs, tableData, layout, data));
      }
    }
    if (Array.isArray(subsection.subsections) && subsection.subsections.length > 0) {
      nodes.push(...buildSubsections(subsection.subsections, data, HeadingLevel.HEADING_3, layout));
    }
  }
  return nodes;
}

function buildRequirementsTable(section, data, layout) {
  const content = section.content || {};
  const heading = resolveStringTemplate(content.heading || '', data);
  const subheading = resolveStringTemplate(content.subheading || '', data);
  const columns = Array.isArray(content.columns) ? content.columns : [];
  const rows = resolvePlaceholder(content.rows, data, 'tableRows', columns);

  const nodes = [];
  if (heading) nodes.push(paragraphFromText(heading, { heading: HeadingLevel.HEADING_1 }, layout));
  if (subheading) nodes.push(paragraphFromText(subheading, { heading: HeadingLevel.HEADING_2 }, layout));
  nodes.push(...buildTable(columns, rows, layout, data));
  return nodes;
}

/**
 * Render a single value from a repeating-block row as a formatted string.
 * Empty arrays → 'N/A' instead of blank.
 * Strips existing leading "N. " or "N.  " prefixes before re-numbering,
 * preventing double numbers like "1.  1. text" when the BA agent pre-numbers items.
 */
function stripLeadingNumber(str) {
  // Matches "1. ", "1.  ", "1) ", "1 - " etc. at start of string
  return String(str)
    .replace(/^\d+[\.\)]\s+/, '')
    .replace(/^\d+\s+-\s+/, '');
}

function renderFieldValue(value, format) {
  if (value == null || value === '') return 'N/A';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'N/A';
    if (format === 'commaSeparated') return value.join(', ');
    return value.map((v, i) => `${i + 1}.  ${stripLeadingNumber(v)}`).join('\n');
  }
  return String(value);
}

/**
 * Build a 2-column detail table for one item in a repeating block.
 *
 * Visual design — matches buildTable() exactly:
 *   Row 0 (header-style): dark navy bg (#1F3864), white bold text — shows the label
 *   Row N (data-style):   alternating EBF0F5 / white — shows the value
 *   Each field = one header row (label) + one data row (value)
 *
 * Column widths: label 28% | value 72%
 * Borders, margins, spacing: identical to buildTable()
 */
function buildDetailTable(fields, row, layout) {
  const bodyW = getBodyWidthTwips(layout);
  const labelW = Math.round(bodyW * 0.28);
  const valueW = bodyW - labelW;
  const cellSpacing = normalSpacing(layout);

  const TABLE_BORDERS = {
    top: { style: BorderStyle.SINGLE, size: 4, color: '1F3864' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: '1F3864' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'A8B8CC' }
  };

  const tableRows = [];
  let dataRowIndex = 0; // used for alternating row shading

  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    const label = field.label ? String(field.label) : '';
    const key = field.key ? String(field.key) : '';
    const rawValue = row && key ? row[key] : undefined;
    const format = field.format || '';

    // Skip optional empty fields
    if (field.optional) {
      const isEmp = rawValue == null || rawValue === '' || (Array.isArray(rawValue) && rawValue.length === 0);
      if (isEmp) continue;
    }

    const isNumberedList = format === 'numberedList' || format === 'bulletList';
    const isArray = Array.isArray(rawValue) && rawValue.length > 0;

    // ── Value cell children ─────────────────────────────────────────────────
    let valueCellChildren;
    if (isArray && isNumberedList) {
      valueCellChildren = rawValue.map(
        (item, i) =>
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}.  ${stripLeadingNumber(String(item))}`, font: 'Calibri', size: 20 })],
            spacing: { ...(cellSpacing || {}), after: 60 }
          })
      );
    } else {
      const rendered = renderFieldValue(rawValue, format);
      valueCellChildren = [
        new Paragraph({
          children: [new TextRun({ text: rendered, font: 'Calibri', size: 20 })],
          spacing: cellSpacing
        })
      ];
    }

    // ── Header row: navy bg, white bold label ───────────────────────────────
    tableRows.push(
      new TableRow({
        tableHeader: false,
        children: [
          new TableCell({
            shading: tableHeaderShading(), // navy #1F3864
            width: { size: labelW, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [new TextRun({ text: label, bold: true, color: THEME.tableHeaderText, font: 'Calibri', size: 20 })],
                spacing: cellSpacing
              })
            ]
          }),
          new TableCell({
            shading: tableRowShading(dataRowIndex), // alternating data shading
            width: { size: valueW, type: WidthType.DXA },
            children: valueCellChildren
          })
        ]
      })
    );

    dataRowIndex++;
  }

  if (tableRows.length === 0) return [];

  const table = new Table({
    width: { size: bodyW, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [labelW, valueW],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rows: tableRows,
    borders: TABLE_BORDERS
  });

  const after = layout ? layout.afterTable : 240;
  return [table, new Paragraph({ text: '', spacing: { after } })];
}

function buildRepeatingBlock(section, data, layout) {
  const content = section.content || {};
  const nodes = [];
  const heading = resolveStringTemplate(content.heading || '', data);
  if (heading) nodes.push(paragraphFromText(heading, { heading: HeadingLevel.HEADING_1 }, layout));
  if (typeof content.note === 'string' && content.note.trim()) {
    nodes.push(new Paragraph({ text: resolveStringTemplate(content.note, data), spacing: normalSpacing(layout) }));
  }

  const rows = resolvePlaceholder(content.rows, data, 'tableRows', []);
  const itemTemplate = content.itemTemplate || {};
  const titleFormat = typeof itemTemplate.titleFormat === 'string' ? itemTemplate.titleFormat : '{id}';
  const fields = Array.isArray(itemTemplate.fields) ? itemTemplate.fields : [];
  // When layout === 'table', render each item as a 2-col detail table
  const useTableLayout = itemTemplate.layout === 'table';

  for (const row of rows) {
    const title = resolveStringTemplate(titleFormat, row || {});
    nodes.push(paragraphFromText(title, { heading: HeadingLevel.HEADING_2 }, layout));

    if (useTableLayout) {
      nodes.push(...buildDetailTable(fields, row, layout));
    } else {
      for (const field of fields) {
        if (!field || typeof field !== 'object') continue;
        const label = field.label ? String(field.label) : '';
        const key = field.key ? String(field.key) : '';
        const value = row && key ? row[key] : undefined;
        if (field.optional && isEmpty(value)) continue;
        const rendered = normalizeCellValue(value == null ? 'N/A' : value) || 'N/A';
        nodes.push(
          new Paragraph({
            children: [text(label ? `${label}: ` : '', { bold: !!label }), text(rendered)],
            spacing: normalSpacing(layout)
          })
        );
      }
    }
    nodes.push(new Paragraph({ text: '', spacing: normalSpacing(layout) }));
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Gantt chart — custom SVG renderer (navy/slate palette matching SRS theme)
// ---------------------------------------------------------------------------

/**
 * Build a Gantt chart SVG from a ganttTasks[] array.
 *
 * Each task: { id, name, start:'YYYY-MM-DD', end:'YYYY-MM-DD', phase, done:bool }
 * Returns an SVG string suitable for conversion to PNG via sharp.
 */
function buildGanttSvg(tasks, projectTitle) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const FONT = 'Calibri,Arial,sans-serif';
  const C_NAVY = '#1F3864';
  const C_BLUE = '#2E5496';
  const C_SLATE = '#44546A';
  const C_DONE = '#2E5496'; // completed bar — medium navy
  const C_ACTIVE = '#375623'; // active bar — green
  const C_PENDING = '#A8B8CC'; // future bar — pale slate
  const C_HDR_BG = '#1F3864'; // header background
  const C_HDR_TEXT = '#FFFFFF';
  const C_ROW_ODD = '#FFFFFF';
  const C_ROW_EVEN = '#EBF0F5';
  const C_GRID = '#D6DCE4';
  const C_BORDER = '#A8B8CC';

  const TITLE_H = 36;
  const HDR_H = 32;
  const ROW_H = 26;
  const LABEL_W = 220; // left panel width (task name)
  const COL_INFO_W = 72; // duration column
  const LEFT_W = LABEL_W + COL_INFO_W;
  const PAD_LEFT = 12;
  const PAD_RIGHT = 20;
  const FONT_SIZE = 11;
  const BAR_H = 14;
  const BAR_RADIUS = 3;

  // Parse date string to JS Date (UTC)
  function parseDate(s) {
    if (!s) return null;
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  // Format date as "DD Mon YY"
  function fmtDate(d) {
    if (!d) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }

  // Parse all dates, compute chart range
  const parsed = tasks
    .map(t => ({
      ...t,
      startD: parseDate(t.start),
      endD: parseDate(t.end)
    }))
    .filter(t => t.startD && t.endD);

  if (parsed.length === 0) return null;

  const minDate = new Date(Math.min(...parsed.map(t => t.startD)));
  const maxDate = new Date(Math.max(...parsed.map(t => t.endD)));
  // Add small padding
  minDate.setUTCDate(minDate.getUTCDate() - 7);
  maxDate.setUTCDate(maxDate.getUTCDate() + 14);
  const totalDays = (maxDate - minDate) / 86400000;

  const CHART_W = 680; // timeline area width
  const TOTAL_W = LEFT_W + CHART_W + PAD_RIGHT;
  const TOTAL_H = TITLE_H + HDR_H + parsed.length * ROW_H + 20;

  function dateToX(d) {
    const days = (d - minDate) / 86400000;
    return LEFT_W + Math.round((days / totalDays) * CHART_W);
  }

  // Build month tick marks for header
  const months = [];
  const cur = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));
  while (cur <= maxDate) {
    months.push(new Date(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  let svg = '';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Title bar ──────────────────────────────────────────────────────────────
  svg += `<rect x="0" y="0" width="${TOTAL_W}" height="${TITLE_H}" fill="${C_HDR_BG}"/>`;
  svg += `<text x="${TOTAL_W / 2}" y="${TITLE_H / 2 + 5}" font-family="${FONT}" font-size="14" font-weight="700" fill="${C_HDR_TEXT}" text-anchor="middle">${esc(projectTitle || 'Project Schedule')}</text>`;

  // ── Column header row ──────────────────────────────────────────────────────
  const hdrY = TITLE_H;
  svg += `<rect x="0" y="${hdrY}" width="${TOTAL_W}" height="${HDR_H}" fill="${C_HDR_BG}"/>`;
  svg += `<text x="${PAD_LEFT}" y="${hdrY + HDR_H / 2 + 4}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="700" fill="${C_HDR_TEXT}">Task Name</text>`;
  svg += `<text x="${LABEL_W + COL_INFO_W / 2}" y="${hdrY + HDR_H / 2 + 4}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="700" fill="${C_HDR_TEXT}" text-anchor="middle">Duration</text>`;

  // Month labels in timeline header
  months.forEach(m => {
    const x = dateToX(m);
    if (x < LEFT_W || x > LEFT_W + CHART_W) return;
    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    svg += `<text x="${x + 2}" y="${hdrY + HDR_H / 2 + 4}" font-family="${FONT}" font-size="9" fill="${C_HDR_TEXT}">${mNames[m.getUTCMonth()]} ${m.getUTCFullYear()}</text>`;
  });

  // ── Vertical grid lines (month boundaries) ─────────────────────────────────
  const bodyTop = TITLE_H + HDR_H;
  const bodyBot = TITLE_H + HDR_H + parsed.length * ROW_H;
  months.forEach(m => {
    const x = dateToX(m);
    if (x < LEFT_W || x > LEFT_W + CHART_W) return;
    svg += `<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyBot}" stroke="${C_GRID}" stroke-width="1"/>`;
  });

  // ── Today line ─────────────────────────────────────────────────────────────
  const today = new Date();
  const todayX = dateToX(today);
  if (todayX >= LEFT_W && todayX <= LEFT_W + CHART_W) {
    svg += `<line x1="${todayX}" y1="${bodyTop}" x2="${todayX}" y2="${bodyBot}" stroke="#C00000" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }

  // ── Task rows ──────────────────────────────────────────────────────────────
  parsed.forEach((t, i) => {
    const rowY = bodyTop + i * ROW_H;
    const fill = i % 2 === 0 ? C_ROW_ODD : C_ROW_EVEN;

    // Row background (full width)
    svg += `<rect x="0" y="${rowY}" width="${TOTAL_W}" height="${ROW_H}" fill="${fill}"/>`;

    // Left panel separator
    svg += `<line x1="${LEFT_W}" y1="${rowY}" x2="${LEFT_W}" y2="${rowY + ROW_H}" stroke="${C_BORDER}" stroke-width="0.5"/>`;
    svg += `<line x1="${LABEL_W}" y1="${rowY}" x2="${LABEL_W}" y2="${rowY + ROW_H}" stroke="${C_BORDER}" stroke-width="0.5"/>`;

    // Task name (truncate at ~28 chars)
    const taskName = t.name.length > 28 ? t.name.slice(0, 26) + '…' : t.name;
    const isPhaseHeader = t.isPhase;
    const nameColor = isPhaseHeader ? C_NAVY : C_SLATE;
    const nameWeight = isPhaseHeader ? '700' : '400';
    const namePadLeft = isPhaseHeader ? PAD_LEFT : PAD_LEFT + 8;
    svg += `<text x="${namePadLeft}" y="${rowY + ROW_H / 2 + 4}" font-family="${FONT}" font-size="${FONT_SIZE - 1}" font-weight="${nameWeight}" fill="${nameColor}">${esc(taskName)}</text>`;

    // Duration column
    if (!isPhaseHeader) {
      const durDays = Math.round((t.endD - t.startD) / 86400000);
      svg += `<text x="${LABEL_W + COL_INFO_W / 2}" y="${rowY + ROW_H / 2 + 4}" font-family="${FONT}" font-size="9" fill="${C_SLATE}" text-anchor="middle">${durDays}d</text>`;
    }

    // Gantt bar
    if (!isPhaseHeader) {
      const barX = dateToX(t.startD);
      const barEndX = dateToX(t.endD);
      const barW = Math.max(4, barEndX - barX);
      const barY = rowY + (ROW_H - BAR_H) / 2;
      const barColor = t.done ? C_DONE : t.active ? C_ACTIVE : C_PENDING;

      // Bar shadow (subtle)
      svg += `<rect x="${barX + 1}" y="${barY + 1}" width="${barW}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="#00000018"/>`;
      // Main bar
      svg += `<rect x="${barX}" y="${barY}" width="${barW}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${barColor}"/>`;
      // Highlight stripe on top
      svg += `<rect x="${barX + 1}" y="${barY + 1}" width="${barW - 2}" height="${Math.floor(BAR_H * 0.35)}" rx="${BAR_RADIUS}" fill="#FFFFFF28"/>`;
    }

    // Row bottom border
    svg += `<line x1="0" y1="${rowY + ROW_H}" x2="${TOTAL_W}" y2="${rowY + ROW_H}" stroke="${C_BORDER}" stroke-width="0.5"/>`;
  });

  // ── Outer border ───────────────────────────────────────────────────────────
  svg += `<rect x="0" y="0" width="${TOTAL_W}" height="${TOTAL_H}" fill="none" stroke="${C_NAVY}" stroke-width="1.5"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL_W}" height="${TOTAL_H}" viewBox="0 0 ${TOTAL_W} ${TOTAL_H}">${svg}</svg>`;
}

/**
 * Build a Gantt chart section node.
 * Renders via buildGanttSvg → PNG (if sharp available), with Mermaid fallback source below.
 */
async function buildGanttBlockAsync(section, data, layout) {
  const content = section.content || {};
  const heading = content.heading ? resolveStringTemplate(content.heading, data) : '';
  const label = content.label ? resolveStringTemplate(content.label, data) : 'Figure — Project Schedule (Gantt Chart)';
  const tasksKey = content.tasksKey || 'ganttTasks';
  const pngKey = content.pngKey || 'ganttPng';
  const dimsKey = content.dimsKey || 'ganttDims';
  const titleKey = content.titleKey || 'projectName';
  const mermaidKey = content.dataKey || 'ganttMermaid';

  const nodes = [];
  if (heading) nodes.push(paragraphFromText(heading, { heading: HeadingLevel.HEADING_1 }, layout));
  nodes.push(
    new Paragraph({
      children: [new TextRun({ text: label, italics: true, size: 20, color: '44546A', font: 'Calibri' })],
      spacing: { before: 80, after: 100 }
    })
  );

  // Try pre-rendered PNG first (injected by srs-doc.js diagram pipeline)
  let pngBuf = data && data[pngKey];
  let dims = data && data[dimsKey];

  // Build from ganttTasks[] if no pre-rendered PNG
  if (!pngBuf || !Buffer.isBuffer(pngBuf)) {
    const tasks = data && data[tasksKey];
    const chartTitle = data && data[titleKey] ? `${data[titleKey]} — Project Schedule` : 'Project Schedule';
    if (Array.isArray(tasks) && tasks.length > 0) {
      try {
        const svgString = buildGanttSvg(tasks, chartTitle);
        if (svgString) {
          const sharp = require('sharp');
          pngBuf = await sharp(Buffer.from(svgString, 'utf8')).resize({ width: 2200, withoutEnlargement: false }).png().toBuffer();
          const meta = await sharp(pngBuf).metadata();
          dims = meta.width && meta.height ? { w: meta.width, h: meta.height } : null;
        }
      } catch {
        /* sharp unavailable — fall through to Mermaid source */
      }
    }
  }

  if (pngBuf && Buffer.isBuffer(pngBuf)) {
    const bPx = Math.round((getBodyWidthTwips(layout) / 1440) * 96);
    const wPx = Math.round(bPx * 0.97);
    let hPx = Math.round(wPx * 0.45);
    if (dims && dims.w > 0 && dims.h > 0) hPx = Math.round(wPx * (dims.h / dims.w));
    try {
      nodes.push(buildImageParagraph(pngBuf, wPx, hPx, layout));
    } catch {
      /* skip */
    }
  } else {
    // Fallback: render Mermaid source as styled code block
    const lines = data && Array.isArray(data[mermaidKey]) ? data[mermaidKey] : [];
    if (lines.length > 0) {
      nodes.push(
        new Paragraph({
          children: [new TextRun({ text: 'Gantt source — paste into mermaid.live to view interactively:', italics: true, size: 18, color: '888888' })],
          spacing: { before: 120, after: 60 }
        })
      );
      for (const line of lines) {
        nodes.push(
          new Paragraph({
            children: [new TextRun({ text: String(line), font: 'Courier New', size: 18, color: '1F3864' })],
            shading: { fill: 'F3F5F8', type: 'clear', color: 'auto' },
            spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
            indent: { left: 180 }
          })
        );
      }
    } else {
      nodes.push(
        new Paragraph({
          children: [new TextRun({ text: '[Gantt chart — provide ganttTasks[] in srsData to render]', italics: true, color: '888888' })],
          spacing: normalSpacing(layout)
        })
      );
    }
    nodes.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterTable : 240 } }));
  }

  return nodes;
}

// Gantt chart block renderer.
// data.ganttPng is always pre-built by srs-doc.js before generateFromTemplate is called.
// This function just embeds the pre-built PNG. No synchronous sharp hacks needed.
function buildGanttBlock(section, data, layout) {
  const content = section.content || {};
  const heading = content.heading ? resolveStringTemplate(content.heading, data) : '';
  const label = content.label ? resolveStringTemplate(content.label, data) : 'Figure — Project Schedule (Gantt Chart)';
  const pngKey = content.pngKey || 'ganttPng';
  const dimsKey = content.dimsKey || 'ganttDims';

  const nodes = [];
  if (heading) nodes.push(paragraphFromText(heading, { heading: HeadingLevel.HEADING_1 }, layout));
  nodes.push(
    new Paragraph({
      children: [new TextRun({ text: label, italics: true, size: 20, color: '44546A', font: 'Calibri' })],
      spacing: { before: 80, after: 100 }
    })
  );

  const pngBuf = data && data[pngKey];
  const dims = data && data[dimsKey];

  if (pngBuf && Buffer.isBuffer(pngBuf)) {
    const bPx = Math.round((getBodyWidthTwips(layout) / 1440) * 96);
    const wPx = Math.round(bPx * 0.97);
    let hPx = Math.round(wPx * 0.45);
    if (dims && dims.w > 0 && dims.h > 0) hPx = Math.round(wPx * (dims.h / dims.w));
    try {
      nodes.push(buildImageParagraph(pngBuf, wPx, hPx, layout));
    } catch {
      /* skip */
    }
  } else {
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '[Gantt chart not rendered — sharp must be installed: npm install sharp]',
            italics: true,
            color: '888888',
            size: 18
          })
        ],
        spacing: normalSpacing(layout)
      })
    );
  }

  nodes.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterTable : 240 } }));
  return nodes;
}

function shouldRenderSection(section, data) {
  const expr = section && typeof section.renderCondition === 'string' ? section.renderCondition.trim() : '';
  if (!expr) return true;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('data', `return Boolean(${expr});`);
    return Boolean(fn(data || {}));
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function buildCoverNodes(content, data, layout) {
  const resolve = str => resolveStringTemplate(str || '', data);
  const title = resolve(content.title);
  const subtitle = resolve(content.subtitle);
  const clientLine = resolve(content.clientLine);
  const preparedByLine = resolve(content.preparedByLine);
  const dateLine = resolve(content.dateLine);
  const versionLine = resolve(content.versionLine);
  const statusLine = content.statusLine ? resolve(content.statusLine) : '';
  const classificationLine = resolve(content.classificationLine);

  const coverSpacing = after => ({
    line: layout ? layout.lineTwip : 276,
    lineRule: LineRuleType.AUTO,
    after
  });

  const nodes = [];

  // Project name in large, coloured title style
  nodes.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 56, // 28pt
          color: '1F3864',
          font: 'Calibri'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: coverSpacing(layout ? layout.afterHeading * 2 : 480)
    })
  );

  if (subtitle) {
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({
            text: subtitle,
            italics: true,
            size: 28, // 14pt
            color: '44546A',
            font: 'Calibri'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: coverSpacing(layout ? layout.afterParagraph * 3 : 600)
      })
    );
  }

  // Spacer
  nodes.push(new Paragraph({ text: '', spacing: coverSpacing(layout ? layout.afterParagraph * 2 : 400) }));

  // Metadata lines — slightly larger than body, muted colour
  const metaLine = str => {
    if (!str || !str.trim()) return null;
    return new Paragraph({
      children: [new TextRun({ text: str, size: 22, color: '44546A', font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: coverSpacing(layout ? layout.afterParagraph : 200)
    });
  };

  for (const line of [clientLine, preparedByLine, dateLine, versionLine, statusLine, classificationLine]) {
    const p = metaLine(line);
    if (p) nodes.push(p);
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Diagram section handler
// ---------------------------------------------------------------------------

/**
 * Handles section.type === 'diagram'.
 * Looks up the PNG buffer from data[content.dataKey] and embeds it.
 *
 * Template JSON shape:
 * {
 *   "id": "systemContext",
 *   "type": "diagram",
 *   "content": {
 *     "heading": "2.1 System Context Diagram",
 *     "caption": "...",
 *     "dataKey": "systemContextPng",
 *     "widthPct": 90
 *   }
 * }
 *
 * @param {object} section
 * @param {object} data       — render data; data[content.dataKey] must be a Buffer or null
 * @param {object|null} layout
 * @returns {Array<Paragraph|Table>}
 */
function buildDiagramSection(section, data, layout) {
  const content = section.content || {};
  const nodes = [];

  if (typeof content.heading === 'string' && content.heading.trim()) {
    nodes.push(paragraphFromText(resolveStringTemplate(content.heading, data), { heading: HeadingLevel.HEADING_2 }, layout));
  }

  const pngBuffer = data && content.dataKey ? data[content.dataKey] : null;

  if (pngBuffer && Buffer.isBuffer(pngBuffer)) {
    // Body width: twips → inches (÷1440) → px at 96dpi (×96)
    const bodyTwips = getBodyWidthTwips(layout);
    const bodyPx = Math.round((bodyTwips / 1440) * 96);
    const widthPx = Math.round(bodyPx * (Number(content.widthPct || 90) / 100));

    // Use pre-computed real PNG dimensions stored by scope-doc.js.
    // content.dimsKey names the field in data that holds { w, h } for this image.
    // Falls back to 0.70 aspect ratio if dimensions are unavailable.
    let heightPx = Math.round(widthPx * 0.7);
    const dimsKey = content.dimsKey;
    const dims = dimsKey && data ? data[dimsKey] : null;
    if (dims && dims.w > 0 && dims.h > 0) {
      heightPx = Math.round(widthPx * (dims.h / dims.w));
    }

    try {
      nodes.push(buildImageParagraph(pngBuffer, widthPx, heightPx, layout));
    } catch {
      // ImageRun failed — fall through to placeholder
    }
  } else {
    // Diagram not available — render a placeholder paragraph
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '[Diagram not available — diagram input not provided or generation failed]',
            italics: true,
            color: '888888'
          })
        ],
        spacing: normalSpacing(layout)
      })
    );
  }

  if (typeof content.caption === 'string' && content.caption.trim()) {
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({
            text: resolveStringTemplate(content.caption, data),
            italics: true,
            size: 18, // 9pt
            color: '44546A'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: normalSpacing(layout)
      })
    );
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Main section dispatcher
// ---------------------------------------------------------------------------

function buildSectionNodes(section, data, layout) {
  const nodes = [];
  const content = section.content || {};

  // ── Cover ─────────────────────────────────────────────────────────────────
  if (section.type === 'cover') {
    return buildCoverNodes(content, data, layout);
  }

  // ── Table of Contents ─────────────────────────────────────────────────────
  if (section.type === 'tableOfContents') {
    const title = resolveStringTemplate(content.title || 'Table of Contents', data);
    nodes.push(paragraphFromText(title, { heading: HeadingLevel.HEADING_1 }, layout));
    nodes.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterHeading : 200 } }));
    const levels = Array.isArray(content.includeHeadingLevels) ? content.includeHeadingLevels : [1, 2, 3];
    const nums = levels
      .map(v => Number(v))
      .filter(v => Number.isInteger(v) && v >= 1 && v <= 9)
      .sort((a, b) => a - b);
    const min = nums.length > 0 ? nums[0] : 1;
    const max = nums.length > 0 ? nums[nums.length - 1] : 3;
    nodes.push(new TableOfContents('', { hyperlink: true, headingStyleRange: `${min}-${max}` }));
    return nodes;
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  if (section.type === 'table') {
    const title = resolveStringTemplate(content.title || '', data);
    const columns = Array.isArray(content.columns) ? content.columns : [];
    const rows = resolvePlaceholder(content.rows, data, 'tableRows', columns);
    if (title) nodes.push(paragraphFromText(title, { heading: HeadingLevel.HEADING_1 }, layout));
    // Pass data so column labels with {tokens} (e.g. "Total ({currency})") resolve correctly
    nodes.push(...buildTable(columns, rows, layout, data));
    return nodes;
  }

  // ── Requirements table ────────────────────────────────────────────────────
  if (section.type === 'requirementsTable') {
    return buildRequirementsTable(section, data, layout);
  }

  // ── Repeating block ───────────────────────────────────────────────────────
  if (section.type === 'repeatingBlock') {
    return buildRepeatingBlock(section, data, layout);
  }

  // ── Gantt chart block ─────────────────────────────────────────────────────
  if (section.type === 'ganttBlock') {
    return buildGanttBlock(section, data, layout);
  }

  // ── Use Case Diagrams — dedicated section (4.3), one diagram per FEATURE ──
  if (section.type === 'useCaseDiagramsSection') {
    const c2 = section.content || {};
    const heading2 = c2.heading ? resolveStringTemplate(c2.heading, data) : '4.3 Use Case Diagrams';
    const note = c2.note ? resolveStringTemplate(c2.note, data) : '';
    const mapKey = c2.dataKey || 'ucDiagramsMap';
    const featKey = c2.featuresKey || 'systemFeatures';
    const widthPct = Number(c2.widthPct || 88);
    const allNodes = [];

    allNodes.push(paragraphFromText(heading2, { heading: HeadingLevel.HEADING_1 }, layout));
    if (note) allNodes.push(new Paragraph({ text: note, spacing: normalSpacing(layout) }));

    const diagramMap = data && data[mapKey] && typeof data[mapKey] === 'object' ? data[mapKey] : {};
    const features = data && Array.isArray(data[featKey]) ? data[featKey] : [];

    if (Object.keys(diagramMap).length === 0) {
      allNodes.push(
        new Paragraph({
          children: [new TextRun({ text: '[Use case diagrams not available — ensure srs-doc.js diagram pipeline ran successfully]', italics: true, color: '888888' })],
          spacing: normalSpacing(layout)
        })
      );
      return allNodes;
    }

    // Render in feature order (FEAT-01, FEAT-02, …)
    const featureOrder = features.map(f => f && f.featureId).filter(Boolean);
    // Add any keys not in featureOrder (e.g. GENERAL group)
    const allKeys = [...new Set([...featureOrder, ...Object.keys(diagramMap)])];

    allKeys.forEach((featureId, i) => {
      const entry = diagramMap[featureId];
      if (!entry) return;

      const diagTitle = entry.title || featureId;
      allNodes.push(paragraphFromText(`4.3.${i + 1}  ${diagTitle}`, { heading: HeadingLevel.HEADING_2 }, layout));

      // Show which UCs this diagram covers
      if (Array.isArray(entry.ucIds) && entry.ucIds.length > 0) {
        allNodes.push(
          new Paragraph({
            children: [new TextRun({ text: `Use cases covered: ${entry.ucIds.join(', ')}`, italics: true, size: 18, color: '44546A', font: 'Calibri' })],
            spacing: { before: 0, after: 80 }
          })
        );
      }

      if (entry.png && Buffer.isBuffer(entry.png)) {
        const bPx = Math.round((getBodyWidthTwips(layout) / 1440) * 96);
        const wPx = Math.round(bPx * (widthPct / 100));
        let hPx = Math.round(wPx * 0.6);
        if (entry.dims && entry.dims.w > 0 && entry.dims.h > 0) {
          hPx = Math.round(wPx * (entry.dims.h / entry.dims.w));
        }
        try {
          allNodes.push(buildImageParagraph(entry.png, wPx, hPx, layout));
        } catch {
          /* skip */
        }
        allNodes.push(
          new Paragraph({
            children: [new TextRun({ text: `Figure 4.3.${i + 1} — ${diagTitle}`, italics: true, size: 18, color: '44546A' })],
            alignment: AlignmentType.CENTER,
            spacing: normalSpacing(layout)
          })
        );
      } else {
        allNodes.push(
          new Paragraph({
            children: [new TextRun({ text: `[Diagram for ${featureId} not available]`, italics: true, color: '888888' })],
            spacing: normalSpacing(layout)
          })
        );
      }
    });

    return allNodes;
  }

  // ── Mermaid.live Plain-Text URL ────────────────────────────────────────────
  // Renders the full mermaid.live URL as PLAIN TEXT (no hyperlink).
  // This avoids all truncation issues — Word and browsers truncate long
  // hyperlinks but plain text paragraphs have no length limit.
  // The user selects the text and copies it manually into their browser.
  if (section.type === 'mermaidLiveLink') {
    const c2 = section.content || {};
    const url = data && data[c2.urlKey] ? String(data[c2.urlKey]) : null;
    const label = c2.label || 'View interactive diagram on mermaid.live';
    const note = c2.note || '(copy the full URL below and paste into your browser)';
    const nodes = [];

    if (url) {
      // Instruction line
      nodes.push(
        new Paragraph({
          children: [new TextRun({ text: '» ' + label + '  ', size: 18, bold: true, color: '2E5496' }), new TextRun({ text: note, size: 16, color: '888888', italics: true })],
          spacing: normalSpacing(layout)
        })
      );
      // Full URL as plain text — no hyperlink, no truncation
      nodes.push(
        new Paragraph({
          children: [
            new TextRun({
              text: url,
              font: 'Courier New',
              size: 16,
              color: '1F3864',
              break: 0
            })
          ],
          spacing: { before: 0, after: 120, line: 240, lineRule: LineRuleType.AUTO },
          indent: { left: 180 }
        })
      );
    } else {
      nodes.push(
        new Paragraph({
          children: [new TextRun({ text: '[Mermaid link not available — ensure diagram source is provided]', italics: true, size: 16, color: '888888' })],
          spacing: normalSpacing(layout)
        })
      );
    }
    return nodes;
  }

  // ── Sequence Diagrams — one per feature group ─────────────────────────────
  if (section.type === 'sequenceDiagrams') {
    const c2 = section.content || {};
    const diagrams2 = data && Array.isArray(data.sequenceDiagrams) ? data.sequenceDiagrams : [];
    const captionStart = Number(c2.captionStartIndex || 3);
    const widthPct = Number(c2.widthPct || 95);
    const prefix = c2.headingPrefix || '1.3';
    const allNodes = [];

    diagrams2.forEach((diag, i) => {
      if (!diag) return;
      allNodes.push(paragraphFromText(`${prefix}.${i + 1} Sequence Diagram — ${diag.title || 'Feature Interaction'}`, { heading: HeadingLevel.HEADING_2 }, layout));
      const buf = diag.png || null;
      if (buf && Buffer.isBuffer(buf)) {
        const bPx = Math.round((getBodyWidthTwips(layout) / 1440) * 96);
        const wPx = Math.round(bPx * (widthPct / 100));
        let hPx = Math.round(wPx * 0.5);
        if (diag.dims && diag.dims.w > 0 && diag.dims.h > 0) hPx = Math.round(wPx * (diag.dims.h / diag.dims.w));
        try {
          allNodes.push(buildImageParagraph(buf, wPx, hPx, layout));
        } catch {
          /* placeholder below */
        }
      } else {
        allNodes.push(
          new Paragraph({
            children: [new TextRun({ text: '[Sequence diagram not available]', italics: true, color: '888888' })],
            spacing: normalSpacing(layout)
          })
        );
      }
      allNodes.push(
        new Paragraph({
          children: [new TextRun({ text: `Figure ${captionStart + i} — ${diag.title || 'Sequence diagram'}`, italics: true, size: 18, color: '44546A' })],
          alignment: AlignmentType.CENTER,
          spacing: normalSpacing(layout)
        })
      );
    });

    if (allNodes.length === 0) {
      allNodes.push(paragraphFromText('Sequence Diagrams', { heading: HeadingLevel.HEADING_2 }, layout));
      allNodes.push(
        new Paragraph({
          children: [new TextRun({ text: '[No sequence diagrams — ensure apiEndpoints[] is populated]', italics: true, color: '888888' })],
          spacing: normalSpacing(layout)
        })
      );
    }
    return allNodes;
  }

  // ── Use Case Diagrams — one per domain ────────────────────────────────────
  if (section.type === 'useCaseDiagrams') {
    const c2 = section.content || {};
    const diagrams2 = data && Array.isArray(data.useCaseDiagrams) ? data.useCaseDiagrams : [];
    const captionStart = Number(c2.captionStartIndex || 4);
    const widthPct = Number(c2.widthPct || 90);
    const prefix = c2.headingPrefix || '2.1';
    const allNodes = [];

    diagrams2.forEach((diag, i) => {
      if (!diag) return;
      allNodes.push(paragraphFromText(`${prefix}.${i + 1} Use Case Diagram — ${diag.title || 'Use Cases'}`, { heading: HeadingLevel.HEADING_2 }, layout));
      const buf = diag.png || null;
      if (buf && Buffer.isBuffer(buf)) {
        const bPx = Math.round((getBodyWidthTwips(layout) / 1440) * 96);
        const wPx = Math.round(bPx * (widthPct / 100));
        let hPx = Math.round(wPx * 0.7);
        if (diag.dims && diag.dims.w > 0 && diag.dims.h > 0) hPx = Math.round(wPx * (diag.dims.h / diag.dims.w));
        try {
          allNodes.push(buildImageParagraph(buf, wPx, hPx, layout));
        } catch {
          /* placeholder below */
        }
      } else {
        allNodes.push(
          new Paragraph({
            children: [new TextRun({ text: '[Use case diagram not available]', italics: true, color: '888888' })],
            spacing: normalSpacing(layout)
          })
        );
      }
      allNodes.push(
        new Paragraph({
          children: [new TextRun({ text: `Figure ${captionStart + i} — ${diag.title || 'Use case associations'}`, italics: true, size: 18, color: '44546A' })],
          alignment: AlignmentType.CENTER,
          spacing: normalSpacing(layout)
        })
      );
    });

    if (allNodes.length === 0) {
      allNodes.push(paragraphFromText('Use Case Diagrams', { heading: HeadingLevel.HEADING_2 }, layout));
      allNodes.push(
        new Paragraph({
          children: [new TextRun({ text: '[No use case diagrams — ensure designComponents[] is populated]', italics: true, color: '888888' })],
          spacing: normalSpacing(layout)
        })
      );
    }
    return allNodes;
  }

  // ── Diagram ───────────────────────────────────────────────────────────────
  if (section.type === 'diagram') {
    return buildDiagramSection(section, data, layout);
  }

  // ── Mermaid code block ────────────────────────────────────────────────────
  // Renders Mermaid diagram syntax as a styled code listing (IEEE code appendix style).
  // heading2 = subsection heading, dataKey = key in data that holds string[] of code lines.
  // Produces: H2 heading + label paragraph + shaded monospace code paragraphs.
  if (section.type === 'mermaidBlock') {
    const heading2 = content.heading ? resolveStringTemplate(content.heading, data) : '';
    const label = content.label ? resolveStringTemplate(content.label, data) : 'Mermaid diagram source';
    const dataKey = content.dataKey || '';
    const lines = dataKey && data && Array.isArray(data[dataKey]) ? data[dataKey] : ['(diagram source not available)'];

    if (heading2) {
      nodes.push(paragraphFromText(heading2, { heading: HeadingLevel.HEADING_2 }, layout));
    }
    // Italic caption — "Figure N: ..."
    nodes.push(
      new Paragraph({
        children: [new TextRun({ text: label, italics: true, size: 20, color: '44546A', font: 'Calibri' })],
        spacing: { before: 80, after: 80 }
      })
    );
    // Note paragraph
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Paste the source below into ', size: 20, color: '666666', font: 'Calibri' }),
          new TextRun({ text: 'mermaid.live', italics: true, size: 20, color: '185FA5', font: 'Calibri' }),
          new TextRun({ text: ' or use the Word Mermaid add-in to render this diagram.', size: 20, color: '666666', font: 'Calibri' })
        ],
        spacing: { before: 0, after: 120 }
      })
    );
    // Code lines — monospace, shaded background
    for (const line of lines) {
      nodes.push(
        new Paragraph({
          children: [
            new TextRun({
              text: String(line),
              font: 'Consolas',
              size: 18, // 9pt
              color: '1F3864'
            })
          ],
          shading: { fill: 'EBF0F5', type: 'clear', color: 'auto' },
          spacing: { before: 0, after: 0 },
          indent: { left: 360 }
        })
      );
    }
    // Spacer after block
    nodes.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterTable : 240 } }));
    return nodes;
  }

  // ── Content block / appendix / index ─────────────────────────────────────
  if (section.type === 'contentBlock' || section.type === 'appendix' || section.type === 'index') {
    if (typeof content.heading === 'string') {
      nodes.push(paragraphFromText(resolveStringTemplate(content.heading, data), { heading: HeadingLevel.HEADING_1 }, layout));
    }
    if (content.paragraphs !== undefined) {
      const paras = resolvePlaceholder(content.paragraphs, data, 'arrayOfStrings');
      for (const p of paras) {
        nodes.push(new Paragraph({ text: String(p), spacing: normalSpacing(layout) }));
      }
    }
    if (content.bullets !== undefined) {
      const bullets = resolvePlaceholder(content.bullets, data, 'arrayOfStrings');
      nodes.push(...buildBullets(bullets, layout));
    }
    if (content.numbered !== undefined) {
      const numbered = resolvePlaceholder(content.numbered, data, 'arrayOfStrings');
      nodes.push(...buildNumbered(numbered, layout));
    }
    if (Array.isArray(content.subsections) && content.subsections.length > 0) {
      nodes.push(...buildSubsections(content.subsections, data, HeadingLevel.HEADING_2, layout));
    }
    return nodes;
  }

  nodes.push(new Paragraph({ text: `TBD: ${section.id || 'section'}`, spacing: normalSpacing(layout) }));
  return nodes;
}

// ---------------------------------------------------------------------------
// Header / footer
// ---------------------------------------------------------------------------

function buildRunsFromFooterText(raw, runOpts) {
  const s = typeof raw === 'string' ? raw : '';
  if (!s) return [];
  const parts = s.split(/(\{pageNumber\}|\{pageCount\})/g).filter(p => p.length > 0);
  return parts.map(part => {
    if (part === '{pageNumber}') return new TextRun({ ...runOpts, children: [PageNumber.CURRENT] });
    if (part === '{pageCount}') return new TextRun({ ...runOpts, children: [PageNumber.TOTAL_PAGES] });
    return new TextRun({ ...runOpts, text: part });
  });
}

function buildHeaderFooter(template, data) {
  const headerSpec = template.format && template.format.header ? template.format.header : null;
  const footerSpec = template.format && template.format.footer ? template.format.footer : null;
  const showOnFirstPage = !(headerSpec && Object.prototype.hasOwnProperty.call(headerSpec, 'showOnFirstPage')) || headerSpec.showOnFirstPage !== false;

  const runOpts = { font: 'Calibri', size: 18, color: '44546A' };

  // Header
  let defaultHeader = null;
  if (headerSpec) {
    const leftText = resolveStringTemplate(headerSpec.left || '', data);
    const centerText = resolveStringTemplate(headerSpec.center || '', data);
    const rightRaw = typeof headerSpec.right === 'string' ? headerSpec.right : '';
    const rightResolved = rightRaw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, token) => {
      if (token === 'pageNumber' || token === 'pageCount') return `{${token}}`;
      const v = resolveTokenValue(token, data, 'TBD');
      return typeof v === 'string' ? v : 'TBD';
    });
    const rightRuns = buildRunsFromFooterText(rightResolved, runOpts);
    const headerPara = buildThreeColumnParagraph(leftText, centerText, rightRuns, runOpts);
    defaultHeader = new Header({ children: [headerPara] });
  }

  // Footer
  let defaultFooter = null;
  if (footerSpec) {
    const leftText = resolveStringTemplate(footerSpec.left || '', data);
    const centerText = resolveStringTemplate(footerSpec.center || '', data);
    const rightRaw = typeof footerSpec.right === 'string' ? footerSpec.right : '';
    const rightResolved = rightRaw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, token) => {
      if (token === 'pageNumber' || token === 'pageCount') return `{${token}}`;
      const v = resolveTokenValue(token, data, 'TBD');
      return typeof v === 'string' ? v : 'TBD';
    });
    const rightRuns = buildRunsFromFooterText(rightResolved, runOpts);
    const footerPara = buildThreeColumnParagraph(leftText, centerText, rightRuns, runOpts);
    defaultFooter = new Footer({ children: [footerPara] });
  }

  return {
    titlePage: !showOnFirstPage,
    headers: defaultHeader ? { default: defaultHeader, ...(showOnFirstPage ? {} : { first: new Header({ children: [] }) }) } : null,
    footers: defaultFooter ? { default: defaultFooter, ...(showOnFirstPage ? {} : { first: new Footer({ children: [] }) }) } : null
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function collectBodySections(sections, data) {
  const out = [];
  for (const section of sections || []) {
    if (!shouldRenderSection(section, data || {})) continue;
    out.push(section);
  }
  return out;
}

async function generateFromTemplate({ templatePath, data, outputPath }) {
  if (!templatePath || typeof templatePath !== 'string') {
    throw new Error('generateFromTemplate requires templatePath');
  }
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('generateFromTemplate requires outputPath');
  }

  const template = readJson(templatePath);
  const { fontFamily, normalSize } = buildBaseStylesFromTemplate(template.format);
  const templateStyles = (template.format && template.format.styles) || {};
  const pageSetup = buildPageSetupFromTemplateFormat(template.format);
  const docStyles = buildDocumentStyles(fontFamily, templateStyles);
  const numbering = buildNumberingConfig();
  const { titlePage, headers, footers } = buildHeaderFooter(template, data || {});
  const layout = createLayoutContext(template);
  const structure = template.format && template.format.layout && template.format.layout.structure;

  void normalSize; // read but not directly used — kept for possible future use

  const allSections = collectBodySections(template.sections, data || {});
  const cover = allSections.find(s => s.id === 'cover');
  const toc = allSections.find(s => s.id === 'toc');
  const rest = allSections.filter(s => s.id !== 'cover' && s.id !== 'toc');

  let docSections;

  if (structure === 'cover-toc-body' && cover && toc) {
    const firstProps = {
      page: pageSetup.page,
      verticalAlign: VerticalAlignSection.CENTER,
      titlePage: true
    };
    const nextProps = {
      type: SectionType.NEXT_PAGE,
      page: pageSetup.page,
      ...(titlePage ? { titlePage: true } : {})
    };

    const bodyChildren = [];
    for (let i = 0; i < rest.length; i++) {
      bodyChildren.push(...buildSectionNodes(rest[i], data || {}, layout));
      if (i < rest.length - 1) {
        bodyChildren.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterParagraph * 2 : 280 } }));
      }
    }

    docSections = [
      {
        properties: firstProps,
        children: buildSectionNodes(cover, data || {}, layout),
        ...(headers ? { headers: { ...headers, first: new Header({ children: [] }) } } : {}),
        ...(footers ? { footers: { ...footers, first: new Footer({ children: [] }) } } : {})
      },
      {
        properties: nextProps,
        children: buildSectionNodes(toc, data || {}, layout),
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {})
      },
      {
        properties: nextProps,
        children: bodyChildren,
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {})
      }
    ];
  } else {
    const children = [];
    for (let i = 0; i < allSections.length; i++) {
      const section = allSections[i];
      children.push(...buildSectionNodes(section, data || {}, layout));
      if (i < allSections.length - 1) {
        children.push(new Paragraph({ text: '', spacing: { after: layout ? layout.afterParagraph * 2 : 240 } }));
      }
    }

    docSections = [
      {
        properties: titlePage ? { ...pageSetup, titlePage: true } : pageSetup,
        children,
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {})
      }
    ];
  }

  const doc = new Document({
    features: { updateFields: true },
    numbering,
    styles: docStyles,
    sections: docSections
  });

  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = { generateFromTemplate, buildGanttSvg };
