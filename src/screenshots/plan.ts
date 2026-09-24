import type { CanonicalStory } from '../stories/schema.js';
import { mdList } from '../shared/markdown.js';
import { SCREENSHOT_PLAN_SCHEMA_VERSION, type ScreenshotPlan } from './schema.js';

/**
 * Derives a screenshot plan from the canonical story. Every step carries the
 * narrative purpose and the section it supports; paths and wait selectors
 * that cannot be derived are left as explicit TODO values to fill in.
 */
export function planFromStory(story: CanonicalStory, baseUrl = 'http://localhost:3000'): ScreenshotPlan {
  const visuals = story.possibleVisuals.filter((v) => v.kind === 'screenshot');
  return {
    schemaVersion: SCREENSHOT_PLAN_SCHEMA_VERSION,
    target: { kind: 'web' },
    baseUrl,
    privacy: { blockOnSecrets: true, allowEmails: false, mask: [], hide: [] },
    steps: visuals.map((v, i) => ({
      name: v.id,
      path: v.target ?? '/TODO-path',
      actions: [],
      waitFor: 'TODO-selector-for-ready-state',
      waitForNetworkIdle: false,
      screenshot: `${String(i + 1).padStart(2, '0')}-${v.id.replace(/[^\w.-]+/g, '-')}.png`,
      fullPage: false,
      purpose: v.purpose,
      supports: v.supports ?? v.description,
      mask: [],
      hide: [],
    })),
  };
}

export function renderPlanMarkdown(plan: ScreenshotPlan): string {
  const out = ['# Screenshot plan', '', 'Every screenshot must have a narrative purpose. Do not add screenshots to increase length.', ''];
  plan.steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.name}`, '', `Purpose:\n${s.purpose ?? 'TODO'}`, '', `Supports:\n${s.supports ?? 'TODO'}`, '', mdList([`file: ${s.screenshot}`, `path: ${s.path ?? '—'}`, `ready when: ${s.waitFor ?? s.waitForText ?? '—'}`]), '');
  });
  if (plan.steps.length === 0) out.push('_The story lists no screenshot visuals._', '');
  return out.join('\n');
}
