'use strict';

/**
 * DispatchEvent shape factory — issue #177 (ADR-0174 P1.3), extended in #178 (P1.4).
 *
 * Creates a structured event record for every Hub dispatch, used by
 * DispatchLogger to emit stderr errors and opt-in file audit trails.
 *
 * Shape:
 *   traceId:       string           — UUID v4, generated per dispatch
 *   parentTraceId: string|undefined — propagated from the caller when present; undefined otherwise.
 *                                     Enables a future init-composer (Phase 2) to correlate child
 *                                     dispatches to their parent via the audit file.
 *   command:       string  — the dispatched verb
 *   args?:         unknown — only present when includeArgs === true
 *   result:        { kind: 'ok' | 'UnknownCommand' | 'InvalidArgs' | 'HandlerRefusal' | 'HandlerFailure', ...payload }
 *   timestamp:     string  — ISO 8601
 */

const { randomUUID } = require('crypto');

/**
 * Create a DispatchEvent.
 *
 * @param {object} opts
 * @param {string}   opts.command     - The dispatched command verb.
 * @param {unknown}  [opts.args]      - Raw args passed to the hub.
 * @param {object}   opts.result      - The HubResult returned by the hub.
 * @param {boolean}  [opts.includeArgs=false] - When true, include args in the event.
 * @param {string}   [opts.parentTraceId]     - When provided as a non-null string, propagated into
 *   the event. null, non-string, or absent values all yield undefined (defensive normalization).
 * @returns {object} Immutable DispatchEvent record.
 */
function makeDispatchEvent({ command, args, result, includeArgs = false, parentTraceId }) {
  // Defensive normalization: only propagate parentTraceId when it is a non-null string.
  // null, numbers, objects, and absent values all collapse to undefined — consistent with
  // how args is omitted rather than coerced when invalid.
  const resolvedParentTraceId = (typeof parentTraceId === 'string' && parentTraceId !== null)
    ? parentTraceId
    : undefined;

  const event = {
    traceId: randomUUID(),
    parentTraceId: resolvedParentTraceId,
    command: String(command),
    result,
    timestamp: new Date().toISOString(),
  };

  if (includeArgs && args !== undefined) {
    event.args = args;
  }

  return Object.freeze(event);
}

module.exports = { makeDispatchEvent };
