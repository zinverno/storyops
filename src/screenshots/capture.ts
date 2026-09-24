import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rename } from 'node:fs/promises';
import type { Browser, BrowserContext, ElectronApplication, Page } from 'playwright';
import type { Clock } from '../shared/clock.js';
import { EditorialError, errorMessage } from '../shared/errors.js';
import { ensureDir, pathExists, readJsonIfExists, writeJson } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import type { Logger } from '../shared/logger.js';
import { redactSecrets, sanitizeUrl } from '../shared/redact.js';
import { resolveChromiumExecutable } from './browser.js';
import { scanPage } from './privacy.js';
import { imageManifestSchema, type ImageManifest, type ScreenshotPlan, type ScreenshotStep } from './schema.js';

export interface CaptureOptions {
  plan: ScreenshotPlan;
  planDir: string;
  originalsDir: string;
  manifestFile: string;
  defaults: { viewport: { width: number; height: number }; deviceScaleFactor: number; executablePath?: string };
  clock: Clock;
  logger: Logger;
  /** Replace existing originals (the previous file is moved to originals/.history/). */
  replace?: boolean;
  only?: string[];
  stepTimeoutMs?: number;
}

export interface CaptureResult {
  captured: Array<{ step: string; file: string }>;
  skipped: Array<{ step: string; reason: string }>;
  failed: Array<{ step: string; reason: string }>;
}

/** A capture target abstracts "where pages come from": a browser or an Electron app. */
interface CaptureTarget {
  kind: 'web' | 'electron';
  page(): Promise<Page>;
  version(): string | undefined;
  close(): Promise<void>;
}

async function webTarget(plan: ScreenshotPlan, options: CaptureOptions): Promise<CaptureTarget> {
  const { chromium } = await import('playwright');
  const executablePath = await resolveChromiumExecutable(options.defaults.executablePath);
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  } catch (error) {
    throw new EditorialError('BROWSER_LAUNCH', `Could not launch Chromium: ${errorMessage(error).split('\n')[0]}`, {
      hint: 'Run `npx playwright install chromium`, or set EDITORIAL_CHROMIUM_PATH / screenshots.browserExecutablePath to an installed Chromium.',
    });
  }
  const context: BrowserContext = await browser.newContext({
    viewport: plan.viewport ?? options.defaults.viewport,
    deviceScaleFactor: plan.deviceScaleFactor ?? options.defaults.deviceScaleFactor,
    reducedMotion: 'reduce',
    ...(plan.colorScheme ? { colorScheme: plan.colorScheme } : {}),
    ...(plan.locale ? { locale: plan.locale } : {}),
  });
  const page = await context.newPage();
  return { kind: 'web', page: async () => page, version: () => browser.version(), close: async () => browser.close() };
}

/**
 * EXPERIMENTAL and untested in this repository's CI: Playwright's Electron
 * support. Kept behind the same interface so web capture is unaffected.
 */
async function electronTarget(plan: Extract<ScreenshotPlan['target'], { kind: 'electron' }>, planDir: string): Promise<CaptureTarget> {
  const { _electron } = await import('playwright');
  let app: ElectronApplication;
  try {
    app = await _electron.launch({ args: plan.args, ...(plan.executablePath ? { executablePath: path.resolve(planDir, plan.executablePath) } : {}), ...(plan.cwd ? { cwd: path.resolve(planDir, plan.cwd) } : {}) });
  } catch (error) {
    throw new EditorialError('ELECTRON_LAUNCH', `Could not launch Electron app: ${errorMessage(error).split('\n')[0]}`, { hint: 'Electron capture is experimental; check executablePath/args in the plan.' });
  }
  const page = await app.firstWindow();
  return { kind: 'electron', page: async () => page, version: () => undefined, close: async () => app.close() };
}

/**
 * Human-readable description of a launch command for logs. Arguments and
 * environment values may carry tokens, so only the executable name and the
 * number of arguments/env variables are shown, never their values.
 */
