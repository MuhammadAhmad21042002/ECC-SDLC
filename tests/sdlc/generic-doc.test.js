const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateFromTemplate } = require('../../lib/doc-generator/generic-doc');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('Async test not supported in this harness. Use spawnSync or a synchronous API.');
    }
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}\n    Error: ${err.message}`);
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

console.log('\n=== Testing generic-doc generator ===\n');

let passed = 0;
let failed = 0;

if (
  test('generateFromTemplate renders SDS docx', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const templatePath = path.join(repoRoot, 'templates', 'sds-template.json');
    const data = readJson(path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-sds.json'));

    const dir = mkTmpDir('ecc-sdlc-generic-doc-');
    const out = path.join(dir, 'sds.docx');

    // The generator is async; run it in a child process for a sync test harness.
    const { spawnSync } = require('child_process');
    const payloadPath = path.join(dir, 'payload.json');
    fs.writeFileSync(payloadPath, JSON.stringify({ templatePath, data, out }, null, 2), 'utf8');
    const script = `
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync(${JSON.stringify(payloadPath)}, 'utf8'));
      const { generateFromTemplate } = require(${JSON.stringify(path.join(repoRoot, 'lib', 'doc-generator', 'generic-doc.js'))});
      generateFromTemplate({ templatePath: p.templatePath, data: p.data, outputPath: p.out })
        .then(() => process.exit(0))
        .catch(err => { console.error(err && err.message ? err.message : String(err)); process.exit(1); });
    `;
    const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    assert.strictEqual(res.status, 0, `Expected generator to exit 0. stderr=${res.stderr}`);
    const bytes = fs.readFileSync(out);
    assert.ok(bytes.length > 200, 'Expected non-empty docx output');
    assert.strictEqual(bytes[0], 0x50);
    assert.strictEqual(bytes[1], 0x4b);
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

