const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function extractPlaceholdersFromTemplateJson(template) {
  const placeholders = new Set();

  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v);
      return;
    }

    if (typeof value !== 'string') return;

    const regex = /\{([a-zA-Z0-9_]+)\}/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
      placeholders.add(match[1]);
    }
  };

  visit(template);
  return placeholders;
}

function parseYamlFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return null;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = markdown.slice(3, end).trim();

  const result = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();
    result[key] = rawValue;
  }
  return result;
}

function runTests() {
  console.log('\n=== Testing ECC-SDLC scope template + technical-writer agent ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const templatePath = path.join(repoRoot, 'templates', 'scope-template.json');
  const agentPath = path.join(repoRoot, 'agents', 'technical-writer.md');

  const template = readJson(templatePath);
  const agentMd = readText(agentPath);

  const exemptRuntimeTokens = new Set(['pageNumber', 'pageCount']);

  if (
    test('scope template parses and has expected metadata', () => {
      assert.strictEqual(template.templateSchema, 'ecc-sdlc.template.v1');
      assert.strictEqual(template.templateId, 'ecc-sdlc.scope.v1');
      assert.strictEqual(template.documentType, 'scope');
      assert.ok(Array.isArray(template.sections), 'template.sections must be an array');
      assert.ok(template.dataContract && Array.isArray(template.dataContract.requiredFields), 'dataContract.requiredFields missing');
    })
  )
    passed++;
  else failed++;

  if (
    test('scope template includes cover + toc + versionHistory + 10 numbered sections', () => {
      const ids = template.sections.map(s => s && s.id);
      assert.ok(ids.includes('cover'), 'missing cover section');
      assert.ok(ids.includes('toc'), 'missing toc section');
      assert.ok(ids.includes('versionHistory'), 'missing versionHistory section');

      // These should be present and numbered by heading/title in the template content
      const requiredSectionIds = [
        'projectOverview',
        'objectives',
        'inScope',
        'outOfScope',
        'stakeholders',
        'assumptions',
        'constraints',
        'risks',
        'deliverables',
        'timeline'
      ];

      for (const id of requiredSectionIds) {
        assert.ok(ids.includes(id), `missing ${id} section`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('template placeholders are covered by requiredFields (except runtime tokens)', () => {
      const placeholders = extractPlaceholdersFromTemplateJson(template);
      for (const token of exemptRuntimeTokens) placeholders.delete(token);

      const requiredFields = template.dataContract.requiredFields;
      const requiredSet = new Set(requiredFields);

      // requiredFields should be unique strings
      assert.strictEqual(requiredFields.length, requiredSet.size, 'dataContract.requiredFields contains duplicates');
      for (const field of requiredFields) {
        assert.strictEqual(typeof field, 'string', 'dataContract.requiredFields must contain strings');
        assert.ok(field.length > 0, 'dataContract.requiredFields must not contain empty strings');
      }

      const missing = [...placeholders].filter(token => !requiredSet.has(token));
      assert.deepStrictEqual(missing, [], `placeholders missing from requiredFields: ${missing.join(', ')}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('technical-writer agent frontmatter exists and is correctly identified', () => {
      const fm = parseYamlFrontmatter(agentMd);
      assert.ok(fm, 'missing YAML frontmatter');
      assert.strictEqual(fm.name, 'technical-writer');
      assert.strictEqual(fm.model, 'sonnet');
    })
  )
    passed++;
  else failed++;

  if (
    test('technical-writer agent contains strict JSON-output contract guardrails', () => {
      assert.ok(agentMd.includes('Return exactly ONE JSON object'), 'missing strict JSON contract language');
      assert.ok(agentMd.includes('No markdown. No prose outside JSON.'), 'missing no-prose constraint');
      assert.ok(agentMd.includes('requiredFieldsSatisfied') && agentMd.includes('missingRequiredFields'), 'missing validation arrays guidance');
    })
  )
    passed++;
  else failed++;

  if (
    test('technical-writer agent preserves runtime pagination tokens', () => {
      assert.ok(
        agentMd.includes('{pageNumber}') && agentMd.includes('{pageCount}'),
        'agent should mention runtime tokens {pageNumber} and {pageCount}'
      );
      assert.ok(
        agentMd.toLowerCase().includes('leave it unchanged'),
        'agent should instruct that runtime pagination tokens are left unchanged'
      );
    })
  )
    passed++;
  else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