export function describeLaunch(launch: Pick<NonNullable<ScreenshotPlan['launch']>, 'command' | 'args' | 'env'>): string {
  const executable = redactSecrets(path.basename(launch.command.trim().split(/\s+/)[0] ?? launch.command));
  const envCount = Object.keys(launch.env ?? {}).length;
  return `${executable} (${launch.args.length} argument${launch.args.length === 1 ? '' : 's'} hidden${envCount ? `, ${envCount} env variable${envCount === 1 ? '' : 's'} hidden` : ''})`;
}

async function startApp(launch: NonNullable<ScreenshotPlan['launch']>, planDir: string, logger: Logger): Promise<ChildProcess> {
  logger.info(`Starting application: ${describeLaunch(launch)}`);
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd ? path.resolve(planDir, launch.cwd) : planDir,
    env: { ...process.env, ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  // Child output is drained and discarded: it may contain secrets and is never logged.
  child.stdout?.resume();
  child.stderr?.resume();
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = () => (spawnError ? new EditorialError('APP_LAUNCH', `Could not start ${describeLaunch(launch)}: ${(spawnError as NodeJS.ErrnoException).code ?? 'spawn error'}`) : undefined);
  const early = failed();
  if (early) throw early;
  if (launch.readyUrl) {
    const deadline = Date.now() + launch.readyTimeoutMs;
    for (;;) {
      const launchError = failed();
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new EditorialError('APP_EXITED', `Application exited with code ${child.exitCode} before becoming ready`);
      try {
        const res = await fetch(launch.readyUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      if (Date.now() > deadline) {
        stopApp(child);
        throw new EditorialError('APP_NOT_READY', `Application did not become ready at ${sanitizeUrl(launch.readyUrl)} within ${launch.readyTimeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    logger.info('Application is ready.');
  }
  return child;
}

function stopApp(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function runStep(page: Page, plan: ScreenshotPlan, step: ScreenshotStep, timeout: number): Promise<void> {
  if (plan.target.kind === 'web') {
    if (!plan.baseUrl) throw new EditorialError('PLAN_BASE_URL', 'Web screenshot plans need a baseUrl');
    const url = new URL(step.path ?? '/', plan.baseUrl).toString();
    await page.goto(url, { waitUntil: step.waitForNetworkIdle ? 'networkidle' : 'load', timeout });
  }
  for (const action of step.actions) {
    switch (action.type) {
      case 'click':
        await page.locator(action.selector).first().click({ timeout });
        break;
      case 'fill':
        await page.locator(action.selector).first().fill(action.value, { timeout });
        break;
      case 'press':
        if (action.selector) await page.locator(action.selector).first().press(action.key, { timeout });
        else await page.keyboard.press(action.key);
        break;
      case 'hover':
        await page.locator(action.selector).first().hover({ timeout });
        break;
      case 'scroll':
        await page.locator(action.selector).first().scrollIntoViewIfNeeded({ timeout });
        break;
      case 'waitForSelector':
        await page.locator(action.selector).first().waitFor({ state: 'visible', timeout });
        break;
      case 'wait':
        await page.waitForTimeout(action.ms);
        break;
    }
  }
  if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ state: 'visible', timeout });
  if (step.waitForText) await page.getByText(step.waitForText).first().waitFor({ state: 'visible', timeout });
  // Move the pointer out of the way so it never covers UI (headless has no drawn cursor; this also clears hover states).
  await page.mouse.move(0, 0);
}

export async function captureScreenshots(options: CaptureOptions): Promise<CaptureResult> {
  const { plan, logger } = options;
  const result: CaptureResult = { captured: [], skipped: [], failed: [] };
  const manifest: ImageManifest = (await readJsonIfExists(options.manifestFile, imageManifestSchema)) ?? { schemaVersion: 1, images: [] };
  await ensureDir(options.originalsDir);
  const steps = plan.steps.filter((s) => !options.only || options.only.includes(s.name));
  const timeout = options.stepTimeoutMs ?? 30_000;

  let app: ChildProcess | undefined;
  let target: CaptureTarget | undefined;
  try {
    if (plan.launch) app = await startApp(plan.launch, options.planDir, logger);
    target = plan.target.kind === 'electron' ? await electronTarget(plan.target, options.planDir) : await webTarget(plan, options);
    const page = await target.page();
    const viewport = page.viewportSize() ?? plan.viewport ?? options.defaults.viewport;

    for (const step of steps) {
      const outFile = path.join(options.originalsDir, step.screenshot);
      if (pathExists(outFile) && !options.replace) {
        result.skipped.push({ step: step.name, reason: `${step.screenshot} already exists (canonical originals are never overwritten; pass --replace to archive and recapture)` });
        continue;
      }
      try {
        logger.info(`Capturing ${step.name} → ${step.screenshot}`);
        await runStep(page, plan, step, timeout);
        const hidden = [...plan.privacy.hide, ...step.hide];
        const masked = [...plan.privacy.mask, ...step.mask];
        if (hidden.length) await page.addStyleTag({ content: `${hidden.join(', ')} { visibility: hidden !important; }` });
        if (plan.privacy.blockOnSecrets) {
          const scan = await scanPage(page, [...hidden, ...masked], { includeEmails: !plan.privacy.allowEmails });
          if (scan.findings.length > 0 || scan.filledPasswordFields > 0) {
            const kinds = [...new Set(scan.findings.map((f) => f.patternId))];
            if (scan.filledPasswordFields) kinds.push('filled-password-field');
            throw new EditorialError('PRIVACY_BLOCKED', `Privacy check failed: visible ${kinds.join(', ')}. Mask or hide the region (privacy.mask / step.mask) or use demo data.`);
          }
        }
        const tmp = `${outFile}.tmp-${process.pid}.png`;
        const maskLocators = masked.map((sel) => page.locator(sel));
        const shotOptions = { path: tmp, animations: 'disabled' as const, caret: 'hide' as const, mask: maskLocators, scale: 'device' as const };
        if (step.clip) await page.locator(step.clip).first().screenshot(shotOptions);
        else await page.screenshot({ ...shotOptions, fullPage: step.fullPage });
        if (pathExists(outFile)) {
          const historyDir = path.join(options.originalsDir, '.history');
          await ensureDir(historyDir);
          await rename(outFile, path.join(historyDir, `${options.clock.now().toISOString().replace(/[:.]/g, '-')}-${step.screenshot}`));
        }
        await rename(tmp, outFile);
        const bytes = await readFile(outFile);
        manifest.images = manifest.images.filter((i) => i.file !== step.screenshot);
        const entry: ImageManifest['images'][number] = {
          file: step.screenshot,
          step: step.name,
          target: target.kind,
          viewport,
          deviceScaleFactor: plan.deviceScaleFactor ?? options.defaults.deviceScaleFactor,
          capturedAt: options.clock.now().toISOString(),
          sha256: sha256(bytes),
          bytes: bytes.length,
          masked,
          hidden,
        };
        if (plan.target.kind === 'web') entry.location = new URL(page.url()).pathname;
        if (step.purpose) entry.purpose = step.purpose;
        if (step.supports) entry.supports = step.supports;
        const version = target.version();
        if (version) entry.browser = `chromium ${version}`;
        manifest.images.push(entry);
        result.captured.push({ step: step.name, file: outFile });
      } catch (error) {
        const reason = errorMessage(error).split('\n')[0]!;
        logger.warn(`Step ${step.name} failed: ${reason}`);
        result.failed.push({ step: step.name, reason });
      }
    }
  } finally {
    await target?.close().catch(() => undefined);
    if (app) stopApp(app);
    manifest.images.sort((a, b) => a.file.localeCompare(b.file));
    if (manifest.images.length) await writeJson(options.manifestFile, manifest);
  }
  return result;
}
