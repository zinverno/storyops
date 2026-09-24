import type { PlatformRenderer } from '../schema.js';
import { renderScaffold } from '../../src/platforms/render.js';

/**
 * Telegram-specific draft workspace: no headings (they do not render), and
 * an explicit reminder of the single-message / caption budget.
 */
export const telegramRenderer: PlatformRenderer = {
  render(input) {
    return renderScaffold(input, {
      headings: false,
      extraNotes: [
        'Telegram budget: ≤ 4096 characters for a text message, ≤ 1024 for a caption under an image.',
        'If a screenshot is attached, the whole post must fit into the caption or be sent as a separate message.',
      ],
    });
  },
};
