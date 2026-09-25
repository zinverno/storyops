/** Shared helpers for the editorial layer (Phase 2). */

export interface EditorialIssue {
  severity: 'error' | 'warning';
  /** Which artifact the issue belongs to (author-input, direction, pattern-transfer, voice-plan, story, evidence, style…). */
  artifact: string;
  message: string;
}

/** Marker for decisions the deterministic scaffold leaves to the editor (agent or author). */
export const todo = (what: string) => `TODO(agent): ${what}`;

/** Empty, or still a scaffold TODO. */
export function isUnresolved(value: string | undefined | null): boolean {
  return !value || !value.trim() || /^TODO\b/i.test(value.trim());
}
