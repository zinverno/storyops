import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';

/**
 * Stable Habr characteristics for analysis and platform-fit review. Current
 * activity is NOT encoded here; it comes from research history in the
 * database (`storyops research platform habr`, `storyops trends`).
 */
export const habrStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'habr',
  displayName: 'Habr',
  version: '2.0.0',
  description: 'Russian-language technical community. Long-form engineering articles organised by hubs; readers vote and comment actively.',
  research: {
    liveResearch: 'implemented',
    authorHistory: 'implemented',
    importSupported: true,
    sources: ['Public article listing pages (top lists per period, hub top lists)', 'Public author publication pages', 'Public article pages (abstract features only)'],
    limitations: [
      'Parses public HTML; markup changes will break selectors until platforms/habr/selectors.ts is updated.',
      "Top lists reflect Habr's own ranking; they are a biased sample, not the whole platform.",
      'Metrics such as views are rounded ("12K") on listing pages.',
      'robots.txt is honoured; disallowed pages are skipped, not worked around.',
    ],
  },
  reviewContext: {
    typicalLength: {
      'architecture-deep-dive': { unit: 'words', min: 1500, max: 5000, kind: 'recommendation', note: 'Long-form is normal on Habr.' },
      'engineering-story': { unit: 'words', min: 1200, max: 4000, kind: 'recommendation' },
      postmortem: { unit: 'words', min: 1000, max: 3500, kind: 'recommendation' },
      'product-update': { unit: 'words', min: 500, max: 1500, kind: 'recommendation' },
    },
    sections: 'usual',
    code: 'common',
    images: { min: 0, max: 15 },
    genericIntro: 'discouraged',
    marketingTolerance: 'none',
    conventions: [
      { kind: 'constraint', text: 'Promotional content in personal (non-corporate) publications is against Habr rules.', source: 'Habr site rules — re-check the current wording on habr.com before relying on specifics' },
      { kind: 'recommendation', text: 'Readers expect concrete engineering detail and stated limitations; generic introductions are commonly criticised in comments.' },
      { kind: 'recommendation', text: 'Long articles usually use H2/H3 sections and a cut ("Читать далее") after the introduction.', source: 'Habr editor feature' },
    ],
  },
  formatting: {
    format: 'markdown',
    constraints: [{ kind: 'recommendation', text: 'The Habr editor accepts pasted Markdown; code blocks, tables and images need a check after pasting.' }],
  },
  metadata: {
    required: ['title', 'hubs', 'tags'],
    optional: ['cover image', 'series / previous article link', 'repository link', 'publication type (article/news/post)'],
  },
};
