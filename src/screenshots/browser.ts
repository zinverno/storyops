import path from 'node:path';
import { readdirSync } from 'node:fs';
import { pathExists } from '../shared/fs.js';

/**
 * Resolves a Chromium executable:
 * 1. explicit path (plan/config) or EDITORIAL_CHROMIUM_PATH,
 * 2. Playwright's own bundled browser when installed,
 * 3. any chromium build in PLAYWRIGHT_BROWSERS_PATH (useful when a preinstalled
 *    browser revision differs from the one this Playwright version expects).
 * Returns undefined to let Playwright report its own actionable error.
 */
export async function resolveChromiumExecutable(explicit?: string): Promise<string | undefined> {
  const candidate = explicit ?? process.env.EDITORIAL_CHROMIUM_PATH;
  if (candidate) return candidate;
  try {
    const { chromium } = await import('playwright');
    const bundled = chromium.executablePath();
    if (bundled && pathExists(bundled)) return undefined; // Playwright will find it itself
  } catch {
    // playwright not importable; handled by the caller
  }
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath && pathExists(browsersPath)) {
    const dirs = readdirSync(browsersPath).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const full = path.join(browsersPath, dir, rel);
        if (pathExists(full)) return full;
      }
    }
  }
  return undefined;
}
