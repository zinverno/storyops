import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveChromiumExecutable } from '../src/screenshots/browser.js';
import { captureScreenshots } from '../src/screenshots/capture.js';
import { planFromStory, renderPlanMarkdown } from '../src/screenshots/plan.js';
import { imageManifestSchema, screenshotPlanSchema, type ScreenshotPlan } from '../src/screenshots/schema.js';
import { canonicalStorySchema } from '../src/stories/schema.js';
import { silentLogger } from '../src/shared/logger.js';
import { clock, FIXTURES, ROOT, tempDir } from './helpers.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function browserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const exe = (await resolveChromiumExecutable()) ?? chromium.executablePath();
    const { existsSync } = await import('node:fs');
    return existsSync(exe);
  } catch {
    return false;
  }
}

const hasBrowser = await browserAvailable();
if (!hasBrowser) console.warn('screenshots.test.ts: no Chromium found; Playwright capture tests are SKIPPED. Run `npx playwright install chromium`.');

describe('screenshot planning', () => {
  it('derives a plan with narrative purpose from the story', async () => {
    const story = canonicalStorySchema.parse(JSON.parse(await readFile(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
    story.possibleVisuals.push({ id: 'health-dashboard', kind: 'screenshot', description: 'Health overview', purpose: 'Show the entry point', supports: 'design', target: '/' });
    const plan = planFromStory(story, 'http://localhost:4000');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ name: 'health-dashboard', path: '/', screenshot: '01-health-dashboard.png', purpose: 'Show the entry point' });
    expect(renderPlanMarkdown(plan)).toMatch(/Purpose:\nShow the entry point/);
  });

  it('validates the example plan and rejects unsafe file names', async () => {
    const example = JSON.parse(await readFile(path.join(ROOT, 'examples/screenshot-plan.example.json'), 'utf8'));
    expect(screenshotPlanSchema.safeParse(example).success).toBe(true);
    const bad = { ...example, steps: [{ name: 'x', screenshot: '../escape.png' }] };
    expect(screenshotPlanSchema.safeParse(bad).success).toBe(false);
  });
});

describe.skipIf(!hasBrowser)('Playwright capture (local fixture app)', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmp: Awaited<ReturnType<typeof tempDir>>;

  beforeAll(async () => {
    tmp = await tempDir();
    const appDir = path.join(FIXTURES, 'screenshots/app');
    server = http.createServer(async (req, res) => {
      const file = path.join(appDir, path.basename(req.url === '/' ? 'index.html' : (req.url ?? '').split('?')[0]!));
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await tmp.cleanup();
  });

  const plan = (steps: unknown[]): ScreenshotPlan =>
    screenshotPlanSchema.parse({ baseUrl, viewport: { width: 1024, height: 700 }, privacy: { hide: ['#debug-panel'] }, steps });

  const capture = (p: ScreenshotPlan, extra: { replace?: boolean } = {}) =>
    captureScreenshots({
      plan: p,
      planDir: tmp.dir,
      originalsDir: path.join(tmp.dir, 'images/originals'),
      manifestFile: path.join(tmp.dir, 'images/manifest.json'),
      defaults: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 },
      clock,
      logger: silentLogger,
      ...extra,
    });

  it('launches, navigates, waits for the ready state, captures and stores the original', async () => {
    const result = await capture(
      plan([
        { name: 'dashboard', path: '/', waitFor: '[data-ready=true]', screenshot: '01-dashboard.png', mask: ['.user-email'], purpose: 'entry point', supports: 'overview' },
        { name: 'finding', path: '/finding.html', actions: [{ type: 'click', selector: '#ack' }], waitFor: '[data-loaded=true]', clip: '#finding', screenshot: '02-finding.png' },
      ]),
    );
    expect(result.failed).toEqual([]);
    expect(result.captured.map((c) => c.step)).toEqual(['dashboard', 'finding']);
    const png = await readFile(path.join(tmp.dir, 'images/originals/01-dashboard.png'));
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(1024); // IHDR width = viewport width
    const clipped = await readFile(path.join(tmp.dir, 'images/originals/02-finding.png'));
    expect(clipped.readUInt32BE(16)).toBeLessThan(1024);
    const manifest = imageManifestSchema.parse(JSON.parse(await readFile(path.join(tmp.dir, 'images/manifest.json'), 'utf8')));
    expect(manifest.images[0]).toMatchObject({ file: '01-dashboard.png', step: 'dashboard', purpose: 'entry point', location: '/', masked: ['.user-email'], hidden: ['#debug-panel'] });
  });

  it('never overwrites originals; --replace archives the previous file', async () => {
    const p = plan([{ name: 'dashboard', path: '/', waitFor: '[data-ready=true]', screenshot: '01-dashboard.png', mask: ['.user-email'] }]);
    const skipped = await capture(p);
    expect(skipped.skipped[0]?.reason).toMatch(/never overwritten/);
    const replaced = await capture(p, { replace: true });
    expect(replaced.captured).toHaveLength(1);
    const history = await readdir(path.join(tmp.dir, 'images/originals/.history'));
    expect(history.some((f) => f.endsWith('01-dashboard.png'))).toBe(true);
  });

  it('blocks captures that expose secrets or unmasked emails', async () => {
    const result = await capture(
      plan([
        { name: 'secret', path: '/secret.html', waitFor: '#token', screenshot: '03-secret.png' },
        { name: 'email', path: '/', waitFor: '[data-ready=true]', screenshot: '04-email.png' },
      ]),
    );
    expect(result.captured).toEqual([]);
    expect(result.failed.map((f) => f.step)).toEqual(['secret', 'email']);
    expect(result.failed[0]!.reason).toMatch(/Privacy check failed: visible assignment/);
    expect(result.failed[1]!.reason).toMatch(/email/);
    expect(result.failed[0]!.reason).not.toContain('FIXTURE-not-a-real-key');
  });

  it('reports a clear failure when the ready state never appears', async () => {
    const result = await captureScreenshots({
      plan: plan([{ name: 'never', path: '/', waitFor: '#does-not-exist', screenshot: '05-never.png' }]),
      planDir: tmp.dir,
      originalsDir: path.join(tmp.dir, 'images/originals'),
      manifestFile: path.join(tmp.dir, 'images/manifest.json'),
      defaults: { viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 },
      clock,
      logger: silentLogger,
      stepTimeoutMs: 1500,
    });
    expect(result.failed[0]?.step).toBe('never');
  });
});
