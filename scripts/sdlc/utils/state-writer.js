#!/usr/bin/env node
/**
 * ECC-SDLC — Atomic State Writer
 *
 * Writes a state object to a JSON file using an atomic write pattern:
 *   1. Serialize to <targetPath>.<pid>.<random>.tmp
 *   2. Move existing targetPath → targetPath.bak  (kept as last-good backup)
 *   3. Move .tmp → targetPath
 *
 * On success: targetPath contains new data; targetPath.bak is preserved as a
 * last-known-good copy so callers (and tests) can confirm the atomic writer ran.
 *
 * On failure: the .tmp file is removed, and the original is restored from .bak
 * if it was moved aside before the failure.
 *
 * This module is intentionally standalone — it has no runtime dependency on
 * lib/state-manager.js so it can be imported by any SDLC utility without
 * pulling in AJV schema validation. Callers are responsible for ensuring the
 * data is valid before writing.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

/**
 * Atomically write `data` (JSON-serializable) to `targetPath`.
 *
 * @param {string} targetPath  - Absolute path of the destination file.
 * @param {object} data        - Object to serialize as formatted JSON.
 * @throws {Error} If the write or rename step fails.
 */
function writeJsonAtomic(targetPath, data) {
  const dir     = path.dirname(targetPath);
  const unique  = `${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = `${targetPath}.${unique}.tmp`;
  const bakPath = `${targetPath}.bak`;

  fs.mkdirSync(dir, { recursive: true });

  try {
    // ── Step 1: write to tmp ────────────────────────────────────────────────
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');

    // ── Step 2: move existing target to .bak ───────────────────────────────
    // Kept intentionally after success as a last-known-good safety copy.
    if (fs.existsSync(targetPath)) {
      try {
        if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
      } catch {
        // ignore: stale .bak removal failure should not block the write
      }
      fs.renameSync(targetPath, bakPath);
    }

    // ── Step 3: move tmp into place ────────────────────────────────────────
    // On Windows, renameSync across drives/volumes can fail with EXDEV;
    // in that case fall back to copy+delete.
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        fs.copyFileSync(tmpPath, targetPath);
        fs.unlinkSync(tmpPath);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    // ── Cleanup on failure ──────────────────────────────────────────────────
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    // Restore original from backup if the rename moved it aside before failing.
    try {
      if (!fs.existsSync(targetPath) && fs.existsSync(bakPath)) {
        fs.renameSync(bakPath, targetPath);
      }
    } catch { /* ignore rollback errors */ }
    throw err;
  }
}

module.exports = { writeJsonAtomic };
