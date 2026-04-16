const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateScopeDocument } = require('../../lib/doc-generator/scope-doc');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => { console.log(`  ✓ ${name}`); return true; })
        .catch(err => { console.log(`  ✗ ${name}\n    Error: ${err.message}`); return false; });
    }
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  console.log('\n=== Testing scope-doc generator ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const templatePath = path.join(repoRoot, 'templates', 'scope-template.json');
  const fixturePath = path.join(repoRoot, 'tests', 'sdlc', 'fixtures', 'valid-scope.json');

  const projectRoot = mkTmpDir('ecc-sdlc-scope-doc-');
  const outputPath = path.join(projectRoot, 'artifacts', 'scope-v1.docx');

  const scopeData = readJson(fixturePath);
  scopeData.projectName = 'Demo Project';
  scopeData.clientName = 'Demo Client';

  if (await test('generateScopeDocument writes a non-empty .docx file', async () => {
    await generateScopeDocument(scopeData, outputPath, templatePath);
    assert.ok(fs.existsSync(outputPath), 'Expected output .docx to exist');
    const buf = fs.readFileSync(outputPath);
    assert.ok(buf.length > 200, `Expected non-trivial docx size, got ${buf.length}`);
    // .docx is a ZIP file; should start with PK magic bytes
    assert.strictEqual(buf[0], 0x50);
    assert.strictEqual(buf[1], 0x4b);
  })) passed++; else failed++;

  if (await test('generated docx is stable across read/write', async () => {
    const buf1 = fs.readFileSync(outputPath);
    const roundtripPath = path.join(projectRoot, 'artifacts', 'scope-roundtrip.docx');
    fs.writeFileSync(roundtripPath, buf1);
    const buf2 = fs.readFileSync(roundtripPath);
    assert.strictEqual(buf1.length, buf2.length);
    assert.strictEqual(buf2[0], 0x50);
    assert.strictEqual(buf2[1], 0x4b);
  })) passed++; else failed++;

  if (await test('generated docx contains all template section headings (AC3)', async () => {
    const buf = fs.readFileSync(outputPath);

    // .docx is a ZIP; use jszip (transitive dep) to extract word/document.xml
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const xmlFile = zip.file('word/document.xml');
    assert.ok(xmlFile, 'word/document.xml not found in docx ZIP');
    const xml = await xmlFile.async('string');

    const expectedHeadings = [
      'Table of Contents',
      'Version History',
      '1. Project Overview',
      '2. Objectives',
      '3. In Scope',
      '4. Out of Scope',
      '5. Stakeholders',
      '6. Assumptions',
      '7. Constraints',
      '8. Risks and Mitigations',
      '9. Deliverables',
      '10. Timeline (if applicable)',
    ];

    for (const heading of expectedHeadings) {
      assert.ok(
        xml.includes(heading),
        `Missing section heading in document.xml: "${heading}"`
      );
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.log(`  ✗ fatal\n    Error: ${err.message}`);
  process.exit(1);
});

