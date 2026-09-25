import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';

export const mediumStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'medium',
  displayName: 'Medium',
  version: '2.0.0',
  description: 'General long-form publishing platform with a broad technical audience.',
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    importSupported: true,
    sources: [],
    limitations: [
      'Live research is not implemented: public tag feeds do not expose engagement metrics, so activity cannot be estimated honestly.',
      'Platform datasets can be imported (`storyops research import`); author history via `storyops author import`.',
    ],
  },
  reviewContext: {
    typicalLength: {
      'engineering-story': { unit: 'words', min: 1000, max: 3000, kind: 'recommendation' },
      'architecture-deep-dive': { unit: 'words', min: 1500, max: 3500, kind: 'recommendation' },
    },
    sections: 'usual',
    code: 'when-useful',
    images: { min: 1, max: 8 },
    genericIntro: 'discouraged',
    marketingTolerance: 'low',
    conventions: [
      { kind: 'recommendation', text: 'Readers may not know the project or its ecosystem; project terms without definitions are a common clarity problem.' },
      { kind: 'recommendation', text: 'Long code listings are usually linked rather than inlined.' },
    ],
  },
  formatting: {
    format: 'markdown',
    constraints: [
      { kind: 'recommendation', text: "Medium's editor does not render Markdown tables." },
      { kind: 'recommendation', text: 'Tags/topics are limited in number (historically up to 5); verify in the editor.', source: 'Medium editor behaviour — verify current limit' },
    ],
  },
  metadata: { required: ['title', 'subtitle'], optional: ['topics/tags', 'canonical URL (when cross-posting)', 'cover image'] },
};
