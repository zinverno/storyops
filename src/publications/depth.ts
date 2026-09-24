import type { PublicationDepth } from './schema.js';

/**
 * Heuristic depth estimate from structure. Thresholds are documented so they
 * can be overridden per publication (frontmatter `depth:`):
 *   deep     >= 1200 words, or >= 700 words with >= 3 sections
 *   brief    < 120 words, or < 250 words without sections (fewer than 2 headings)
 *   standard otherwise
 */
export function estimateDepth(input: { words: number; headings: number; codeBlocks: number }): PublicationDepth {
  if (input.words >= 1200 || (input.words >= 700 && input.headings >= 3)) return 'deep';
  if (input.words < 120 || (input.words < 250 && input.headings < 2)) return 'brief';
  return 'standard';
}
