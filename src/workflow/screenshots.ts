import path from 'node:path';
import { captureScreenshots, type CaptureResult } from '../screenshots/capture.js';
import { screenshotPlanSchema } from '../screenshots/schema.js';
import { StoryOpsError } from '../shared/errors.js';
import { readJson } from '../shared/fs.js';
import type { AppContext } from './context.js';

/**
 * Optional utility: captures product screenshots from a plan the author
 * wrote (see examples/screenshot-plan.example.json). Originals go to
 * `--out`, else next to the plan in `images/`, else to screenshots.outputDir.
 * StoryOps does not derive plans from stories any more.
 */
export async function screenshotCaptureWorkflow(ctx: AppContext, planFile: string, options: { out?: string; replace?: boolean; only?: string[] } = {}): Promise<CaptureResult & { originalsDir: string }> {
  const plan = await readJson(planFile, screenshotPlanSchema);
  if (plan.steps.some((s) => s.path?.includes('TODO') || s.waitFor?.includes('TODO'))) {
    throw new StoryOpsError('PLAN_INCOMPLETE', 'The screenshot plan still contains TODO values (path/waitFor).', { hint: 'Fill in the real URL paths and ready-state selectors first.' });
  }
  const planDir = path.dirname(path.resolve(planFile));
  const imagesRoot = options.out ? path.resolve(options.out) : planDir !== ctx.workspace.root ? path.join(planDir, 'images') : path.resolve(ctx.workspace.root, ctx.config.screenshots.outputDir);
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
