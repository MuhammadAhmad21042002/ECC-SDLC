'use strict';

const { AlignmentType, HeadingLevel, ShadingType, TabStopPosition, TabStopType, TextRun } = require('docx');

const DEFAULT_FONT = 'Calibri';

// Document theme colours — navy/slate palette matching IEEE enterprise docs
const THEME = {
  h1Color: '1F3864', // dark navy
  h2Color: '2E5496', // medium navy-blue
  h3Color: '2E5496', // same as h2, italicised
  tableHeaderBg: '1F3864', // dark navy fill for table header rows
  tableHeaderText: 'FFFFFF', // white text on dark header
  tableRowEvenBg: 'EBF0F5', // very pale slate for alternating rows
  tableRowOddBg: 'FFFFFF', // white for odd rows
  coverTitleColor: '1F3864',
  coverSubColor: '44546A'
};

function mmToTwip(mm) {
  return Math.round((mm / 25.4) * 1440);
}

// Convert points to half-points (docx font size unit)
function ptToHalfPt(pt) {
  return Math.round(Number(pt) * 2);
}

// Convert points to twips (docx spacing unit)
function ptToTwip(pt) {
  return Math.round(Number(pt) * 20);
}

function buildPageSetupFromTemplateFormat(format) {
  const page = (format && format.page) || {};
  const margins = page.marginsMm || {};

  const size = page.size === 'A4' ? { width: 11906, height: 16838 } : page.size === 'LETTER' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };

  return {
    page: {
      size,
      margin: {
        top: mmToTwip(margins.top ?? 25),
        right: mmToTwip(margins.right ?? 20),
        bottom: mmToTwip(margins.bottom ?? 25),
        left: mmToTwip(margins.left ?? 20)
      }
    }
  };
}

function buildBaseStylesFromTemplate(format) {
  const defaults = (format && format.defaults) || {};
  const styles = (format && format.styles) || {};

  const fontFamily = defaults.fontFamily || DEFAULT_FONT;
  const normalSize = Number(styles.normal?.fontSizePt || defaults.fontSizePt || 11);

  return { fontFamily, normalSize };
}

/**
 * Returns the full `styles` block for new Document({ styles: ... }).
 * Defines heading paragraph styles (H1/H2/H3/Title) with explicit colours,
 * sizes, and spacing so Word's built-in theme colours don't override them.
 *
 * @param {string} fontFamily
 * @param {object} templateStyles  — the format.styles block from the template JSON
 * @returns {object}  — ready to pass as `styles:` to new Document()
 */
function buildDocumentStyles(fontFamily, templateStyles) {
  const s = templateStyles || {};
  const font = fontFamily || DEFAULT_FONT;

  const h1SizePt = Number(s.h1?.fontSizePt || 16);
  const h2SizePt = Number(s.h2?.fontSizePt || 13);
  const h3SizePt = Number(s.h3?.fontSizePt || 12);
  const normSizePt = Number(s.normal?.fontSizePt || 11);

  return {
    default: {
      document: {
        run: { font }
      }
    },
    paragraphStyles: [
      // ── Title (cover page) ───────────────────────────────────────────────
      {
        id: 'Title',
        name: 'Title',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: {
          font,
          size: ptToHalfPt(28),
          bold: true,
          color: THEME.coverTitleColor
        },
        paragraph: {
          spacing: { before: 0, after: ptToTwip(16) }
        }
      },

      // ── Heading 1 ────────────────────────────────────────────────────────
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: {
          font,
          size: ptToHalfPt(h1SizePt),
          bold: true,
          color: THEME.h1Color
        },
        paragraph: {
          spacing: {
            before: ptToTwip(s.h1?.spacingBeforePt ?? 18),
            after: ptToTwip(s.h1?.spacingAfterPt ?? 8)
          },
          border: {
            bottom: {
              color: THEME.h1Color,
              space: 1,
              style: 'single',
              size: 6 // 0.75pt underline rule
            }
          }
        }
      },

      // ── Heading 2 ────────────────────────────────────────────────────────
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: {
          font,
          size: ptToHalfPt(h2SizePt),
          bold: true,
          color: THEME.h2Color
        },
        paragraph: {
          spacing: {
            before: ptToTwip(s.h2?.spacingBeforePt ?? 14),
            after: ptToTwip(s.h2?.spacingAfterPt ?? 6)
          }
        }
      },

      // ── Heading 3 ────────────────────────────────────────────────────────
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: {
          font,
          size: ptToHalfPt(h3SizePt),
          bold: true,
          italics: true,
          color: THEME.h3Color
        },
        paragraph: {
          spacing: {
            before: ptToTwip(s.h3?.spacingBeforePt ?? 10),
            after: ptToTwip(s.h3?.spacingAfterPt ?? 4)
          }
        }
      },

      // ── Normal ───────────────────────────────────────────────────────────
      {
        id: 'Normal',
        name: 'Normal',
        quickFormat: true,
        run: {
          font,
          size: ptToHalfPt(normSizePt)
        },
        paragraph: {
          spacing: { after: ptToTwip(8) }
        }
      },

      // ── TOC entry styles ─────────────────────────────────────────────────
      // Word requires TOC1 / TOC2 paragraph styles to be defined in styles.xml
      // before it can render the TOC field entries with page numbers and leaders.
      // Without these styles the TOC field calculates but displays as blank.
      // Tab stop at position 9638 (right edge of A4 body at 25/20mm margins)
      // with a dot leader produces the classic "Title ........... 3" appearance.
      {
        id: 'TOC1',
        name: 'toc 1',
        basedOn: 'Normal',
        next: 'Normal',
        run: {
          font,
          size: ptToHalfPt(11),
          color: THEME.h1Color
        },
        paragraph: {
          spacing: { after: 80 },
          tabStops: [{ type: 'right', position: 9638, leader: 'dot' }]
        }
      },
      {
        id: 'TOC2',
        name: 'toc 2',
        basedOn: 'Normal',
        next: 'Normal',
        run: {
          font,
          size: ptToHalfPt(10),
          color: THEME.h2Color
        },
        paragraph: {
          spacing: { after: 60 },
          indent: { left: 220 },
          tabStops: [{ type: 'right', position: 9638, leader: 'dot' }]
        }
      },
      {
        id: 'TOC3',
        name: 'toc 3',
        basedOn: 'Normal',
        next: 'Normal',
        run: {
          font,
          size: ptToHalfPt(10),
          color: THEME.h3Color
        },
        paragraph: {
          spacing: { after: 40 },
          indent: { left: 440 },
          tabStops: [{ type: 'right', position: 9638, leader: 'dot' }]
        }
      }
    ]
  };
}

