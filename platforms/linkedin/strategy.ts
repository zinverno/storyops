import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';

export const linkedinStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'linkedin',
  displayName: 'LinkedIn',
  version: '2.0.0',
  description: 'Professional network feed. Short posts where the first lines decide whether the rest is read.',
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    importSupported: true,
    sources: [],
    limitations: ['Feed content requires authentication; StoryOps does not scrape LinkedIn.', 'Import your own posts manually (`storyops author import`); platform datasets via `storyops research import`.'],
  },
  reviewContext: {
    typicalLength: {
      'engineering-story': { unit: 'characters', min: 600, max: 2000, kind: 'recommendation' },
      'product-update': { unit: 'characters', min: 300, max: 1300, kind: 'recommendation' },
      'short-project-update': { unit: 'characters', min: 200, max: 1000, kind: 'recommendation' },
    },
    sections: 'not-rendered',
    code: 'rare',
    images: { min: 0, max: 1 },
    genericIntro: 'discouraged',
    marketingTolerance: 'low',
    conventions: [{ kind: 'recommendation', text: 'Feed previews truncate after roughly two to three lines.', source: 'Observed client behaviour; varies by device' }],
  },
  formatting: {
    format: 'plain-text',
    constraints: [
      { kind: 'constraint', text: 'Feed posts are limited to 3,000 characters.', source: 'LinkedIn help centre — verify the current limit' },
      { kind: 'constraint', text: 'No Markdown rendering in posts: headings, bold and code fences appear as raw characters.', source: 'LinkedIn post editor' },
    ],
  },
  metadata: { required: ['post text'], optional: ['single image', 'link to full article'] },
};
