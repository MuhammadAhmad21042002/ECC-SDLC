#!/usr/bin/env node
/**
 * ECC-SDLC — docx smoke test
 *
 * Confirms the `docx` npm package is installed and can generate a valid .docx
 * file on the current machine. Run this on every team member's machine before
 * starting SDLC document generation work.
 *
 * Usage:
 *   node tests/sdlc/docx-smoke.test.js
 *
 * Prerequisites:
 *   npm install docx          (or pnpm / yarn / bun equivalent)
 *
 * What it checks:
 *   1. Node.js version is >= 18
 *   2. `docx` package resolves (i.e. it is installed)
 *   3. A Document object can be instantiated
 *   4. Packer.toBuffer() produces a non-empty Buffer
 *   5. The Buffer starts with the PK ZIP magic bytes (all .docx files are ZIPs)
 *   6. The file can be written to disk and read back without corruption
 *   7. Cleanup succeeds (no stale temp files left behind)
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ---------------------------------------------------------------------------
// Minimal test harness (matches the pattern used throughout this repo)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    // Support async tests
    if (result && typeof result.then === 'function') {
      return result
        .then(() => { console.log(`  ✓ ${name}`); passed++; })
        .catch(err => { console.log(`  ✗ ${name}\n    Error: ${err.message}`); failed++; });
    }
    console.log(`  ✓ ${name}`);
    passed++;
    return Promise.resolve();
  } catch (err) {
    console.log(`  ✗ ${name}\n    Error: ${err.message}`);
    failed++;
    return Promise.resolve();
  }
}

function printSummary() {
  const total = passed + failed;
  console.log('\n' + '─'.repeat(50));
  console.log(`Passed: ${passed}  /  Failed: ${failed}  /  Total: ${total}`);
  console.log('─'.repeat(50));
  if (failed > 0) {
    console.log('\nSome checks failed. See troubleshooting guide below.\n');
    printTroubleshooting();
  } else {
    console.log('\ndocx is working correctly on this machine.\n');
  }
}

function printTroubleshooting() {
  console.log('Troubleshooting:');
  console.log('  1. Install the package:    npm install docx');
  console.log('     (or)                    pnpm add docx');
  console.log('     (or)                    yarn add docx');
  console.log('     (or)                    bun add docx');
  console.log('  2. Verify Node version:    node --version  (need >= 18)');
  console.log('  3. Re-run this test:       node tests/sdlc/docx-smoke.test.js');
  console.log('  4. If error persists, share the full output with the team lead.\n');
}

// ---------------------------------------------------------------------------
// Environment banner
// ---------------------------------------------------------------------------

console.log('\n=== ECC-SDLC: docx Smoke Test ===\n');
console.log('Environment:');
console.log(`  Node.js  : ${process.version}`);
console.log(`  Platform : ${process.platform} (${os.arch()})`);
console.log(`  OS       : ${os.type()} ${os.release()}`);
console.log(`  CWD      : ${process.cwd()}`);
console.log('');

// ---------------------------------------------------------------------------
// Helper: resolve the `docx` package without crashing the whole file
// ---------------------------------------------------------------------------

function tryRequireDocx() {
  try {
    return require('docx');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

async function runTests() {

  // ── 1. Node.js version ───────────────────────────────────────────────────
  console.log('Node.js Version:');
  await test('Node.js version is >= 18', () => {
    const major = parseInt(process.version.slice(1).split('.')[0], 10);
    assert.ok(
      major >= 18,
      `Node.js ${process.version} is below the minimum required v18. Please upgrade.`
    );
  });

  // ── 2. Package availability ───────────────────────────────────────────────
  console.log('\nPackage Availability:');
  const docx = tryRequireDocx();

  await test('`docx` package can be required', () => {
    assert.ok(
      docx !== null,
      '`docx` is not installed. Run: npm install docx'
    );
  });

  if (!docx) {
    // Can't run the remaining tests without the package — stop here
    printSummary();
    process.exit(failed > 0 ? 1 : 0);
  }

  // Print resolved package version for traceability
  try {
    // resolve the package root via its main entry, then walk up to package.json
    const mainPath = require.resolve('docx');
    let dir = path.dirname(mainPath);
    let pkgJson = null;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) { pkgJson = candidate; break; }
      dir = path.dirname(dir);
    }
    const pkg = pkgJson ? JSON.parse(fs.readFileSync(pkgJson, 'utf8')) : null;
    console.log(`  docx version: ${pkg ? pkg.version : '(could not determine)'}`);
  } catch {
    console.log('  docx version: (could not determine)');
  }

  await test('Document class is exported', () => {
    assert.ok(typeof docx.Document === 'function', 'docx.Document is not a constructor');
  });

  await test('Packer class is exported', () => {
    assert.ok(typeof docx.Packer === 'object' || typeof docx.Packer === 'function',
      'docx.Packer is not exported');
  });

  await test('Paragraph class is exported', () => {
    assert.ok(typeof docx.Paragraph === 'function', 'docx.Paragraph is not a constructor');
  });

  await test('TextRun class is exported', () => {
    assert.ok(typeof docx.TextRun === 'function', 'docx.TextRun is not a constructor');
  });

  await test('Table and TableRow and TableCell are exported', () => {
    assert.ok(typeof docx.Table     === 'function', 'docx.Table is missing');
    assert.ok(typeof docx.TableRow  === 'function', 'docx.TableRow is missing');
    assert.ok(typeof docx.TableCell === 'function', 'docx.TableCell is missing');
  });

  // ── 3. Document instantiation ─────────────────────────────────────────────
  console.log('\nDocument Generation:');

  let doc = null;

  await test('Document can be instantiated with sections', () => {
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } = docx;

    doc = new Document({
      creator:     'ECC-SDLC Smoke Test',
      title:       'docx Smoke Test Document',
      description: 'Auto-generated by docx-smoke.test.js to verify docx works on this machine.',
      styles: {
        paragraphStyles: [{
          id: 'Normal',
          name: 'Normal',
          run: { font: 'Calibri', size: 22 }
        }]
      },
      sections: [{
        properties: {},
        headers: {
          default: {
            options: {
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'ECC-SDLC — docx Smoke Test', bold: true })]
                })
              ]
            }
          }
        },
        footers: {
          default: {
            options: {
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `Generated on ${new Date().toISOString()} | Node ${process.version} | ${process.platform}` })
                  ]
                })
              ]
            }
          }
        },
        children: [

          // Title
          new Paragraph({
            text: 'docx Smoke Test',
            heading: HeadingLevel ? HeadingLevel.HEADING_1 : 'Heading1'
          }),

          // Environment paragraph
          new Paragraph({
            children: [
              new TextRun({ text: 'Environment: ', bold: true }),
              new TextRun({
                text: `Node ${process.version}  |  ${process.platform} (${os.arch()})  |  ${os.type()} ${os.release()}`
              })
            ]
          }),

          // Purpose paragraph
          new Paragraph({
            children: [
              new TextRun({
                text: 'This document was auto-generated by the ECC-SDLC smoke test to confirm ' +
                      'that the docx package is installed and functioning correctly on this machine.'
              })
            ]
          }),

          // Section heading
          new Paragraph({
            text: 'Sample Requirements Table',
            heading: HeadingLevel ? HeadingLevel.HEADING_2 : 'Heading2'
          }),

          // Simple 3-column table (mirrors functional requirements table structure)
          new Table({
            width: { size: 100, type: WidthType ? WidthType.PERCENTAGE : 'pct' },
            rows: [
              // Header row
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Req ID',      bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Title',       bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Priority',    bold: true })] })] })
                ]
              }),
              // Sample data row 1
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'REQ-FUNC-001' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'User Authentication' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Must' })] })
                ]
              }),
              // Sample data row 2
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'REQ-NFUNC-001' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Response Time < 2s' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Must' })] })
                ]
              }),
              // Sample data row 3
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'REQ-CON-001' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Data must remain on-premise' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Must' })] })
                ]
              })
            ]
          }),

          // Glossary heading
          new Paragraph({
            text: 'Sample Glossary',
            heading: HeadingLevel ? HeadingLevel.HEADING_2 : 'Heading2'
          }),

          new Paragraph({ children: [new TextRun({ text: 'SRS: ', bold: true }), new TextRun({ text: 'Software Requirements Specification.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'MoSCoW: ', bold: true }), new TextRun({ text: 'Must Have, Should Have, Could Have, Won\'t Have.' })] }),
          new Paragraph({ children: [new TextRun({ text: 'Phase Gate: ', bold: true }), new TextRun({ text: 'Checkpoint that enforces prerequisite artifacts before phase progression.' })] })
        ]
      }]
    });

    assert.ok(doc !== null, 'Document constructor returned null');
  });

  // ── 4. Buffer generation ──────────────────────────────────────────────────

  let buffer = null;

  await test('Packer.toBuffer() produces a non-empty Buffer', async () => {
    buffer = await docx.Packer.toBuffer(doc);
    assert.ok(Buffer.isBuffer(buffer), 'Packer.toBuffer() did not return a Buffer');
    assert.ok(buffer.length > 0, 'Packer produced an empty buffer');
  });

  // ── 5. ZIP magic bytes check ──────────────────────────────────────────────
  console.log('\nFile Integrity:');

  await test('Buffer starts with ZIP magic bytes (PK\\x03\\x04)', () => {
    // All valid .docx files are ZIP archives — first 4 bytes must be 50 4B 03 04
    assert.strictEqual(buffer[0], 0x50, 'First byte should be 0x50 (P)');
    assert.strictEqual(buffer[1], 0x4B, 'Second byte should be 0x4B (K)');
    assert.strictEqual(buffer[2], 0x03, 'Third byte should be 0x03');
    assert.strictEqual(buffer[3], 0x04, 'Fourth byte should be 0x04');
  });

  await test('Buffer is at least 1 KB (sanity size check)', () => {
    assert.ok(buffer.length >= 1024,
      `Buffer is only ${buffer.length} bytes — suspiciously small for a valid .docx`);
  });

  // ── 6. Disk write + read-back ─────────────────────────────────────────────
  console.log('\nDisk I/O:');

  const tmpFile = path.join(os.tmpdir(), `ecc-sdlc-smoke-test-${Date.now()}.docx`);

  await test(`File can be written to temp directory (${os.tmpdir()})`, () => {
    fs.writeFileSync(tmpFile, buffer);
    assert.ok(fs.existsSync(tmpFile), `File was not created at ${tmpFile}`);
  });

  await test('Written file size matches buffer size', () => {
    const stat = fs.statSync(tmpFile);
    assert.strictEqual(
      stat.size,
      buffer.length,
      `File size (${stat.size}) does not match buffer length (${buffer.length})`
    );
    console.log(`  File size: ${stat.size.toLocaleString()} bytes`);
    console.log(`  File path: ${tmpFile}`);
  });

  await test('File can be read back from disk without corruption', () => {
    const readBack = fs.readFileSync(tmpFile);
    assert.ok(Buffer.isBuffer(readBack), 'Read-back result is not a Buffer');
    assert.strictEqual(readBack[0], 0x50, 'Read-back: first byte corrupted');
    assert.strictEqual(readBack[1], 0x4B, 'Read-back: second byte corrupted');
    assert.ok(readBack.length === buffer.length, 'Read-back size mismatch — possible disk write error');
  });

  // ── 7. Cleanup ────────────────────────────────────────────────────────────
  console.log('\nCleanup:');

  await test('Temp file removed after test', () => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    assert.ok(!fs.existsSync(tmpFile), `Temp file still exists at ${tmpFile}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\nUnhandled error during smoke test:\n', err);
  process.exit(1);
});
