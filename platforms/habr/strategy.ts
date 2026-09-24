import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';
import { ARCHITECTURE_DEEP_DIVE, ENGINEERING_STORY, POSTMORTEM, SECTION } from '../structures.js';

/**
 * Stable Habr characteristics. Current trend observations are NOT encoded
 * here; they come from dated research snapshots (`editorial-kit research
 * --platform habr`) and are applied as advisory packaging notes in briefs.
 */
export const habrStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'habr',
  displayName: 'Habr',
  version: '1.0.0',
  description: 'Russian-language technical community. Long-form engineering articles organised by hubs; readers vote and comment actively.',
  content: {
    preferredDepth: 'deep',
    technicalDetail: 'high',
    expectedLength: {
      'architecture-deep-dive': { unit: 'words', min: 1500, max: 5000, kind: 'recommendation', note: 'Long-form is normal; length must be earned by substance.' },
      'engineering-story': { unit: 'words', min: 1200, max: 4000, kind: 'recommendation' },
      postmortem: { unit: 'words', min: 1000, max: 3500, kind: 'recommendation' },
      'product-update': { unit: 'words', min: 500, max: 1500, kind: 'recommendation' },
    },
    supportedPublicationTypes: ['engineering-story', 'architecture-deep-dive', 'postmortem', 'experiment', 'tutorial', 'release-retrospective', 'migration-story', 'refactor-story', 'product-update', 'technical-announcement'],
    defaultPublicationType: 'engineering-story',
    rules: [
      { kind: 'recommendation', text: 'Explain architecture through the concrete engineering problem it solves.' },
      { kind: 'recommendation', text: 'Show real code, tests or output where it proves a point; do not paste code for volume.' },
      { kind: 'recommendation', text: 'State limitations and trade-offs explicitly; Habr readers will find them in the comments anyway.' },
    ],
  },
  opening: {
    preferred: 'Start from the concrete technical situation. For a series, start from what changed since the previous article and link to it.',
    genericIntroPolicy: 'forbidden',
    previousPublicationCallback: 'required-for-series',
    rules: [
      { kind: 'recommendation', text: 'Do not retell the project origin if a previous article already did; link to it in one sentence.' },
      { kind: 'recommendation', text: 'Avoid "В современном мире…" style introductions.' },
    ],
  },
  headline: {
    preferredPatterns: ['Concrete subject + concrete change or problem', 'Question only when the article actually answers it'],
    avoidPatterns: ['Clickbait without substance', 'Superlatives ("лучший", "революционный")', 'Titles that promise results the article does not show'],
    rules: [{ kind: 'recommendation', text: 'The title should let a practitioner predict what they will learn.' }],
  },
  structure: {
    sections: 'required',
    paragraphDensity: 'medium',
    lists: 'Use lists for genuinely enumerable items; keep reasoning in prose.',
    code: 'encouraged',
    rules: [
      { kind: 'recommendation', text: 'Use H2/H3 sections so the article can be scanned.' },
      { kind: 'recommendation', text: 'Use a cut (the "Читать далее" break) after the introduction on long articles.', source: 'Habr editor feature' },
    ],
  },
  media: {
    screenshots: 'encouraged',
    diagrams: 'encouraged',
    imageCount: { min: 0, max: 15 },
    aspect: 'Full-width screenshots are fine; crop to the relevant UI area.',
    rules: [{ kind: 'recommendation', text: 'Every image must support a specific section; caption what the reader should notice.' }],
  },
  links: {
    policy: 'Link to the repository, previous articles in the series and primary sources.',
    rules: [{ kind: 'recommendation', text: 'Avoid link dumps; link where the reader needs the source.' }],
  },
  tone: {
    formality: 'conversational',
    marketingTolerance: 'none',
    adjustments: ['Developer talking to developers', 'Moderate natural humour is fine', 'No press-release language'],
    rules: [
      { kind: 'constraint', text: 'Promotional content in personal (non-corporate) publications is against Habr rules.', source: 'Habr site rules — re-check the current wording on habr.com before relying on specifics' },
      { kind: 'recommendation', text: 'Marketing tone is strongly discouraged even in corporate blogs.' },
    ],
  },
  formatting: {
    format: 'markdown',
    constraints: [
      { kind: 'recommendation', text: 'Draft in Markdown; the Habr editor accepts pasted Markdown but re-check code blocks, tables and images after pasting.' },
    ],
  },
  research: {
    liveResearch: 'implemented',
    authorHistory: 'implemented',
    sources: ['Public article listing pages (top lists per period, hub top lists)', 'Public author publication pages', 'Public article pages'],
    limitations: [
      'Parses public HTML; markup changes will break selectors until platforms/habr/selectors.ts is updated.',
      'Top lists reflect Habr\'s own ranking; they are a biased sample, not the whole platform.',
      'Metrics such as views are rounded ("12K") on listing pages.',
      'robots.txt is honoured; disallowed pages are skipped, not worked around.',
    ],
  },
  metadata: {
    required: ['title', 'hubs', 'tags'],
    optional: ['cover image', 'series / previous article link', 'repository link', 'publication type (article/news/post)'],
  },
  structures: {
    'engineering-story': ENGINEERING_STORY,
    'architecture-deep-dive': ARCHITECTURE_DEEP_DIVE,
    'migration-story': ENGINEERING_STORY,
    'refactor-story': ENGINEERING_STORY,
    postmortem: POSTMORTEM,
    'product-update': [SECTION.callback, SECTION.whatChanged, SECTION.evidence, SECTION.limitations, SECTION.next],
  },
};
