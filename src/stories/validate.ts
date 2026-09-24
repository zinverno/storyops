import type { CanonicalStory } from './schema.js';

export interface StoryIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface StoryValidation {
  readyForDrafting: boolean;
  issues: StoryIssue[];
}

const CORE_FIELDS = ['problem', 'solution'] as const;
const IMPLEMENTED_WORDS = /\b(?:implemented|shipped|released|now supports|done)\b|реализовал|реализован|сделал[аи]?\b|выпустил|внедрил|уже работает|теперь умеет/i;

/**
 * Evidence-first gate. A story is ready for drafting only when its core
 * narrative exists and every verified fact, result and measurement points to
 * evidence. Drafting before that would invert EVIDENCE → STORY → ARTICLE.
 */
export function validateStory(story: CanonicalStory): StoryValidation {
  const issues: StoryIssue[] = [];
  for (const field of CORE_FIELDS) {
    if (!story[field].trim()) issues.push({ severity: 'error', field, message: `"${field}" is empty; the story has no ${field} yet.` });
  }
  for (const claim of story.claims) {
    if (claim.classification === 'verified-fact' && claim.evidence.length === 0) {
      issues.push({ severity: 'error', field: `claims.${claim.id}`, message: `Claim "${claim.text}" is marked verified-fact but has no evidence.` });
    }
    if (claim.classification === 'future-plan' && IMPLEMENTED_WORDS.test(claim.text)) {
      issues.push({ severity: 'error', field: `claims.${claim.id}`, message: `Future plan "${claim.text}" is worded as if it were implemented.` });
    }
    if (claim.classification === 'unverified') issues.push({ severity: 'warning', field: `claims.${claim.id}`, message: `Unverified claim "${claim.text}" must be verified, labelled, or dropped before publishing.` });
  }
  story.measurements.forEach((m, i) => {
    if (m.evidence.length === 0) issues.push({ severity: 'error', field: `measurements.${i}`, message: `Measurement "${m.what}: ${m.value}" has no evidence (benchmark file, runtime output...).` });
    if (!m.method) issues.push({ severity: 'warning', field: `measurements.${i}`, message: `Measurement "${m.what}" does not state how it was measured.` });
  });
  story.results.forEach((r, i) => {
    if (r.evidence.length === 0) issues.push({ severity: 'error', field: `results.${i}`, message: `Result "${r.text}" has no evidence.` });
  });
  story.technicalDecisions.forEach((d, i) => {
    if (d.evidence.length === 0) issues.push({ severity: 'warning', field: `technicalDecisions.${i}`, message: `Decision "${d.decision}" has no evidence reference.` });
  });
  story.failedOrInsufficientApproaches.forEach((a, i) => {
    if (a.evidence.length === 0) issues.push({ severity: 'warning', field: `failedOrInsufficientApproaches.${i}`, message: `Approach "${a.approach}" has no evidence; do not present invented failures.` });
  });
  if (story.pending.length > 0) issues.push({ severity: story.status === 'verified' ? 'error' : 'warning', field: 'pending', message: `Pending fields: ${story.pending.join(', ')}.` });
  if (story.previousState.includes('TODO')) issues.push({ severity: 'warning', field: 'previousState', message: 'previousState still contains a TODO.' });
  if (story.evidence.length === 0 && story.claims.every((c) => c.evidence.length === 0)) issues.push({ severity: 'error', field: 'evidence', message: 'The story references no evidence at all.' });
  return { readyForDrafting: !issues.some((i) => i.severity === 'error'), issues };
}
