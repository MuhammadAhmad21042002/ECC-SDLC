'use strict';

/**
 * Exercises lib/doc-generator/sds-doc.js (generateSdsDocument) end-to-end:
 * buildSdsRenderData, optional Mermaid PNG (may be null in CI), generateFromTemplate.
 * Complements generic-doc.test.js (direct generateFromTemplate) and sdlc-cli.test.js (CLI).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}\n    Error: ${err.message}`);
    return false;
  }
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const repoRoot = path.resolve(__dirname, '..', '..');
const sdsDocPath = path.join(repoRoot, 'lib', 'doc-generator', 'sds-doc.js');
const fixturePath = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-sds.json');
const templatePath = path.join(repoRoot, 'templates', 'sds-template.json');

console.log('\n=== Testing SDS document pipeline (sds-doc.js) ===\n');

let passed = 0;
let failed = 0;

if (
  test('generateSdsDocument produces valid docx from valid-sds fixture', () => {
    const dir = mkTmpDir('ecc-sds-doc-');
    const dataFile = path.join(dir, 'payload.json');
    const outFile = path.join(dir, 'out.docx');

    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    raw._docVersion = 1;
    raw._versionHistory = [];
    fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2), 'utf8');

    const script = `
      const fs = require('fs');
      const { generateSdsDocument } = require(${JSON.stringify(sdsDocPath)});
      const raw = JSON.parse(fs.readFileSync(${JSON.stringify(dataFile)}, 'utf8'));
      generateSdsDocument(raw, ${JSON.stringify(outFile)}, ${JSON.stringify(templatePath)})
        .then(() => process.exit(0))
        .catch(err => {
          console.error(err && err.message ? err.message : String(err));
          process.exit(1);
        });
    `;
    const res = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: repoRoot,
    });
    assert.strictEqual(res.status, 0, `child stderr: ${res.stderr}`);
    const bytes = fs.readFileSync(outFile);
    assert.ok(bytes.length > 200, 'Expected non-empty docx');
    assert.strictEqual(bytes[0], 0x50);
    assert.strictEqual(bytes[1], 0x4b);
  })
) {
  passed++;
} else {
  failed++;
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
