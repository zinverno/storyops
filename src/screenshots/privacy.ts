import type { Page } from 'playwright';
import { findSecrets, type SecretFinding } from '../shared/redact.js';

/** What the automatic scan inspects. Anything rendered as pixels is NOT inspected. */
export const PRIVACY_SCAN_COVERAGE = 'dom-text-and-form-values';

export interface PrivacyScan {
  findings: SecretFinding[];
  filledPasswordFields: number;
  /**
   * Visible content the scan cannot read because it is rendered as pixels or
   * embedded: <img>/<picture>/<svg><image>, <canvas>, <video>, CSS background
   * images, <iframe>/<embed>/<object>. There is no OCR; these need visual review.
   */
  unscanned: { images: number; canvases: number; videos: number; backgroundImages: number; embedded: number };
}

/**
 * Scans the visible DOM text (excluding masked/hidden regions) and form
 * values for secret-like content. Values are never returned or logged; only
 * pattern ids.
 *
 * Coverage limit: text inside images, canvas, video, CSS background images,
 * iframes and other raster/embedded content is NOT inspected (no OCR). Those
 * elements are counted so the capture can require a visual review.
 */
export async function scanPage(page: Page, excludeSelectors: readonly string[], options: { includeEmails: boolean }): Promise<PrivacyScan> {
  const { text, passwords, unscanned } = await page.evaluate((exclude: string[]) => {
    const excluded = (el: Element | null): boolean => {
      for (let cur = el; cur; cur = cur.parentElement) {
        if (exclude.some((sel) => { try { return cur!.matches(sel); } catch { return false; } })) return true;
      }
      return false;
    };
    const parts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || excluded(parent)) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      parts.push(node.textContent ?? '');
    }
    let passwordCount = 0;
    document.querySelectorAll('input, textarea').forEach((el) => {
      const input = el as HTMLInputElement;
      if (excluded(input)) return;
      if (input.type === 'password' && input.value) passwordCount += 1;
      else if (input.type !== 'hidden' && input.value) parts.push(input.value);
    });
    const visible = (el: Element) => {
      if (excluded(el)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const count = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(visible).length;
    const backgroundImages = Array.from(document.querySelectorAll('body, body *')).filter((el) => /url\(/.test(window.getComputedStyle(el).backgroundImage) && visible(el)).length;
    return {
      text: parts.join('\n'),
      passwords: passwordCount,
      unscanned: { images: count('img, picture, svg image, input[type=image]'), canvases: count('canvas'), videos: count('video'), backgroundImages, embedded: count('iframe, embed, object') },
    };
  }, [...excludeSelectors]);
  return { findings: findSecrets(text, { includeEmails: options.includeEmails }), filledPasswordFields: passwords, unscanned };
}
