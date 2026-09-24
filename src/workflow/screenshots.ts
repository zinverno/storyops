import path from 'node:path';
import { captureScreenshots, type CaptureResult } from '../screenshots/capture.js';
import { planFromStory, renderPlanMarkdown } from '../screenshots/plan.js';
import { screenshotPlanSchema, type ScreenshotPlan } from '../screenshots/schema.js';
import { EditorialError } from '../shared/errors.js';
import { readJson, writeJson, writeText } from '../shared/fs.js';
import { loadStory } from '../stories/store.js';
import type { AppContext } from './context.js';

export async function screenshotPlanWorkflow(ctx: AppContext, storyFile: string, baseUrl?: string): Promise<{ plan: ScreenshotPlan; files: { json: string; md: string } }> {
  const story = await loadStory(storyFile);
  const plan = planFromStory(story, baseUrl);
  const dir = path.dirname(storyFile);
  const files = { json: path.join(dir, 'screenshot-plan.json'), md: path.join(dir, 'screenshot-plan.md') };
  await writeJson(files.json, plan);
  await writeText(files.md, renderPlanMarkdown(plan));
  return { plan, files };
}

/**
 * Captures a plan. Originals go to `<article>/images/originals/` when the plan
 * lives inside an article directory, otherwise to `--out`.
 */
export async function screenshotCaptureWorkflow(ctx: AppContext, planFile: string, options: { out?: string; replace?: boolean; only?: string[] } = {}): Promise<CaptureResult & { originalsDir: string }> {
  const plan = await readJson(planFile, screenshotPlanSchema);
  if (plan.steps.some((s) => s.path?.includes('TODO') || s.waitFor?.includes('TODO'))) {
    throw new EditorialError('PLAN_INCOMPLETE', 'The screenshot plan still contains TODO values (path/waitFor).', { hint: 'Fill in the real URL paths and ready-state selectors first.' });
  }
  const planDir = path.dirname(path.resolve(planFile));
  const articleRoot = path.resolve(ctx.workspace.articlesDir);
  const insideArticle = path.relative(articleRoot, planDir) && !path.relative(articleRoot, planDir).startsWith('..');
  const imagesRoot = options.out ? path.resolve(options.out) : insideArticle ? path.join(planDir, 'images') : path.resolve(ctx.workspace.root, ctx.config.screenshots.outputDir);
  const originalsDir = path.join(imagesRoot, 'originals');
  const result = await captureScreenshots({
    plan,
    planDir,
    originalsDir,
    manifestFile: path.join(imagesRoot, 'manifest.json'),
    defaults: {
      viewport: ctx.config.screenshots.viewport,
      deviceScaleFactor: ctx.config.screenshots.deviceScaleFactor,
      ...(ctx.config.screenshots.browserExecutablePath ? { executablePath: ctx.config.screenshots.browserExecutablePath } : {}),
    },
    clock: ctx.clock,
    logger: ctx.logger,
    ...(options.replace ? { replace: true } : {}),
    ...(options.only ? { only: options.only } : {}),
  });
  return { ...result, originalsDir };
}
