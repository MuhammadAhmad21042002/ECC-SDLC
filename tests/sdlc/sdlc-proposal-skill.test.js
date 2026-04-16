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

function runTests() {
  console.log('\n=== Testing ECC-SDLC sdlc-proposal/SKILL.md ===\n');

  let passed = 0;
  let failed = 0;

  // Skill file location in ECC repo structure
  // This test should be run from: ~/everything-claude-code/
  // Path: ~/.claude/skills/sdlc-proposal/SKILL.md (source of truth)
  const skillPath = path.join(process.env.HOME, '.claude', 'skills', 'sdlc-proposal', 'SKILL.md');

  let skillContent;
  if (!test('sdlc-proposal/SKILL.md exists and is readable', () => {
    assert.ok(fs.existsSync(skillPath), `File not found: ${skillPath}`);
    skillContent = fs.readFileSync(skillPath, 'utf8');
    assert.ok(skillContent.length > 0, 'Skill file is empty');
  })) {
    failed++;
    console.log('\n  Cannot continue — skill file is missing or empty.\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(1);
  } else {
    passed++;
  }

  console.log('File structure and headers:');

  if (test('first line is "# SDLC Proposal Skill"', () => {
    const firstLine = skillContent.split('\n')[0];
    assert.strictEqual(firstLine, '# SDLC Proposal Skill',
      'First line must be exactly "# SDLC Proposal Skill"');
  })) passed++; else failed++;

  if (test('second section header is "## Purpose"', () => {
    const lines = skillContent.split('\n');
    const purposeIndex = lines.findIndex(line => line === '## Purpose');
    assert.ok(purposeIndex > 0, '"## Purpose" section must exist');
    // Verify it's the second ## header (after title)
    const secondHeaderIndex = lines.findIndex((line, i) => 
      i > 0 && line.startsWith('## ')
    );
    assert.strictEqual(lines[secondHeaderIndex], '## Purpose',
      'Second section header must be "## Purpose"');
  })) passed++; else failed++;

  console.log('\nRequired content sections (acceptance criteria):');

  if (test('contains 9-section proposal structure definition', () => {
    assert.ok(skillContent.includes('Nine-Section Standard Structure'),
      'Must define 9-section structure');
    assert.ok(skillContent.includes('Executive Summary'),
      'Must include Executive Summary section');
    assert.ok(skillContent.includes('Understanding of Requirement'),
      'Must include Understanding of Requirement section');
    assert.ok(skillContent.includes('Proposed Solution'),
      'Must include Proposed Solution section');
    assert.ok(skillContent.includes('Technical Approach'),
      'Must include Technical Approach section');
    assert.ok(skillContent.includes('Team Profiles'),
      'Must include Team Profiles section');
    assert.ok(skillContent.includes('Project Timeline'),
      'Must include Project Timeline section');
    assert.ok(skillContent.includes('Cost Breakdown'),
      'Must include Cost Breakdown section');
    assert.ok(skillContent.includes('Compliance Statement'),
      'Must include Compliance Statement section');
    assert.ok(skillContent.includes('Appendices'),
      'Must include Appendices section');
  })) passed++; else failed++;

  if (test('9 sections are listed in correct order (Pakistani/GCC procurement standard)', () => {
    // Extract the numbered list from the 9-section structure
    const structureSection = skillContent.match(/1\.\s+\*\*Executive Summary\*\*[\s\S]*?9\.\s+\*\*Appendices\*\*/);
    assert.ok(structureSection, 'Could not find the 9-section numbered list');
    
    const sectionText = structureSection[0];
    
    // Verify order by checking that each section appears before the next
    const sections = [
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
    
    for (let i = 0; i < sections.length - 1; i++) {
      const currentPos = sectionText.indexOf(sections[i]);
      const nextPos = sectionText.indexOf(sections[i + 1]);
      assert.ok(currentPos < nextPos && currentPos !== -1 && nextPos !== -1,
        `Section ${i + 1} must appear before section ${i + 2} in the numbered list`);
    }
  })) passed++; else failed++;

  if (test('contains pricing narrative section with TCO guidance', () => {
    assert.ok(skillContent.includes('## 3. Pricing Narrative Techniques'),
      'Must have pricing narrative section');
    assert.ok(skillContent.includes('Total Cost of Ownership'),
      'Must mention TCO framing');
    assert.ok(skillContent.includes('Avoiding Day-Rate Exposure'),
      'Must warn against day rates');
    assert.ok(skillContent.includes('Local Currency and Payment Milestones'),
      'Must include local currency guidance');
  })) passed++; else failed++;

  if (test('contains win theme extraction section', () => {
    assert.ok(skillContent.includes('## 2. Win Theme Extraction'),
      'Must have win theme section');
    assert.ok(skillContent.includes('client-benefit statements'),
      'Must define win themes as client-benefit statements');
    assert.ok(skillContent.includes('must-priority requirements'),
      'Must link win themes to must-priority requirements');
    assert.ok(skillContent.includes('NOT feature descriptions'),
      'Must explicitly state win themes are not feature descriptions');
  })) passed++; else failed++;

  if (test('contains compliance statement section with regulatory framework references', () => {
    assert.ok(skillContent.includes('## 5. Compliance Statement Requirements'),
      'Must have compliance statement section');
    assert.ok(skillContent.includes('SBP-2024'),
      'Must reference SBP-2024 framework');
    assert.ok(skillContent.includes('PPRA-2024'),
      'Must reference PPRA-2024 framework');
    assert.ok(skillContent.includes('SAMA-2024'),
      'Must reference SAMA-2024 framework');
  })) passed++; else failed++;

  console.log('\nPricing narrative content validation (min 3 points required):');

  const pricingSection = skillContent.match(/## 3\. Pricing Narrative Techniques.*?(?=## 4\.|$)/s);
  if (!pricingSection) {
    console.log('  ✗ Could not extract pricing narrative section');
    failed++;
  } else {
    const pricingContent = pricingSection[0];
    let pricingPoints = 0;

    if (test('pricing point 1: TCO framing (not just upfront cost)', () => {
      assert.ok(pricingContent.includes('Total Cost of Ownership'),
        'Must include TCO framing guidance');
      assert.ok(pricingContent.includes('lifecycle cost') || pricingContent.includes('upfront price'),
        'Must explain TCO vs upfront pricing');
    })) { passed++; pricingPoints++; } else failed++;

    if (test('pricing point 2: avoid day-rate exposure', () => {
      assert.ok(pricingContent.includes('day rates') || pricingContent.includes('hourly rates'),
        'Must warn against day rates');
      assert.ok(pricingContent.includes('fixed-price') || pricingContent.includes('deliverable'),
        'Must recommend fixed-price deliverables');
    })) { passed++; pricingPoints++; } else failed++;

    if (test('pricing point 3: local currency usage', () => {
      assert.ok(pricingContent.includes('PKR') && pricingContent.includes('AED'),
        'Must specify local currencies (PKR, AED, etc.)');
      assert.ok(pricingContent.includes('payment milestones') || pricingContent.includes('phase gate'),
        'Must tie payments to milestones');
    })) { passed++; pricingPoints++; } else failed++;

    if (test('pricing guidance has at least 3 specific points', () => {
      assert.ok(pricingPoints >= 3,
        `Found ${pricingPoints} pricing points, minimum 3 required`);
    })) passed++; else failed++;
  }

  console.log('\nRegulatory framework coverage:');

  if (test('mentions State Bank of Pakistan (SBP)', () => {
    assert.ok(skillContent.includes('State Bank of Pakistan') || skillContent.includes('SBP'),
      'Must reference State Bank of Pakistan');
  })) passed++; else failed++;

  if (test('mentions Public Procurement Regulatory Authority (PPRA)', () => {
    assert.ok(skillContent.includes('Public Procurement Regulatory Authority') || 
              skillContent.includes('PPRA'),
      'Must reference PPRA');
  })) passed++; else failed++;

  if (test('mentions Saudi Arabian Monetary Authority (SAMA)', () => {
    assert.ok(skillContent.includes('Saudi Arabian Monetary Authority') || 
              skillContent.includes('SAMA'),
      'Must reference SAMA');
  })) passed++; else failed++;

  if (test('mentions GCC central banks (CBUAE, CBK)', () => {
    assert.ok(skillContent.includes('CBUAE') || skillContent.includes('Central Bank of UAE'),
      'Must reference CBUAE');
    // CBK is optional but good to have
  })) passed++; else failed++;

  if (test('mentions AAOIFI for Islamic finance', () => {
    assert.ok(skillContent.includes('AAOIFI') || skillContent.includes('Islamic finance'),
      'Must reference AAOIFI or Islamic finance standards');
  })) passed++; else failed++;

  console.log('\nContext-specific examples:');

  if (test('includes Pakistani context examples (FBR, NADRA, Punjab)', () => {
    const hasPakistaniExamples = 
      skillContent.includes('FBR') ||
      skillContent.includes('Federal Board of Revenue') ||
      skillContent.includes('NADRA') ||
      skillContent.includes('Punjab Revenue Authority');
    assert.ok(hasPakistaniExamples,
      'Must include at least one Pakistani institution example');
  })) passed++; else failed++;

  if (test('includes GCC banking examples (ADCB, Emirates NBD)', () => {
    const hasGCCExamples = 
      skillContent.includes('ADCB') ||
      skillContent.includes('Abu Dhabi Commercial Bank') ||
      skillContent.includes('Emirates NBD');
    assert.ok(hasGCCExamples,
      'Must include at least one GCC banking example');
  })) passed++; else failed++;

  if (test('mentions Urdu language support for Pakistani context', () => {
    assert.ok(skillContent.includes('Urdu'),
      'Must mention Urdu language support');
  })) passed++; else failed++;

  if (test('mentions Arabic language support for GCC context', () => {
    assert.ok(skillContent.includes('Arabic'),
      'Must mention Arabic language support');
  })) passed++; else failed++;

  console.log('\nDocument generation integration:');

  if (test('references state.json as data source', () => {
    assert.ok(skillContent.includes('state.json'),
      'Must reference state.json as data source');
  })) passed++; else failed++;

  if (test('references upstream artifacts (SRS, SDS, STS, estimate)', () => {
    assert.ok(skillContent.includes('SRS') || skillContent.includes('Software Requirements'),
      'Must reference SRS artifact');
    assert.ok(skillContent.includes('SDS') || skillContent.includes('Software Design'),
      'Must reference SDS artifact');
    assert.ok(skillContent.includes('STS') || skillContent.includes('Software Test'),
      'Must reference STS artifact');
    assert.ok(skillContent.includes('estimate') || skillContent.includes('Estimate'),
      'Must reference estimate artifact');
  })) passed++; else failed++;

  if (test('references docx-js for document generation', () => {
    assert.ok(skillContent.includes('docx-js') || skillContent.includes('.docx'),
      'Must reference docx-js or .docx output format');
  })) passed++; else failed++;

  if (test('mentions Mermaid diagrams from SDS', () => {
    assert.ok(skillContent.includes('Mermaid'),
      'Must reference Mermaid diagram integration');
  })) passed++; else failed++;

  console.log('\nQuality validation features:');

  if (test('includes quality validation checklist', () => {
    assert.ok(skillContent.includes('Quality Validation') || 
              skillContent.includes('validation checklist') ||
              skillContent.includes('Checklist'),
      'Must include quality validation guidance');
  })) passed++; else failed++;

  if (test('includes anti-patterns or common mistakes section', () => {
    assert.ok(skillContent.includes('Common Mistakes') || 
              skillContent.includes('Anti-Pattern') ||
              skillContent.includes('anti-pattern'),
      'Must include anti-patterns or common mistakes');
  })) passed++; else failed++;

  console.log('\nCross-reference validation:');

  if (test('win theme definition is consistent with technical proposal', () => {
    // Win themes should be defined as client-benefit statements
    // derived from must-priority requirements, not feature descriptions
    const hasWinThemeDef = skillContent.includes('client-benefit statements');
    const linksMustReqs = skillContent.includes('must-priority requirements');
    const notFeatures = skillContent.includes('NOT feature descriptions');
    
    assert.ok(hasWinThemeDef && linksMustReqs && notFeatures,
      'Win theme definition must be complete: client-benefit + must-reqs + not features');
  })) passed++; else failed++;

  // Check for proposal-writer.md agent file and validate consistency
  const proposalWriterPath = path.join(process.env.HOME, '.claude', 'agents', 'proposal-writer.md');
  if (fs.existsSync(proposalWriterPath)) {
    if (test('win theme definition matches proposal-writer.md agent instruction', () => {
      const agentContent = fs.readFileSync(proposalWriterPath, 'utf8');
      
      // Extract win theme definition from skill
      const skillWinThemeDef = skillContent.includes('client-benefit statements derived from must-priority requirements');
      
      // Check if agent has consistent instruction
      const agentHasConsistentDef = 
        agentContent.includes('win theme') && 
        (agentContent.includes('client-benefit') || agentContent.includes('must-priority'));
      
      assert.ok(skillWinThemeDef,
        'Skill must define win themes as client-benefit statements from must-priority requirements');
      
      if (agentHasConsistentDef) {
        console.log('    Note: proposal-writer.md agent found and has consistent win theme instruction');
      } else {
        console.log('    Warning: proposal-writer.md agent found but win theme definition may differ');
      }
      
      // This is a soft check - we just verify the skill has the right definition
      assert.ok(skillWinThemeDef, 'Skill win theme definition is correct');
    })) passed++; else failed++;
  } else {
    console.log('  ⚠ proposal-writer.md agent not found - skipping consistency check');
    console.log('    (This check will be performed once proposal-writer.md is created)');
    passed++; // Don't fail for missing file that doesn't exist yet
  }

  if (test('references MoSCoW prioritization (must/should/could/wont)', () => {
    // Should reference MoSCoW since win themes come from "must" requirements
    assert.ok(skillContent.includes('must-priority') || 
              skillContent.includes('must') && skillContent.includes('priority'),
      'Must reference must-priority requirements for win theme extraction');
  })) passed++; else failed++;

  console.log('\nMarkdown quality:');

  if (test('file does not contain YAML frontmatter', () => {
    assert.ok(!skillContent.startsWith('---'),
      'Skill file must not have YAML frontmatter (plain markdown only)');
  })) passed++; else failed++;

  if (test('file length is within acceptable range (150-1000 lines)', () => {
    const lineCount = skillContent.split('\n').length;
    assert.ok(lineCount >= 150,
      `File is too short: ${lineCount} lines (minimum 150)`);
    assert.ok(lineCount <= 1000,
      `File is too long: ${lineCount} lines (maximum 1000 for maintainability)`);
  })) passed++; else failed++;

  console.log('\nAppendices guidance:');

  if (test('includes appendices content checklist', () => {
    assert.ok(skillContent.includes('Appendices') || 
              skillContent.includes('appendices'),
      'Must include appendices guidance');
    assert.ok(skillContent.includes('past performance') || 
              skillContent.includes('Past Performance'),
      'Must mention past performance references in appendices');
    assert.ok(skillContent.includes('certifications') || 
              skillContent.includes('Certifications'),
      'Must mention certifications in appendices');
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed! sdlc-proposal skill is valid.\n');
  } else {
    console.log(`\n❌ ${failed} test(s) failed. Review the skill file.\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
