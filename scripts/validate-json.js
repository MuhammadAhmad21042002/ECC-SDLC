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
    if (a === '--schema') args.schema = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--repoRoot') args.repoRoot = argv[++i];
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.schema || !args.file) {
    console.error('Usage: node scripts/validate-json.js --schema <name> --file <path> [--repoRoot <path>]');
    process.exit(2);
  }

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(__dirname, '..');
  const validator = createSchemaValidator({ repoRoot });

  const abs = path.resolve(process.cwd(), args.file);
  const data = readJson(abs);

  try {
    validator.assertValid(data, args.schema);
    console.log(`OK:${args.schema}:${args.file}`);
  } catch (err) {
    console.error(`ERR:${args.schema}:${args.file}:${err.message}`);
    process.exit(1);
  }
}

main();

