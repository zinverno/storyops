import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';

/** Minimal-opinion fallback for personal sites and unknown destinations. */
export const genericBlogStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'generic-blog',
  displayName: 'Generic technical blog',
  version: '2.0.0',
  description: 'Fallback for a personal technical blog or an unknown destination. Few assumptions.',
  research: { liveResearch: 'not-applicable', authorHistory: 'manual-import', importSupported: true, sources: [], limitations: ['A personal blog has no platform-wide activity data.'] },
  reviewContext: {
    typicalLength: { 'engineering-story': { unit: 'words', min: 600, max: 4000, kind: 'recommendation' } },
    sections: 'optional',
    code: 'when-useful',
    images: { min: 0, max: 20 },
    genericIntro: 'neutral',
    marketingTolerance: 'low',
    conventions: [],
  },
  formatting: { format: 'markdown', constraints: [] },
  metadata: { required: ['title'], optional: ['date', 'tags', 'canonical URL'] },
};
