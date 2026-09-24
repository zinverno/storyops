import { z } from 'zod';

export const SCREENSHOT_PLAN_SCHEMA_VERSION = 1;

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), selector: z.string() }),
  z.object({ type: z.literal('fill'), selector: z.string(), value: z.string() }),
  z.object({ type: z.literal('press'), key: z.string(), selector: z.string().optional() }),
  z.object({ type: z.literal('hover'), selector: z.string() }),
  z.object({ type: z.literal('scroll'), selector: z.string() }),
  z.object({ type: z.literal('waitForSelector'), selector: z.string() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().positive().max(30_000) }),
]);
export type ScreenshotAction = z.infer<typeof actionSchema>;

export const screenshotStepSchema = z.object({
  name: z.string().min(1),
  /** Path relative to baseUrl (web targets). */
  path: z.string().optional(),
  actions: z.array(actionSchema).default([]),
  /** Selector that must be visible before capture: the "meaningful UI state". */
  waitFor: z.string().optional(),
  waitForText: z.string().optional(),
  waitForNetworkIdle: z.boolean().default(false),
  screenshot: z.string().regex(/^[\w.-]+\.png$/, 'screenshot must be a plain file name ending in .png'),
  /** Capture only this element instead of the viewport (avoid giant screenshots of tiny areas). */
  clip: z.string().optional(),
  fullPage: z.boolean().default(false),
  purpose: z.string().optional(),
  supports: z.string().optional(),
  mask: z.array(z.string()).default([]),
  hide: z.array(z.string()).default([]),
});
export type ScreenshotStep = z.infer<typeof screenshotStepSchema>;

export const screenshotPlanSchema = z.object({
  schemaVersion: z.literal(SCREENSHOT_PLAN_SCHEMA_VERSION).default(SCREENSHOT_PLAN_SCHEMA_VERSION),
  target: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('web') }),
      z.object({ kind: z.literal('electron'), executablePath: z.string().optional(), args: z.array(z.string()).default([]), cwd: z.string().optional() }),
    ])
    .default({ kind: 'web' }),
  baseUrl: z.string().url().optional(),
  /** Optional local app to start before capturing. The command runs locally; only use plans you trust. */
  launch: z
    .object({
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      readyUrl: z.string().url().optional(),
      readyTimeoutMs: z.number().int().positive().default(60_000),
      env: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
  viewport: z.object({ width: z.number().int().min(320), height: z.number().int().min(240) }).optional(),
  deviceScaleFactor: z.number().min(1).max(3).optional(),
  colorScheme: z.enum(['light', 'dark']).optional(),
  locale: z.string().optional(),
  privacy: z
    .object({
      /** Abort a step when secret-like text is visible (outside masked/hidden areas). */
      blockOnSecrets: z.boolean().default(true),
      /** Email addresses are treated as private unless this is set. */
      allowEmails: z.boolean().default(false),
      mask: z.array(z.string()).default([]),
      hide: z.array(z.string()).default([]),
    })
    .default({ blockOnSecrets: true, allowEmails: false, mask: [], hide: [] }),
  steps: z.array(screenshotStepSchema).min(1),
});
export type ScreenshotPlan = z.infer<typeof screenshotPlanSchema>;

export const imageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  images: z.array(
    z.object({
      file: z.string(),
      step: z.string(),
      purpose: z.string().optional(),
      supports: z.string().optional(),
      target: z.enum(['web', 'electron']),
      location: z.string().optional(),
      viewport: z.object({ width: z.number(), height: z.number() }),
      deviceScaleFactor: z.number(),
      capturedAt: z.string(),
      sha256: z.string(),
      bytes: z.number().int(),
      masked: z.array(z.string()),
      hidden: z.array(z.string()),
      browser: z.string().optional(),
    }),
  ),
});
export type ImageManifest = z.infer<typeof imageManifestSchema>;
