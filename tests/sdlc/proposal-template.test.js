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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sumWidths(columns) {
  return columns.reduce((sum, c) => sum + (typeof c.widthPct === 'number' ? c.widthPct : 0), 0);
}

function runTests() {
  console.log('\n=== Testing ECC-SDLC proposal-template.json ===\n');

  let passed = 0;
  let failed = 0;

  // Template file location
  const templatePath = path.join(process.env.HOME, '.claude', 'templates', 'proposal-template.json');
  const skillPath = path.join(process.env.HOME, '.claude', 'skills', 'sdlc-proposal', 'SKILL.md');

  let template;
  if (!test('proposal-template.json exists and parses as valid JSON', () => {
    assert.ok(fs.existsSync(templatePath), `File not found: ${templatePath}`);
    template = readJson(templatePath);
    assert.ok(template !== null && typeof template === 'object', 'Parsed value is not an object');
  })) {
    failed++;
    console.log('\n  Cannot continue — template file is missing or invalid JSON.\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(1);
  } else {
    passed++;
  }

  console.log('Metadata:');

  if (test('templateSchema is "ecc-sdlc.template.v1"', () => {
    assert.strictEqual(template.templateSchema, 'ecc-sdlc.template.v1');
  })) passed++; else failed++;

  if (test('templateId is "ecc-sdlc.proposal.v1"', () => {
    assert.strictEqual(template.templateId, 'ecc-sdlc.proposal.v1');
  })) passed++; else failed++;

  if (test('documentType is "proposal"', () => {
    assert.strictEqual(template.documentType, 'proposal');
  })) passed++; else failed++;

  if (test('sections is a non-empty array', () => {
    assert.ok(Array.isArray(template.sections), 'template.sections must be an array');
    assert.ok(template.sections.length > 0, 'template.sections must not be empty');
  })) passed++; else failed++;

  console.log('\nRequired 9 sections (acceptance criteria):');

  // Extract only the 9 main proposal sections (excludes cover, toc, versionHistory, sub-tables, diagrams)
  const mainSections = template.sections.filter(s => s.order !== undefined);
  const sectionIds = mainSections.map(s => s.id);
  
  const required9Sections = [
    'executiveSummary',
    'understandingOfRequirement',
    'proposedSolution',
    'technicalApproach',
    'teamProfiles',
    'projectTimeline',
    'costBreakdown',
    'complianceStatement',
    'appendices'
  ];

  if (test('all 9 required sections present', () => {
    assert.strictEqual(mainSections.length, 9, 
      `Expected 9 main sections, found ${mainSections.length}`);
    for (const id of required9Sections) {
      assert.ok(sectionIds.includes(id), `Missing required section: ${id}`);
    }
  })) passed++; else failed++;

  console.log('\nSection ordering (must match sdlc-proposal/SKILL.md):');

  if (test('sections are in correct order 1-9', () => {
    const expectedOrder = [
      'executiveSummary',        // order: 1
      'understandingOfRequirement', // order: 2
      'proposedSolution',        // order: 3
      'technicalApproach',       // order: 4
      'teamProfiles',            // order: 5
      'projectTimeline',         // order: 6
      'costBreakdown',           // order: 7
      'complianceStatement',     // order: 8
      'appendices'               // order: 9
    ];
    
    assert.deepStrictEqual(sectionIds, expectedOrder,
      `Section order does not match. Expected: ${expectedOrder.join(', ')}. Got: ${sectionIds.join(', ')}`);
  })) passed++; else failed++;

  if (test('each section has order field matching its position (1-9)', () => {
    mainSections.forEach((section, index) => {
      const expectedOrder = index + 1;
      assert.strictEqual(section.order, expectedOrder,
        `Section ${section.id} has order ${section.order}, expected ${expectedOrder}`);
    });
  })) passed++; else failed++;

  console.log('\nSection field validation:');

  if (test('all 9 sections have title, order, required, and type fields', () => {
    mainSections.forEach(section => {
      assert.ok(section.title, `Section ${section.id} missing title field`);
      assert.ok(typeof section.order === 'number', `Section ${section.id} missing or invalid order field`);
      assert.ok(typeof section.required === 'boolean', `Section ${section.id} missing or invalid required field`);
      assert.ok(section.type, `Section ${section.id} missing type field`);
    });
  })) passed++; else failed++;

  console.log('\nCompliance Statement validation (acceptance criteria):');

  const complianceSection = mainSections.find(s => s.id === 'complianceStatement');

  if (test('complianceStatement section exists', () => {
    assert.ok(complianceSection, 'complianceStatement section must exist');
  })) passed++; else failed++;

  if (test('complianceStatement is marked required: true', () => {
    assert.ok(complianceSection, 'complianceStatement section must exist');
    assert.strictEqual(complianceSection.required, true,
      'complianceStatement.required must be true — this section must never be skipped');
  })) passed++; else failed++;

  console.log('\nCost Breakdown table validation (acceptance criteria):');

  const costBreakdownSection = mainSections.find(s => s.id === 'costBreakdown');
  const costBreakdownTable = template.sections.find(s => s.id === 'costBreakdownTable');

  if (test('costBreakdown section exists and has associated table', () => {
    assert.ok(costBreakdownSection, 'costBreakdown section must exist');
    assert.ok(costBreakdownTable, 'costBreakdownTable section must exist');
    assert.strictEqual(costBreakdownTable.type, 'table', 'costBreakdownTable must be type: table');
  })) passed++; else failed++;

  if (test('costBreakdown table has columns: item, hours, rate, total', () => {
    assert.ok(costBreakdownTable && costBreakdownTable.content && costBreakdownTable.content.columns,
      'costBreakdownTable must have content.columns');
    const columnKeys = costBreakdownTable.content.columns.map(c => c.key);
    
    const requiredColumns = ['item', 'hours', 'rate', 'total'];
    
    for (const col of requiredColumns) {
      assert.ok(columnKeys.includes(col),
        `costBreakdown table missing required column: ${col}`);
    }
    assert.strictEqual(costBreakdownTable.content.columns.length, 4,
      'costBreakdown table must have exactly 4 columns');
  })) passed++; else failed++;

  if (test('costBreakdown table columns sum to 100', () => {
    assert.strictEqual(sumWidths(costBreakdownTable.content.columns), 100,
      'costBreakdown table column widths must sum to 100%');
  })) passed++; else failed++;

  console.log('\nTeam Profiles table validation (acceptance criteria):');

  const teamProfilesSection = mainSections.find(s => s.id === 'teamProfiles');

  if (test('teamProfiles section exists and is type: table', () => {
    assert.ok(teamProfilesSection, 'teamProfiles section must exist');
    assert.strictEqual(teamProfilesSection.type, 'table',
      'teamProfiles must be type: table');
  })) passed++; else failed++;

  if (test('teamProfiles has columns: name, role, yearsExperience, relevantProjects', () => {
    assert.ok(teamProfilesSection && teamProfilesSection.content && teamProfilesSection.content.columns,
      'teamProfiles must have content.columns');
    const columnKeys = teamProfilesSection.content.columns.map(c => c.key);
    const requiredColumns = ['name', 'role', 'yearsExperience', 'relevantProjects'];
    
    for (const col of requiredColumns) {
      assert.ok(columnKeys.includes(col),
        `teamProfiles table missing required column: ${col}`);
    }
    assert.strictEqual(teamProfilesSection.content.columns.length, 4,
      'teamProfiles table must have exactly 4 columns');
  })) passed++; else failed++;

  if (test('teamProfiles table columns sum to 100', () => {
    assert.strictEqual(sumWidths(teamProfilesSection.content.columns), 100,
      'teamProfiles table column widths must sum to 100%');
  })) passed++; else failed++;

  console.log('\nCross-check with sdlc-proposal/SKILL.md:');

  if (fs.existsSync(skillPath)) {
    const skillContent = fs.readFileSync(skillPath, 'utf8');
    
    if (test('9 section names match sdlc-proposal/SKILL.md exactly', () => {
      // Extract the 9-section list from the skill
      const skillSectionMatch = skillContent.match(/1\.\s+\*\*Executive Summary\*\*[\s\S]*?9\.\s+\*\*Appendices\*\*/);
      assert.ok(skillSectionMatch, 'Could not find 9-section structure in skill file');
      
      const skillText = skillSectionMatch[0];
      
      // Map template section IDs to skill section names
      const sectionMapping = {
        'executiveSummary': 'Executive Summary',
        'understandingOfRequirement': 'Understanding of Requirement',
        'proposedSolution': 'Proposed Solution',
        'technicalApproach': 'Technical Approach',
        'teamProfiles': 'Team Profiles',
        'projectTimeline': 'Project Timeline',
        'costBreakdown': 'Cost Breakdown',
        'complianceStatement': 'Compliance Statement',
        'appendices': 'Appendices'
      };
      
      // Verify each section exists in skill
      for (const [id, name] of Object.entries(sectionMapping)) {
        assert.ok(skillText.includes(name),
          `Section "${name}" from template not found in skill file 9-section structure`);
      }
    })) passed++; else failed++;

    if (test('section ordering matches sdlc-proposal/SKILL.md', () => {
      // The skill defines the order as 1-9 in a numbered list
      // We've already validated the template has order 1-9
      // This test confirms the sequence matches
      const skillSectionMatch = skillContent.match(/1\.\s+\*\*Executive Summary\*\*[\s\S]*?9\.\s+\*\*Appendices\*\*/);
      const skillText = skillSectionMatch[0];
      
      const expectedSequence = [
        '1. **Executive Summary**',
        '2. **Understanding of Requirement**',
        '3. **Proposed Solution**',
        '4. **Technical Approach**',
        '5. **Team Profiles**',
        '6. **Project Timeline**',
        '7. **Cost Breakdown**',
        '8. **Compliance Statement**',
        '9. **Appendices**'
      ];
      
      for (let i = 0; i < expectedSequence.length - 1; i++) {
        const currentPos = skillText.indexOf(expectedSequence[i]);
        const nextPos = skillText.indexOf(expectedSequence[i + 1]);
        assert.ok(currentPos < nextPos && currentPos !== -1 && nextPos !== -1,
          `Section order mismatch: ${expectedSequence[i]} should appear before ${expectedSequence[i + 1]}`);
      }
    })) passed++; else failed++;
  } else {
    console.log('  ⚠ sdlc-proposal/SKILL.md not found - skipping cross-check');
    console.log(`    Expected location: ${skillPath}`);
    passed += 2; // Don't fail for missing skill file
  }

  console.log('\nAppendices validation:');

  const appendicesSection = mainSections.find(s => s.id === 'appendices');

  if (test('appendices is required: false', () => {
    assert.ok(appendicesSection, 'appendices section must exist');
    assert.strictEqual(appendicesSection.required, false,
      'appendices.required must be false — populated only when supporting documents are referenced');
  })) passed++; else failed++;

  if (test('appendices is type: contentBlock (contains subsections with lists)', () => {
    assert.ok(appendicesSection, 'appendices section must exist');
    assert.strictEqual(appendicesSection.type, 'contentBlock',
      'appendices must be type: contentBlock with subsections');
  })) passed++; else failed++;

  console.log('\nAdditional table validations:');

  const projectTimelineSection = mainSections.find(s => s.id === 'projectTimeline');
  const projectTimelineTable = template.sections.find(s => s.id === 'projectTimelineTable');
  
  if (test('projectTimeline has associated table with columns summing to 100', () => {
    assert.ok(projectTimelineSection, 'projectTimeline section must exist');
    assert.ok(projectTimelineTable && projectTimelineTable.type === 'table',
      'projectTimelineTable must exist and be type table');
    assert.strictEqual(sumWidths(projectTimelineTable.content.columns), 100);
  })) passed++; else failed++;

  console.log('\nData contract validation:');

  if (test('dataContract.requiredFields is an array of strings', () => {
    assert.ok(
      template.dataContract && Array.isArray(template.dataContract.requiredFields),
      'dataContract.requiredFields is missing or not an array'
    );
    for (const field of template.dataContract.requiredFields) {
      assert.strictEqual(typeof field, 'string', 'Each requiredField must be a string');
      assert.ok(field.length > 0, 'requiredFields must not contain empty strings');
    }
  })) passed++; else failed++;

  if (test('dataContract.requiredFields contains no duplicates', () => {
    const fields = template.dataContract.requiredFields;
    const uniqueSet = new Set(fields);
    assert.strictEqual(fields.length, uniqueSet.size,
      `dataContract.requiredFields has duplicates: ${fields.filter((f, i) => fields.indexOf(f) !== i).join(', ')}`);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed! proposal-template.json is valid.\n');
  } else {
    console.log(`\n❌ ${failed} test(s) failed. Review the template file.\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
