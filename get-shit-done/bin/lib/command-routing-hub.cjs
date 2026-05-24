'use strict';

/**
 * Command Routing Hub — issue #3788, simplified in #175, typed in #176.
 *
 * A pure-result dispatch hub that centralizes CJS routing,
 * the error taxonomy, and the no-throw contract that all command-family routers
 * currently duplicate independently.
 *
 * Design:
 *   createHub({ cjsRegistry, manifest }) -> hub
 *   hub.dispatch({ family, subcommand, args, cwd, raw })  -> Result
 *
 *   Result = { ok: true, data }
 *           | { ok: false, kind: 'UnknownCommand',  command: string }
 *           | { ok: false, kind: 'InvalidArgs',     arg: string, reason: string }
 *           | { ok: false, kind: 'HandlerRefusal',  reason: string }
 *           | { ok: false, kind: 'HandlerFailure',  message: string, cause?: Error }
 *
 * Invariants:
 *   - Hub always routes through CJS handlers. There is no SDK path (#175).
 *   - Hub never prints to stdout/stderr, never calls process.exit.
 *   - Hub never throws — all internal throws are caught and converted to
 *     { ok: false, kind: 'HandlerFailure', message, cause }.
 *   - The kind taxonomy is closed. Callers switch on ERROR_KINDS values.
 *   - Each error variant carries ONLY its own typed payload (#176).
 *     No cross-variant `message`/`details` escape hatches.
 */

/**
 * Closed error-kind enum. Export as a frozen object so callers can switch on
 * ERROR_KINDS.UnknownCommand etc. without relying on bare string literals.
 *
 * #175: SdkLoadFailed and SdkDispatchFailed removed — Hub is CJS-only.
 * #176: Field renamed errorKind → kind; payloads are typed per variant.
 *
 * @readonly
 */
const ERROR_KINDS = Object.freeze({
  /** The requested family/subcommand combination is not present in the manifest. */
  UnknownCommand: 'UnknownCommand',
  /** The handler rejected the supplied arguments before executing. */
  InvalidArgs: 'InvalidArgs',
  /** A CJS handler returned an explicit refusal (e.g. unsupported subcommand). */
  HandlerRefusal: 'HandlerRefusal',
  /** A handler threw an unexpected exception. */
  HandlerFailure: 'HandlerFailure',
});

// ─── Typed-payload factories (#176) ──────────────────────────────────────────
// Each factory returns the exact discriminated-union variant for its kind.
// No cross-variant fields bleed between variants.

/**
 * @param {string} command - The unrecognised command string (family or family+subcommand).
 * @returns {{ ok: false, kind: 'UnknownCommand', command: string }}
 */
function makeUnknownCommand(command) {
  return { ok: false, kind: ERROR_KINDS.UnknownCommand, command };
}

/**
 * @param {string} arg    - The argument token that failed validation.
 * @param {string} reason - Human-readable explanation of the failure.
 * @returns {{ ok: false, kind: 'InvalidArgs', arg: string, reason: string }}
 */
function makeInvalidArgs(arg, reason) {
  return { ok: false, kind: ERROR_KINDS.InvalidArgs, arg, reason };
}

/**
 * @param {string} reason - Human-readable explanation for the refusal.
 * @returns {{ ok: false, kind: 'HandlerRefusal', reason: string }}
 */
function makeHandlerRefusal(reason) {
  return { ok: false, kind: ERROR_KINDS.HandlerRefusal, reason };
}

/**
 * @param {string} message  - Human-readable description of the failure.
 * @param {Error}  [cause]  - The original thrown Error, when available.
 * @returns {{ ok: false, kind: 'HandlerFailure', message: string, cause?: Error }}
 */
function makeHandlerFailure(message, cause) {
  const result = { ok: false, kind: ERROR_KINDS.HandlerFailure, message };
  if (cause !== undefined) result.cause = cause;
  return result;
}

/**
 * @typedef {{ ok: true, data: unknown }} OkResult
 * @typedef {{ ok: false, kind: 'UnknownCommand', command: string }} UnknownCommandResult
 * @typedef {{ ok: false, kind: 'InvalidArgs', arg: string, reason: string }} InvalidArgsResult
 * @typedef {{ ok: false, kind: 'HandlerRefusal', reason: string }} HandlerRefusalResult
 * @typedef {{ ok: false, kind: 'HandlerFailure', message: string, cause?: Error }} HandlerFailureResult
 * @typedef {UnknownCommandResult | InvalidArgsResult | HandlerRefusalResult | HandlerFailureResult} ErrResult
 * @typedef {OkResult | ErrResult} HubResult
 */

/**
 * @typedef {object} HubOptions
 * @property {Record<string, Record<string, (ctx: object) => HubResult>>} [cjsRegistry] -
 *   Nested map of family -> subcommand -> handler.
 * @property {Record<string, string[]>} [manifest] - Map of family -> known subcommands.
 *   Used for UnknownCommand detection.
 */

/**
 * Construct a CommandRoutingHub.
 *
 * @param {HubOptions} options
 * @returns {{ dispatch: (req: object) => HubResult }}
 */
function createHub({ cjsRegistry, manifest } = {}) {
  const _cjsRegistry = cjsRegistry;
  const _manifest = manifest;

  /**
   * Dispatch a command through the hub.
   *
   * @param {{ family: string, subcommand: string, args?: unknown[], cwd?: string, raw?: boolean }} req
   * @returns {HubResult}
   */
  function dispatch(req) {
    try {
      return _dispatch(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      return makeHandlerFailure(message, cause);
    }
  }

  function _dispatch(req) {
    const { family, subcommand, args = [], cwd, raw } = req;

    // ── manifest check ────────────────────────────────────────────────────────
    if (_manifest) {
      const knownSubcommands = _manifest[family];
      if (!knownSubcommands) {
        return makeUnknownCommand(String(family));
      }
      if (subcommand && !knownSubcommands.includes(subcommand)) {
        return makeUnknownCommand(`${family} ${subcommand}`);
      }
    }

    return _dispatchCjs({ family, subcommand, args, cwd, raw });
  }

  function _dispatchCjs({ family, subcommand, args, cwd, raw }) {
    if (!_cjsRegistry) {
      return makeUnknownCommand(String(family));
    }

    const familyHandlers = _cjsRegistry[family];
    if (!familyHandlers) {
      return makeUnknownCommand(String(family));
    }

    const handler = subcommand ? familyHandlers[subcommand] : familyHandlers[''];
    if (typeof handler !== 'function') {
      return makeUnknownCommand(subcommand ? `${family} ${subcommand}` : String(family));
    }

    // Invoke the handler. It must return a HubResult or throw.
    // If it throws, the outer try/catch in dispatch() catches it.
    const result = handler({ family, subcommand, args, cwd, raw });

    // If the handler returned a well-formed HubResult, pass it through.
    if (result && typeof result === 'object' && 'ok' in result) {
      return result;
    }

    // If the handler returned nothing (undefined), treat as success with no data.
    if (result === undefined || result === null) {
      return { ok: true, data: null };
    }

    // Any other return value is treated as the data payload.
    return { ok: true, data: result };
  }

  return { dispatch };
}

module.exports = {
  createHub,
  ERROR_KINDS,
  makeUnknownCommand,
  makeInvalidArgs,
  makeHandlerRefusal,
  makeHandlerFailure,
};
