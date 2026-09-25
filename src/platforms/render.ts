import path from 'node:path';
import type { PlatformStrategy, PublicationType, RenderInput } from '../../platforms/schema.js';
import type { CanonicalStory } from '../stories/schema.js';
import { stringifyFrontmatter } from '../shared/frontmatter.js';

/**
 * Turns one story field into bullet lines for the scaffold. The scaffold
 * shows facts from the canonical story next to each section so the author or
 * agent writes every platform version from the story, not from another output.
 */
export function storyFieldLines(story: CanonicalStory, field: string): string[] {
  const value = (story as Record<string, unknown>)[field];
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    const evidence = Array.isArray(o.evidence) && o.evidence.length > 0 ? ` [evidence: ${(o.evidence as string[]).join(', ')}]` : '';
    if (typeof o.decision === 'string') return [`${o.decision}${o.why ? ` — why: ${String(o.why)}` : ''}${evidence}`];
    if (typeof o.approach === 'string') return [`${o.approach} — insufficient because: ${String(o.whyInsufficient ?? '?')}${evidence}`];
    if (typeof o.what === 'string') return [`${o.what}: ${String(o.value)}${o.unit ? ` ${String(o.unit)}` : ''}${o.method ? ` (method: ${String(o.method)})` : ''}${evidence}`];
    if (typeof o.publicationId === 'string') return [`${String(o.relation)} ${o.title ? `"${String(o.title)}"` : o.publicationId}${o.url ? ` <${String(o.url)}>` : ''}`];
    if (typeof o.description === 'string') return [`${String(o.kind ?? 'visual')}: ${o.description} — purpose: ${String(o.purpose ?? '')}`];
    if (typeof o.text === 'string') return [`${o.text}${evidence}`];
    return [];
  });
}

export function lengthTarget(strategy: PlatformStrategy, type: PublicationType): string {
  const range = strategy.content.expectedLength[type];
  if (!range) return 'no specific length target';
  return `${range.min}–${range.max} ${range.unit} (${range.kind}${range.note ? `; ${range.note}` : ''})`;
}

export interface ScaffoldOptions {
  /** Render sections as Markdown headings (false for feed/channel formats). */
  headings: boolean;
  extraNotes?: string[];
}

function sectionsFor(strategy: PlatformStrategy, type: PublicationType) {
  return strategy.structures[type] ?? strategy.structures[strategy.content.defaultPublicationType] ?? Object.values(strategy.structures)[0] ?? [];
}

export function renderScaffold(input: RenderInput, options: ScaffoldOptions): string {
  const { story, strategy, publicationType } = input;
  const isSeries = story.relationToPreviousPublications.some((r) => r.relation === 'continues' || r.relation === 'updates');
  const plans = story.claims.filter((c) => c.classification === 'future-plan');
  const unverified = story.claims.filter((c) => c.classification === 'unverified' || c.classification === 'hypothesis');
  const constraints = [...strategy.formatting.constraints, ...strategy.tone.rules, ...strategy.content.rules].filter((r) => r.kind === 'constraint');

  const guidance = [
    'editorial-kit draft workspace. Write this publication FROM the canonical story:',
    `  ${path.basename(path.dirname(input.storyPath))}/story.json`,
    'Do not derive it from another platform output. Remove these comments before publishing.',
    '',
    `Platform: ${strategy.displayName} (strategy ${strategy.id}@${strategy.version})`,
    `Publication type: ${publicationType}`,
    `Length target: ${lengthTarget(strategy, publicationType)}`,
    `Depth: ${strategy.content.preferredDepth}; technical detail: ${strategy.content.technicalDetail}; code: ${strategy.structure.code}`,
    `Opening: ${strategy.opening.preferred}`,
    isSeries && strategy.opening.previousPublicationCallback !== 'avoid'
      ? 'Series: this story continues earlier publications. Start from what changed since then; do not retell the project origin.'
      : '',
    `Tone: ${strategy.tone.formality}; marketing tolerance: ${strategy.tone.marketingTolerance}. Keep the author voice.`,
    ...(constraints.length ? ['Hard constraints:', ...constraints.map((c) => `  - ${c.text}${c.source ? ` (${c.source})` : ''}`)] : []),
    ...(plans.length ? ['Future plans (never present as implemented):', ...plans.map((c) => `  - ${c.text}`)] : []),
    ...(unverified.length ? ['Unverified/hypotheses (label as such or omit):', ...unverified.map((c) => `  - ${c.text}`)] : []),
    ...(options.extraNotes ?? []),
    ...(input.editorialNotes ?? []),
  ].filter((line) => line !== '');

  const parts: string[] = [`<!--\n${guidance.join('\n')}\n-->`, ''];
  if (options.headings) parts.push(`# ${story.topic}`, '');

  for (const section of sectionsFor(strategy, publicationType)) {
    const facts = section.storyFields.flatMap((field) => storyFieldLines(story, field).map((line) => `${field}: ${line}`));
    if (options.headings) parts.push(`## [${section.id}]`);
    else parts.push(`<!-- section: ${section.id} -->`);
    parts.push(`<!-- purpose: ${section.purpose} -->`);
    if (facts.length > 0) parts.push(`<!-- story facts:\n${facts.map((f) => `  - ${f}`).join('\n')}\n-->`);
    else parts.push('<!-- story facts: none recorded; omit this section unless the story is updated with evidence -->');
    parts.push('', 'TODO: write this section from the story facts above.', '');
  }

  const frontmatter = {
    platform: strategy.id,
    strategy: `${strategy.id}@${strategy.version}`,
    publicationType,
    story: story.slug,
    storyUpdatedAt: story.updatedAt,
    status: 'scaffold',
    format: strategy.formatting.format,
  };
  return stringifyFrontmatter(frontmatter, parts.join('\n'));
}

export const defaultRenderer = {
  render(input: RenderInput): string {
    return renderScaffold(input, { headings: input.strategy.structure.sections !== 'none' });
  },
};
