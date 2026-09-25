import { createHash } from 'node:crypto';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Short, stable identifier derived from content (not a security primitive). */
export function shortHash(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}

/** JSON with object keys sorted recursively, so equal values always serialise identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Content hash of a JSON-compatible value (key order does not matter). */
export function hashJson(value: unknown): string {
  return sha256(stableStringify(value));
}

/** Content hash of a text file; line endings are normalised so a CRLF checkout does not look like an edit. */
export function hashText(text: string): string {
  return sha256(text.replace(/\r\n?/g, '\n'));
}
