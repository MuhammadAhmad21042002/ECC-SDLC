'use strict';

const C = {
  navy: '#1F3864',
  navyLight: '#2E5496',
  navyPale: '#D6E4F7',
  slate: '#44546A',
  slatePale: '#EBF0F5',
  green: '#375623',
  greenPale: '#E2EFDA',
  red: '#7B2C2C',
  redPale: '#FDECEA',
  white: '#FFFFFF',
  border: '#A8B8CC',
  textMuted: '#44546A',
  arrow: '#2E5496',
  divider: '#A8B8CC'
};

const FONT = 'Calibri,Arial,sans-serif';

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapText(str, maxChars) {
  const words = String(str).split(/\s+/);
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

function textBlock(lines, x, y, lineH, anchor, size, fill, weight) {
  const fw = weight ? ` font-weight="${weight}"` : '';
  const tspans = lines.map((line, i) => (i === 0 ? `<tspan>${esc(line)}</tspan>` : `<tspan x="${x}" dy="${lineH}">${esc(line)}</tspan>`)).join('');
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${fw}>${tspans}</text>`;
}

async function svgToPng(svgString) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return null;
  }
  try {
    return await sharp(Buffer.from(svgString, 'utf8')).png().toBuffer();
  } catch {
    return null;
  }
}

module.exports = { C, FONT, esc, wrapText, textBlock, svgToPng };
