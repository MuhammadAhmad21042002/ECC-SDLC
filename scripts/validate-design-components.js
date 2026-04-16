#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createSchemaValidator } = require('../lib/schema-validator');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--repoRoot') args.repoRoot = argv[++i];
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/validate-design-components.js --file <path> [--repoRoot <path>]');
    process.exit(2);
  }

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(__dirname, '..');
  const validator = createSchemaValidator({ repoRoot });

  const abs = path.resolve(process.cwd(), args.file);
  const arr = readJson(abs);
  if (!Array.isArray(arr)) {
    console.error(`ERR:design-components:${args.file}:Expected JSON array`);
    process.exit(1);
  }

  for (const item of arr) {
    try {
      validator.assertValid(item, 'design-component');
    } catch (err) {
      console.error(`ERR:design-components:${args.file}:${err.message}`);
      process.exit(1);
    }
  }

  console.log(`OK:design-components:${args.file}:${arr.length}`);
}

main();

