#!/usr/bin/env node
'use strict';

/*
 * sync-to-claude.js
 *
 * Syncs all ECC-SDLC additions from your dev repo into .claude/ so
 * Claude Code picks them up immediately.
 *
 * Run from the root of your ECC-SDLC dev repo:
 *   node sync-to-claude.js            (apply)
 *   node sync-to-claude.js --dry-run  (preview only)
 *
 * KEY FIX: SDLC hook commands are written with ABSOLUTE paths.
 * ~/.claude/hooks.json is a user-level file. Claude Code does NOT
 * expand ${CLAUDE_PLUGIN_ROOT} in user-level hooks.json, only in
 * plugin-cache hooks.json. So we replace it with the real path.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DRY_RUN = process.argv.includes('--dry-run');
const REPO_ROOT = __dirname;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const SDLC_COMMANDS = ['scope.md', 'sds.md', 'srs.md', 'sts.md', 'sdlc-status.md', 'mom.md', 'compliance.md', 'estimate.md', 'proposal.md', 'go-nogo.md', 'traceability.md'];

const SDLC_AGENTS = ['business-analyst.md', 'solution-architect.md', 'technical-writer.md', 'compliance-checker.md', 'estimator.md', 'proposal-writer.md'];

const SDLC_SCHEMAS = ['scope.schema.json', 'sds.schema.json', 'sdlc-state.schema.json', 'requirement.schema.json', 'design-component.schema.json'];

const SDLC_TEMPLATES = ['scope-template.json', 'sds-template.json', 'srs-template.json', 'estimation-template.json', 'proposal-template.json'];

function ok(msg) {
  console.log('  ok  ' + msg);
}
function skip(msg) {
  console.log('  --  ' + msg);
}
function dry(msg) {
  console.log('  ~~  ' + msg + '  [dry-run]');
}
function err(msg) {
  console.log('  !!  ' + msg);
}

function ensureDir(d) {
  if (!fs.existsSync(d)) {
    if (DRY_RUN) {
      dry('mkdir ' + d);
      return;
    }
    fs.mkdirSync(d, { recursive: true });
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    skip(path.relative(REPO_ROOT, src) + ' not found');
    return false;
  }
  ensureDir(path.dirname(dest));
  const label = path.relative(REPO_ROOT, src) + ' => .claude/' + path.relative(CLAUDE_DIR, dest);
  if (DRY_RUN) {
    dry(label);
    return true;
  }
  fs.copyFileSync(src, dest);
  ok(label);
  return true;
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    skip(path.relative(REPO_ROOT, srcDir) + '/ not found');
    return;
  }
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    entry.isDirectory() ? copyDir(s, d) : copyFile(s, d);
  }
}

/*
 * Merge SDLC hook entries into ~/.claude/settings.json.
 *
 * Claude Code reads hooks from settings.json — NOT from a separate hooks.json.
 * hooks.json in the plugin cache is read-only (managed by the plugin system).
 * User-level hooks must live in ~/.claude/settings.json under a "hooks" key.
 *
 * ${CLAUDE_PLUGIN_ROOT} IS expanded by Claude Code in settings.json,
 * so we keep it as-is — no need to rewrite to absolute paths.
 *
 * The merge is idempotent: matched by description field starting with "SDLC:".
 * Running sync multiple times never creates duplicates.
 */