/**
 * Builds the numbering config object to pass as `numbering:` to new Document().
 * Provides one reference ID for ordered lists used by buildNumbered().
 */
function buildNumberingConfig() {
  return {
    config: [
      {
        reference: 'ecc-decimal',
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 }
              }
            }
          }
        ]
      },
      {
        reference: 'ecc-bullet',
        levels: [
          {
            level: 0,
            format: 'bullet',
            text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: {
              run: { font: 'Symbol' },
              paragraph: {
                indent: { left: 720, hanging: 360 }
              }
            }
          }
        ]
      }
    ]
  };
}

/**
 * Builds a three-column tab-stop paragraph for headers/footers.
 * Left text — centre text — right text (with page number support).
 *
 * @param {string} leftText
 * @param {string} centerText
 * @param {Array<TextRun>} rightRuns
 * @param {object} fontOptions  — { font, size, color }
 * @returns {import('docx').Paragraph}
 */
function buildThreeColumnParagraph(leftText, centerText, rightRuns, fontOptions = {}) {
  const { Paragraph: DocxParagraph } = require('docx');
  const font = fontOptions.font || DEFAULT_FONT;
  const size = fontOptions.size || 18; // 9pt in half-points
  const color = fontOptions.color || '44546A';

  const runOpts = { font, size, color };

  const children = [
    ...(leftText ? [new TextRun({ text: leftText, ...runOpts })] : []),
    new TextRun({ text: '\t', ...runOpts }),
    ...(centerText ? [new TextRun({ text: centerText, ...runOpts })] : []),
    new TextRun({ text: '\t', ...runOpts }),
    ...rightRuns.map(r => {
      // Merge our font/size/color into existing TextRun options
      if (r instanceof TextRun) return r;
      return new TextRun({ ...r, font, size, color });
    })
  ];

  return new DocxParagraph({
    children,
    tabStops: [
      { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },
      { type: TabStopType.RIGHT, position: TabStopPosition.MAX }
    ]
  });
}

/**
 * Returns shading for table header cells.
 */
function tableHeaderShading() {
  return {
    fill: THEME.tableHeaderBg,
    type: ShadingType.CLEAR,
    color: 'auto'
  };
}

/**
 * Returns shading for alternating data rows.
 * @param {number} rowIndex  — 0-based row index (0 = first data row after header)
 */
function tableRowShading(rowIndex) {
  const fill = rowIndex % 2 === 0 ? THEME.tableRowOddBg : THEME.tableRowEvenBg;
  return {
    fill,
    type: ShadingType.CLEAR,
    color: 'auto'
  };
}

function text(value, options = {}) {
  const v = value == null ? '' : String(value);
  return new TextRun({
    text: v,
    bold: !!options.bold,
    italics: !!options.italics,
    size: options.size ? options.size * 2 : undefined,
    font: options.font,
    color: options.color
  });
}

function headingLevelFromString(level) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_1;
}

function alignmentFromString(value) {
  if (value === 'center') return AlignmentType.CENTER;
  if (value === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

module.exports = {
  THEME,
  alignmentFromString,
  buildBaseStylesFromTemplate,
  buildDocumentStyles,
  buildNumberingConfig,
  buildPageSetupFromTemplateFormat,
  buildThreeColumnParagraph,
  headingLevelFromString,
  mmToTwip,
  ptToHalfPt,
  ptToTwip,
  tableHeaderShading,
  tableRowShading,
  text
};
