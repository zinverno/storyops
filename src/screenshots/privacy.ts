import type { Page } from 'playwright';
import { findSecrets, type SecretFinding } from '../shared/redact.js';

export interface PrivacyScan {
  findings: SecretFinding[];
  filledPasswordFields: number;
}

/**
 * Scans the visible page text (excluding masked/hidden regions) and form
 * values for secret-like content. Values are never returned or logged; only
 * pattern ids.
 */
export async function scanPage(page: Page, excludeSelectors: readonly string[], options: { includeEmails: boolean }): Promise<PrivacyScan> {
  const { text, passwords } = await page.evaluate((exclude: string[]) => {
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
    return { text: parts.join('\n'), passwords: passwordCount };
  }, [...excludeSelectors]);
  return { findings: findSecrets(text, { includeEmails: options.includeEmails }), filledPasswordFields: passwords };
}
