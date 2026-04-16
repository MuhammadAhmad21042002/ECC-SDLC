#!/usr/bin/env node
'use strict';
/**
 * merge-srs-parts.js
 *
 * Merges three partial SRS narrative JSON files produced by parallel
 * technical-writer agents into a single srs-data.json.
 *
 * Usage:
 *   node merge-srs-parts.js \
 *     --part1 .sdlc/tmp/srs-part1.json \
 *     --part2 .sdlc/tmp/srs-part2.json \
 *     --part3 .sdlc/tmp/srs-part3.json \
 *     --out   .sdlc/tmp/srs-data.json
 *
 * Merge rules:
 *   - Scalar fields (strings): last non-null/non-empty wins
 *   - Array fields: first non-empty array wins (part1 > part2 > part3)
 *   - srsData wrapper unwrapped automatically
 */

const fs   = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--part1') a.part1 = argv[++i];
    else if (argv[i] === '--part2') a.part2 = argv[++i];
    else if (argv[i] === '--part3') a.part3 = argv[++i];
    else if (argv[i] === '--out')   a.out   = argv[++i];
  }
  return a;
}

function readPart(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw.srsData || raw;
  } catch (e) {
    process.stderr.write(`[merge-srs-parts] Warning: could not parse ${filePath}: ${e.message}\n`);
    return {};
  }
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function mergeParts(parts) {
  const merged = {};
  // Collect all keys across all parts
  const allKeys = new Set(parts.flatMap(p => Object.keys(p)));

  for (const key of allKeys) {
    const values = parts.map(p => p[key]).filter(v => v !== undefined);
    if (values.length === 0) continue;

    // Determine type from first non-null value
    const sample = values.find(v => v != null);
    if (Array.isArray(sample)) {
      // Array: first non-empty array wins; for useCases/systemFeatures concatenate if multiple parts have data
      const concatKeys = new Set(['useCases', 'systemFeatures', 'businessRules', 'tbdList', 'definitionsTable', 'userClasses']);
      if (concatKeys.has(key)) {
        // Concatenate all non-empty arrays, deduplicate by id field
        const combined = [];
        const seen = new Set();
        for (const v of values) {
          if (!Array.isArray(v) || v.length === 0) continue;
          for (const item of v) {
            const idKey = item.id || item.featureId || item.term || item.role || JSON.stringify(item);
            if (!seen.has(idKey)) { seen.add(idKey); combined.push(item); }
          }
        }
        merged[key] = combined.length > 0 ? combined : (values.find(v => Array.isArray(v) && v.length > 0) || []);
      } else {
        // First non-empty array wins
        merged[key] = values.find(v => Array.isArray(v) && v.length > 0) || [];
      }
    } else if (typeof sample === 'object' && sample !== null) {
      // Object: shallow merge, last non-null wins per sub-key
      const obj = {};
      for (const v of values) {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(obj, v);
      }
      merged[key] = obj;
    } else {
      // Scalar: last non-empty value wins
      merged[key] = values.reverse().find(v => !isEmpty(v)) ?? sample;
    }
  }

  return merged;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.out) { console.error('Usage: --part1 <f> --part2 <f> --part3 <f> --out <f>'); process.exit(2); }

  const part1 = readPart(args.part1);
  const part2 = readPart(args.part2);
  const part3 = readPart(args.part3);

  const merged = mergeParts([part1, part2, part3]);
  const outPath = path.resolve(process.cwd(), args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));

  const uc  = merged.useCases       ? merged.useCases.length       : 0;
  const ft  = merged.systemFeatures ? merged.systemFeatures.length : 0;
  const br  = merged.businessRules  ? merged.businessRules.length  : 0;
  process.stderr.write(`[merge-srs-parts] Merged → ${outPath}\n`);
  process.stderr.write(`[merge-srs-parts] features=${ft}, useCases=${uc}, businessRules=${br}\n`);
  console.log(`SDLC:SRS:PARTS_MERGED:${outPath}`);
}

main();
