import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';
import { ARCHITECTURE_DEEP_DIVE, ENGINEERING_STORY, POSTMORTEM, SECTION, SHORT_UPDATE } from '../structures.js';

/** Minimal-opinion fallback for personal sites and unknown destinations. */
export const genericBlogStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'generic-blog',
  displayName: 'Generic technical blog',
  version: '1.0.0',
  description: 'Fallback for a personal technical blog or an unknown destination. Few assumptions beyond good technical writing.',
  content: {
    preferredDepth: 'standard',
    technicalDetail: 'moderate',
    expectedLength: {
      'engineering-story': { unit: 'words', min: 600, max: 4000, kind: 'recommendation' },
    },
    supportedPublicationTypes: ['engineering-story', 'architecture-deep-dive', 'postmortem', 'experiment', 'tutorial', 'release-retrospective', 'migration-story', 'refactor-story', 'product-update', 'technical-announcement', 'short-project-update'],
    defaultPublicationType: 'engineering-story',
    rules: [],
  },
  opening: { preferred: 'Start with the concrete subject.', genericIntroPolicy: 'discouraged', previousPublicationCallback: 'recommended', rules: [] },
  headline: { preferredPatterns: ['Descriptive'], avoidPatterns: ['Clickbait'], rules: [] },
  structure: { sections: 'recommended', paragraphDensity: 'medium', lists: 'As needed.', code: 'when-useful', rules: [] },
  media: { screenshots: 'when-useful', diagrams: 'when-useful', imageCount: { min: 0, max: 20 }, rules: [] },
  links: { policy: 'Link to sources and the repository.', rules: [] },
  tone: { formality: 'neutral', marketingTolerance: 'low', adjustments: ['Author voice as configured'], rules: [] },
  formatting: { format: 'markdown', constraints: [] },
  research: { liveResearch: 'not-applicable', authorHistory: 'manual-import', sources: [], limitations: ['A personal blog has no platform-wide trend data.'] },
  metadata: { required: ['title'], optional: ['date', 'tags', 'canonical URL'] },
  structures: {
    'engineering-story': ENGINEERING_STORY,
    'architecture-deep-dive': ARCHITECTURE_DEEP_DIVE,
    postmortem: POSTMORTEM,
    'short-project-update': SHORT_UPDATE,
    'product-update': [SECTION.callback, SECTION.whatChanged, SECTION.next],
  },
};
