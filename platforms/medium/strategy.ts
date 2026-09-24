import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';
import { ARCHITECTURE_DEEP_DIVE, ENGINEERING_STORY, SECTION } from '../structures.js';

export const mediumStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'medium',
  displayName: 'Medium',
  version: '1.0.0',
  description: 'General long-form publishing platform with a broad technical audience. Rewards clean narrative flow over dense reference material.',
  content: {
    preferredDepth: 'standard',
    technicalDetail: 'moderate',
    expectedLength: {
      'engineering-story': { unit: 'words', min: 1000, max: 3000, kind: 'recommendation' },
      'architecture-deep-dive': { unit: 'words', min: 1500, max: 3500, kind: 'recommendation' },
    },
    supportedPublicationTypes: ['engineering-story', 'architecture-deep-dive', 'postmortem', 'experiment', 'tutorial', 'migration-story', 'refactor-story', 'release-retrospective'],
    defaultPublicationType: 'engineering-story',
    rules: [
      { kind: 'recommendation', text: 'Provide broader context: readers may not know the project or its ecosystem.' },
      { kind: 'recommendation', text: 'Prefer narrative flow (the engineering journey) over exhaustive reference detail.' },
      { kind: 'recommendation', text: 'Reduce platform- and community-specific jargon; define project terms on first use.' },
    ],
  },
  opening: {
    preferred: 'A concrete scene or problem from the project, then why it matters beyond the project.',
    genericIntroPolicy: 'forbidden',
    previousPublicationCallback: 'optional',
    rules: [{ kind: 'recommendation', text: 'Do not assume readers saw earlier posts on other platforms; give a short self-contained context.' }],
  },
  headline: {
    preferredPatterns: ['Title + explanatory subtitle', 'Concrete outcome or question'],
    avoidPatterns: ['Listicle titles for non-list content', 'Vague inspirational titles'],
    rules: [{ kind: 'recommendation', text: 'Use the subtitle to state what the reader will learn.' }],
  },
  structure: {
    sections: 'recommended',
    paragraphDensity: 'medium',
    lists: 'Sparingly; Medium reads best as prose.',
    code: 'when-useful',
    rules: [{ kind: 'recommendation', text: 'Keep code snippets short; link to the repository for full listings.' }],
  },
  media: {
    screenshots: 'when-useful',
    diagrams: 'encouraged',
    imageCount: { min: 1, max: 8 },
    aspect: 'Wide images read well; avoid tiny UI details.',
    rules: [{ kind: 'recommendation', text: 'A diagram of the architecture change usually beats several screenshots.' }],
  },
  links: { policy: 'Link to repository and primary sources; include a short "further reading" only if useful.', rules: [] },
  tone: {
    formality: 'conversational',
    marketingTolerance: 'low',
    adjustments: ['Slightly more explanatory than Habr', 'Keep the author voice; do not switch to generic "thought leadership" tone'],
    rules: [],
  },
  formatting: {
    format: 'markdown',
    constraints: [
      { kind: 'recommendation', text: 'Medium\'s editor does not render Markdown tables; convert tables to images or lists.' },
      { kind: 'recommendation', text: 'Tags/topics are limited in number (historically up to 5); verify in the editor.', source: 'Medium editor behaviour — verify current limit' },
    ],
  },
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    sources: [],
    limitations: [
      'Live trend research is not implemented: public tag feeds exist but do not expose engagement metrics, so momentum cannot be estimated honestly.',
      'Author history must be imported manually (`editorial-kit author import`).',
    ],
  },
  metadata: { required: ['title', 'subtitle'], optional: ['topics/tags', 'canonical URL (when cross-posting)', 'cover image'] },
  structures: {
    'engineering-story': [SECTION.hook, SECTION.context, ...ENGINEERING_STORY.filter((s) => s.id !== 'callback' && s.id !== 'hook')],
    'architecture-deep-dive': [SECTION.context, ...ARCHITECTURE_DEEP_DIVE.filter((s) => s.id !== 'callback')],
  },
};
