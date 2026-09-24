import { PLATFORM_STRATEGY_SCHEMA_VERSION, type PlatformStrategy } from '../schema.js';
import { SECTION } from '../structures.js';

export const linkedinStrategy: PlatformStrategy = {
  schemaVersion: PLATFORM_STRATEGY_SCHEMA_VERSION,
  id: 'linkedin',
  displayName: 'LinkedIn',
  version: '1.0.0',
  description: 'Professional network feed. Short posts where the first lines decide whether the rest is read.',
  content: {
    preferredDepth: 'brief',
    technicalDetail: 'selective',
    expectedLength: {
      'engineering-story': { unit: 'characters', min: 600, max: 2000, kind: 'recommendation', note: 'Room to spare below the hard post limit.' },
      'product-update': { unit: 'characters', min: 300, max: 1300, kind: 'recommendation' },
      'short-project-update': { unit: 'characters', min: 200, max: 1000, kind: 'recommendation' },
    },
    supportedPublicationTypes: ['engineering-story', 'product-update', 'short-project-update', 'technical-announcement', 'release-retrospective'],
    defaultPublicationType: 'engineering-story',
    rules: [
      { kind: 'recommendation', text: 'One clear engineering insight per post.' },
      { kind: 'recommendation', text: 'Select technical detail: one or two specifics that make the insight credible.' },
      { kind: 'recommendation', text: 'No motivational influencer copy, no "agree?" bait, no invented lessons.' },
    ],
  },
  opening: {
    preferred: 'The first one or two lines state the concrete change or insight; they are all that is visible before "see more".',
    genericIntroPolicy: 'forbidden',
    previousPublicationCallback: 'optional',
    rules: [{ kind: 'recommendation', text: 'Feed previews truncate after roughly two to three lines; put the substance there.', source: 'Observed client behaviour; varies by device' }],
  },
  headline: {
    preferredPatterns: ['First line as headline: concrete, plain statement'],
    avoidPatterns: ['"I\'m excited to announce…"', 'One-word hooks', 'Engagement bait questions'],
    rules: [],
  },
  structure: {
    sections: 'none',
    paragraphDensity: 'short',
    lists: 'Short lists are fine for up to three concrete lessons.',
    code: 'avoid',
    rules: [{ kind: 'recommendation', text: 'Short paragraphs of one to three sentences.' }],
  },
  media: {
    screenshots: 'limited',
    diagrams: 'limited',
    imageCount: { min: 0, max: 1 },
    aspect: 'Single image; square or 4:5 portrait crops occupy more of the feed than wide screenshots.',
    rules: [{ kind: 'recommendation', text: 'One visual that carries the insight; derive it from the canonical screenshot, never alter the original.' }],
  },
  links: {
    policy: 'Link to the full article or repository once, typically at the end.',
    rules: [],
  },
  tone: {
    formality: 'professional',
    marketingTolerance: 'low',
    adjustments: ['Professional but human', 'First person is fine', 'Same author voice as elsewhere'],
    rules: [],
  },
  formatting: {
    format: 'plain-text',
    constraints: [
      { kind: 'constraint', text: 'Feed posts are limited to 3,000 characters.', source: 'LinkedIn help centre — verify the current limit' },
      { kind: 'constraint', text: 'No Markdown rendering in posts: headings, bold and code fences appear as raw characters.', source: 'LinkedIn post editor' },
    ],
  },
  research: {
    liveResearch: 'unsupported',
    authorHistory: 'manual-import',
    sources: [],
    limitations: ['Feed content requires authentication; the toolkit does not scrape LinkedIn.', 'Import your own posts manually for continuity.'],
  },
  metadata: { required: ['post text'], optional: ['single image', 'link to full article'] },
  structures: {
    'engineering-story': [SECTION.coreInsight, SECTION.previousState, SECTION.whatChanged, SECTION.lessons, SECTION.visual],
    'product-update': [SECTION.whatChanged, SECTION.visual, SECTION.next],
    'short-project-update': [SECTION.whatChanged, SECTION.next],
  },
};
