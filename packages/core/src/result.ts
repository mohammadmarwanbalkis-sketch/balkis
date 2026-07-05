/**
 * Explicit success/failure values. Balkis's public execution API never throws;
 * it returns a `Result` so callers (humans and AI agents alike) must handle
 * failure deliberately and can serialize outcomes losslessly.
 */

import type { BalkisError } from "./errors.js";

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = BalkisError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Extract the value from a `Result`, throwing the contained error on failure.
 * A convenience for scripts and tests; production callers should branch on `.ok`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error
    ? result.error
    : new Error(`unwrap() called on an Err result: ${String(result.error)}`);
}
