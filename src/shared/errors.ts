/**
 * Error type used across the toolkit. `hint` is an actionable next step for the
 * user; it is printed by the CLI and must never contain secrets.
 */
export class EditorialError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EditorialError';
    this.code = code;
    this.hint = options.hint;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
