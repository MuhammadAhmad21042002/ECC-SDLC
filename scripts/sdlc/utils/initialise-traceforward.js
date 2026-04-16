#!/usr/bin/env node
/**
 * ECC-SDLC — Merge-Safe traceForward Initialiser
 *
 * Ensures every requirement object in a requirements array has a `traceForward`
 * object with all three forward-link arrays initialised:
 *   - designComponentIds  (populated by /sds)
 *   - testCaseIds         (populated by /sts)
 *   - costLineItemIds     (populated by /estimate)
 *
 * Merge-safe rules:
 *   - If `traceForward` is absent: create it with all three keys set to [].
 *   - If `traceForward` exists: for each of the three array keys, only set to []
 *     if that key is absent — never overwrite a key that already exists, even if
 *     it is already an empty array.
 *   - If an existing value is not an array (e.g. null, a string) it is treated as
 *     absent and replaced with [].
 *
 * Properties:
 *   - Idempotent: calling multiple times produces the same output.
 *   - Immutable: returns a new requirements array; never mutates the input.
 *   - Safe on legacy state: handles requirements with no traceForward key at all.
 *
 * Usage (called by /srs after AJV validation passes):
 *
 *   const { initialiseTraceForward } = require('./scripts/sdlc/utils/initialise-traceforward');
 *   const { writeJsonAtomic }        = require('./scripts/sdlc/utils/state-writer');
 *
 *   state.requirements = initialiseTraceForward(state.requirements);
 *   writeJsonAtomic(statePath, state);
 */

'use strict';

/**
 * Return a new requirements array where every entry has a fully-initialised
 * `traceForward` object.  The input array is never mutated.
 *
 * @param {Array} requirements - Array of requirement objects from state.json.
 * @returns {Array} New array with traceForward ensured on every entry.
 */
function initialiseTraceForward(requirements) {
  if (!Array.isArray(requirements)) return requirements;

  return requirements.map(req => {
    // Guard against non-object entries (should never happen, but be safe).
    if (!req || typeof req !== 'object') return req;

    const existing = req.traceForward && typeof req.traceForward === 'object' && !Array.isArray(req.traceForward)
      ? req.traceForward
      : null;

    const traceForward = {
      // Only initialise each key to [] if it is absent or not an array.
      // Never overwrite a key that is already an array (even if empty).
      designComponentIds: existing !== null && Array.isArray(existing.designComponentIds)
        ? existing.designComponentIds
        : [],
      testCaseIds: existing !== null && Array.isArray(existing.testCaseIds)
        ? existing.testCaseIds
        : [],
      costLineItemIds: existing !== null && Array.isArray(existing.costLineItemIds)
        ? existing.costLineItemIds
        : []
    };

    return { ...req, traceForward };
  });
}

/**
 * Apply `initialiseTraceForward` to `state.requirements` and write the result
 * back to `statePath` using the atomic writer.
 *
 * This is the top-level entry point called by the /srs command as its final
 * step after AJV validation has passed and requirements have been written.
 *
 * @param {string} statePath - Absolute path to .sdlc/state.json.
 * @param {object} state     - Current parsed state object.
 * @returns {object} Updated state (same reference as input, requirements mutated).
 */
function applyToState(statePath, state) {
  const { writeJsonAtomic } = require('./state-writer');

  const updated = {
    ...state,
    requirements: initialiseTraceForward(state.requirements)
  };

  writeJsonAtomic(statePath, updated);
  return updated;
}

module.exports = { initialiseTraceForward, applyToState };