function mergeSettingsJson() {
  const srcPath = path.join(REPO_ROOT, 'hooks', 'hooks.json');
  const destPath = path.join(CLAUDE_DIR, 'settings.json');

  if (!fs.existsSync(srcPath)) {
    skip('hooks/hooks.json not found');
    return;
  }

  let src;
  try {
    src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  } catch (e) {
    err('Cannot parse repo hooks/hooks.json: ' + e.message);
    return;
  }

  // Collect only SDLC-labelled hook entries from the repo hooks.json
  const sdlcEntries = {};
  for (const [event, entries] of Object.entries(src.hooks || {})) {
    const sdlc = (entries || []).filter(function (e) {
      return typeof e.description === 'string' && e.description.startsWith('SDLC:');
    });
    if (sdlc.length > 0) sdlcEntries[event] = sdlc;
  }

  if (Object.keys(sdlcEntries).length === 0) {
    skip('hooks/hooks.json: no SDLC: entries found');
    return;
  }

  // Read existing settings.json — preserve ALL existing keys, only add/update hooks
  let dest = {};
  if (fs.existsSync(destPath)) {
    try {
      dest = JSON.parse(fs.readFileSync(destPath, 'utf8'));
    } catch (e) {
      err('Cannot parse settings.json: ' + e.message + ' — aborting to avoid data loss');
      return;
    }
  }

  // Safety check: if enabledPlugins is missing, the file is incomplete.
  // Abort rather than write back a broken file — user must restore enabledPlugins manually.
  if (dest.enabledPlugins === undefined && Object.keys(dest).length > 0 && !dest.hooks) {
    err('settings.json is missing enabledPlugins — file may be corrupted. Restore it before syncing.');
    err('Expected keys: enabledPlugins, extraKnownMarketplaces, autoUpdatesChannel, hooks');
    return;
  }

  if (!dest.hooks) dest.hooks = {};

  let added = 0,
    updated = 0;

  for (const [event, sdlcList] of Object.entries(sdlcEntries)) {
    if (!dest.hooks[event]) dest.hooks[event] = [];

    for (const entry of sdlcList) {
      const clone = JSON.parse(JSON.stringify(entry)); // deep copy, keep ${CLAUDE_PLUGIN_ROOT} as-is

      const existingIdx = dest.hooks[event].findIndex(function (e) {
        return e.description === entry.description;
      });

      if (existingIdx === -1) {
        if (DRY_RUN) {
          dry('[' + event + '] ADD: ' + entry.description);
        } else {
          dest.hooks[event].push(clone);
        }
        added++;
      } else {
        if (DRY_RUN) {
          dry('[' + event + '] UPDATE: ' + entry.description);
        } else {
          dest.hooks[event][existingIdx] = clone;
        }
        updated++;
      }
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(destPath, JSON.stringify(dest, null, 2), 'utf8');
    ok('settings.json hooks merged: ' + added + ' added, ' + updated + ' updated');
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('\nECC-SDLC sync' + (DRY_RUN ? ' [DRY RUN]' : ''));
console.log('  From: ' + REPO_ROOT);
console.log('  To:   ' + CLAUDE_DIR + '\n');

console.log('-- Commands --');
SDLC_COMMANDS.forEach(function (cmd) {
  copyFile(path.join(REPO_ROOT, 'commands', cmd), path.join(CLAUDE_DIR, 'commands', cmd));
});

console.log('\n-- settings.json hooks (merge) --');
mergeSettingsJson();

console.log('\n-- Agents --');
SDLC_AGENTS.forEach(function (agent) {
  copyFile(path.join(REPO_ROOT, 'agents', agent), path.join(CLAUDE_DIR, 'agents', agent));
});

console.log('\n-- Skills (sdlc-*) --');
var skillsDir = path.join(REPO_ROOT, 'skills');
if (fs.existsSync(skillsDir)) {
  fs.readdirSync(skillsDir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.isDirectory() && entry.name.startsWith('sdlc-')) {
      copyDir(path.join(skillsDir, entry.name), path.join(CLAUDE_DIR, 'skills', entry.name));
    }
  });
} else {
  skip('skills/ not found');
}

console.log('\n-- Frameworks --');
copyDir(path.join(REPO_ROOT, 'frameworks'), path.join(CLAUDE_DIR, 'frameworks'));

console.log('\n-- Rules/sdlc --');
copyDir(path.join(REPO_ROOT, 'rules', 'sdlc'), path.join(CLAUDE_DIR, 'rules', 'sdlc'));

console.log('\n-- Schemas --');
SDLC_SCHEMAS.forEach(function (s) {
  copyFile(path.join(REPO_ROOT, 'schemas', s), path.join(CLAUDE_DIR, 'schemas', s));
});

console.log('\n-- Templates --');
SDLC_TEMPLATES.forEach(function (t) {
  copyFile(path.join(REPO_ROOT, 'templates', t), path.join(CLAUDE_DIR, 'templates', t));
});

console.log('\n----------------------------------------------');
if (DRY_RUN) {
  console.log('Dry run complete. No files written.');
  console.log('Run without --dry-run to apply.\n');
} else {
  console.log('Sync complete.');
  console.log('Restart Claude Code to activate hook changes.');
  console.log('Commands and agents are active immediately.\n');
}
