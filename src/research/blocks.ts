import { wordCount } from '../shared/text.js';

/**
 * Platform-neutral representation of an article body, produced by platform
 * parsers. Editorial code (publication indexing, structural pattern
 * extraction) consumes blocks and never sees platform HTML.
 */
export type ContentBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language?: string; lines: number; text?: string }
  | { type: 'image'; src: string; alt?: string; caption?: string }
  | { type: 'embed'; src: string };

export function blocksToPlainText(blocks: readonly ContentBlock[], options: { includeHeadings?: boolean } = {}): string {
  const includeHeadings = options.includeHeadings ?? false;
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return includeHeadings ? b.text : '';
        case 'paragraph':
        case 'quote':
          return b.text;
        case 'list':
          return b.items.map((i) => `- ${i}`).join('\n');
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

export function blockWords(block: ContentBlock): number {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return wordCount(block.text);
    case 'list':
      return block.items.reduce((sum, item) => sum + wordCount(item), 0);
    default:
      return 0;
  }
}
