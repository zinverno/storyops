/**
 * Reusable section patterns. A strategy picks the ones that fit and may
 * override them. `storyFields` name CanonicalStory fields the section draws on,
 * so every section of every platform output traces back to the story.
 */
export interface SectionPattern {
  id: string;
  purpose: string;
  storyFields: string[];
}

export const SECTION = {
  callback: { id: 'callback', purpose: 'Connect to the previous publication: what readers already know, in one or two sentences.', storyFields: ['relationToPreviousPublications', 'previousState'] },
  hook: { id: 'hook', purpose: 'Open with the concrete technical situation or limitation, not with generic context.', storyFields: ['problem', 'turningPoint'] },
  previousState: { id: 'previous-state', purpose: 'How the system worked before, only as much as the new story needs.', storyFields: ['previousState', 'context'] },
  problem: { id: 'problem', purpose: 'The real problem and why it mattered.', storyFields: ['problem', 'constraints'] },
  constraints: { id: 'constraints', purpose: 'Constraints that shaped the solution.', storyFields: ['constraints'] },
  failedApproach: { id: 'failed-approach', purpose: 'What was tried and why it was insufficient (only if evidenced).', storyFields: ['failedOrInsufficientApproaches'] },
  design: { id: 'design', purpose: 'The new design and the key decisions with their reasons.', storyFields: ['solution', 'technicalDecisions'] },
  implementation: { id: 'implementation', purpose: 'Implementation details that a practitioner would want to see (code, structure).', storyFields: ['technicalDecisions', 'evidence'] },
  evidence: { id: 'evidence', purpose: 'Proof: tests, code, screenshots, runtime output.', storyFields: ['evidence', 'possibleVisuals'] },
  measurements: { id: 'measurements', purpose: 'Measurements with method. Omit entirely if none exist.', storyFields: ['measurements'] },
  results: { id: 'results', purpose: 'What changed as a result; only evidenced results.', storyFields: ['results'] },
  limitations: { id: 'limitations', purpose: 'Known limitations and trade-offs.', storyFields: ['limitations'] },
  next: { id: 'next', purpose: 'What comes next and open questions. Plans are labelled as plans.', storyFields: ['openQuestions'] },
  coreInsight: { id: 'core-insight', purpose: 'The single engineering insight worth the reader\'s time.', storyFields: ['turningPoint', 'solution'] },
  whatChanged: { id: 'what-changed', purpose: 'What changed since the last update, concretely.', storyFields: ['solution', 'results'] },
  lessons: { id: 'lessons', purpose: 'Up to three concrete lessons grounded in the story.', storyFields: ['technicalDecisions', 'failedOrInsufficientApproaches', 'limitations'] },
  visual: { id: 'visual', purpose: 'One visual that carries the point.', storyFields: ['possibleVisuals'] },
  surprise: { id: 'surprise', purpose: 'What unexpectedly failed or surprised (only if evidenced).', storyFields: ['failedOrInsufficientApproaches', 'turningPoint'] },
  context: { id: 'context', purpose: 'Broader context for readers who do not know the project.', storyFields: ['context', 'previousState'] },
  timeline: { id: 'timeline', purpose: 'Timeline of the incident or change.', storyFields: ['previousState', 'turningPoint', 'solution'] },
  rootCause: { id: 'root-cause', purpose: 'Root cause, supported by evidence.', storyFields: ['problem', 'evidence'] },
  steps: { id: 'steps', purpose: 'Reproducible steps with code.', storyFields: ['technicalDecisions', 'evidence'] },
} satisfies Record<string, SectionPattern>;

export const ENGINEERING_STORY: SectionPattern[] = [
  SECTION.callback, SECTION.hook, SECTION.previousState, SECTION.problem, SECTION.constraints, SECTION.failedApproach,
  SECTION.design, SECTION.implementation, SECTION.evidence, SECTION.measurements, SECTION.limitations, SECTION.next,
];

export const ARCHITECTURE_DEEP_DIVE: SectionPattern[] = [
  SECTION.callback, SECTION.hook, SECTION.previousState, SECTION.problem, SECTION.design, SECTION.implementation,
  SECTION.evidence, SECTION.limitations, SECTION.next,
];

export const POSTMORTEM: SectionPattern[] = [SECTION.hook, SECTION.timeline, SECTION.rootCause, SECTION.failedApproach, SECTION.design, SECTION.results, SECTION.lessons, SECTION.next];

export const SHORT_UPDATE: SectionPattern[] = [SECTION.whatChanged, SECTION.surprise, SECTION.visual, SECTION.next];
