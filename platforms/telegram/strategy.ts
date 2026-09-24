import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';
import { SECTION, SHORT_UPDATE } from '../structures.js';

export const telegramStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'telegram',
  displayName: 'Telegram channel',
  version: '1.0.0',
  description: 'Author\'s own channel: informal development updates, technical mini-posts and occasional longer posts.',
  content: {
    preferredDepth: 'brief',
    technicalDetail: 'selective',
    expectedLength: {
      'short-project-update': { unit: 'characters', min: 200, max: 1000, kind: 'recommendation', note: 'Fits in a media caption.' },
      'technical-mini-post': { unit: 'characters', min: 600, max: 2500, kind: 'recommendation' },
      'channel-longread': { unit: 'characters', min: 2000, max: 4000, kind: 'recommendation', note: 'Near the single-message limit; split or link out beyond it.' },
    },
    supportedPublicationTypes: ['short-project-update', 'technical-mini-post', 'channel-longread', 'product-update'],
    defaultPublicationType: 'short-project-update',
    rules: [
      { kind: 'recommendation', text: 'Personal development-log voice: what changed, what broke, what is next.' },
      { kind: 'recommendation', text: 'Informal is fine; facts are held to the same standard as a long article.' },
    ],
  },
  opening: {
    preferred: 'Straight to the update: what was done or discovered.',
    genericIntroPolicy: 'forbidden',
    previousPublicationCallback: 'optional',
    rules: [],
  },
  headline: {
    preferredPatterns: ['Optional bold first line summarising the update'],
    avoidPatterns: ['Clickbait', 'Mandatory emoji prefixes'],
    rules: [],
  },
  structure: {
    sections: 'none',
    paragraphDensity: 'short',
    lists: 'Short lists are fine.',
    code: 'sparingly',
    rules: [{ kind: 'recommendation', text: 'Hashtags and emojis are optional; use them only if the channel already does.' }],
  },
  media: {
    screenshots: 'when-useful',
    diagrams: 'optional',
    imageCount: { min: 0, max: 3 },
    aspect: 'Phone-first viewing: crop to the relevant UI area.',
    rules: [],
  },
  links: { policy: 'Link to the full article or commit when it adds value.', rules: [] },
  tone: {
    formality: 'informal',
    marketingTolerance: 'low',
    adjustments: ['More personal and informal than Habr', 'Keep the author\'s vocabulary and humour'],
    rules: [],
  },
  formatting: {
    format: 'telegram-markdown',
    constraints: [
      { kind: 'constraint', text: 'A text message is limited to 4096 characters.', source: 'Telegram Bot API, sendMessage `text` (1–4096 characters)' },
      { kind: 'constraint', text: 'A media caption is limited to 1024 characters (Premium clients may allow more).', source: 'Telegram Bot API, `caption` (0–1024 characters)' },
      { kind: 'recommendation', text: 'Only basic formatting (bold, italic, code, links) renders; no headings or tables.' },
    ],
  },
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    sources: [],
    limitations: ['No live research: channel discovery and engagement data are not reliably public.', 'Import your own channel posts manually for continuity.'],
  },
  metadata: { required: ['post text'], optional: ['images', 'link'] },
  structures: {
    'short-project-update': SHORT_UPDATE,
    'technical-mini-post': [SECTION.hook, SECTION.whatChanged, SECTION.implementation, SECTION.surprise, SECTION.next],
    'channel-longread': [SECTION.hook, SECTION.previousState, SECTION.problem, SECTION.design, SECTION.evidence, SECTION.limitations, SECTION.next],
    'product-update': SHORT_UPDATE,
  },
};
