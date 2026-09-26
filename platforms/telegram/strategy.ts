import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';

export const telegramStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'telegram',
  displayName: 'Telegram channel',
  version: '2.0.0',
  description: "Author's own channel: informal development updates, technical mini-posts and occasional longer posts.",
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    importSupported: true,
    sources: [],
    limitations: ['No live research: channel discovery and engagement data are not reliably public.', 'Import your own channel posts manually (`storyops author import`).'],
  },
  reviewContext: {
    typicalLength: {
      'short-project-update': { unit: 'characters', min: 200, max: 1000, kind: 'recommendation', note: 'Fits in a media caption.' },
      'technical-mini-post': { unit: 'characters', min: 600, max: 2500, kind: 'recommendation' },
      'channel-longread': { unit: 'characters', min: 2000, max: 4000, kind: 'recommendation', note: 'Near the single-message limit.' },
    },
    sections: 'not-rendered',
    code: 'rare',
    images: { min: 0, max: 3 },
    genericIntro: 'neutral',
    marketingTolerance: 'low',
    conventions: [],
  },
  formatting: {
    format: 'telegram-markdown',
    constraints: [
      { kind: 'constraint', text: 'A text message is limited to 4096 characters.', source: 'Telegram Bot API, sendMessage `text` (1–4096 characters)' },
      { kind: 'constraint', text: 'A media caption is limited to 1024 characters (Premium clients may allow more).', source: 'Telegram Bot API, `caption` (0–1024 characters)' },
      { kind: 'recommendation', text: 'Only basic formatting (bold, italic, code, links) renders; no headings or tables.' },
    ],
  },
  metadata: { required: ['post text'], optional: ['images', 'link'] },
};
