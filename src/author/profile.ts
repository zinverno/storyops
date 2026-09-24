import { z } from 'zod';
import type { EditorialConfig } from '../config/schema.js';
import type { ContinuityMap } from '../continuity/schema.js';
import type { PublicationIndex } from '../publications/index-schema.js';
import type { Publication } from '../publications/schema.js';
import type { Clock } from '../shared/clock.js';
import { mdList, mdTable } from '../shared/markdown.js';
import { checkStyle } from './style-check.js';
import { getStyleProfile } from './style-check.js';

export const AUTHOR_PROFILE_SCHEMA_VERSION = 1;

/**
 * Author memory independent of any platform. `derived` is regenerated from
 * publications; `manual` is written by the author/agent and preserved across
 * regenerations. Platform conventions never live here.
 */
export const authorProfileSchema = z.object({
  schemaVersion: z.literal(AUTHOR_PROFILE_SCHEMA_VERSION),
  updatedAt: z.string(),
  name: z.string(),
  language: z.string(),
  styleProfile: z.string(),
  profiles: z.record(z.string(), z.string()),
  derived: z.object({
    publications: z.object({ total: z.number().int(), byPlatform: z.record(z.string(), z.number().int()), first: z.string().optional(), last: z.string().optional() }),
    knownProjects: z.array(z.object({ id: z.string(), name: z.string(), publications: z.number().int() })),
    depthDistribution: z.record(z.string(), z.number().int()),
    averageWords: z.number(),
    previousSubjects: z.array(z.string()),
    topicsAlreadyExplained: z.array(z.string()),
    repeatedIdeas: z.array(z.string()),
    frequentTerms: z.array(z.string()),
    writingTendencies: z.object({ codeBlocksPerArticle: z.number(), sectionsPerArticle: z.number(), emDashPer1000: z.number(), notXButYPer1000: z.number() }),
    undesiredHabitsObserved: z.array(z.object({ rule: z.string(), publications: z.number().int() })),
    openNarrativeThreads: z.array(z.string()),
  }),
  manual: z
    .object({
      tone: z.string().default(''),
      technicalDepth: z.string().default(''),
      preferredTerminology: z.array(z.string()).default([]),
      avoid: z.array(z.string()).default([]),
      voiceNotes: z.array(z.string()).default([]),
    })
    .default({ tone: '', technicalDepth: '', preferredTerminology: [], avoid: [], voiceNotes: [] }),
});
export type AuthorProfile = z.infer<typeof authorProfileSchema>;

const round = (n: number) => Math.round(n * 10) / 10;

export function buildAuthorProfile(config: EditorialConfig, publications: readonly Publication[], index: PublicationIndex, continuity: ContinuityMap, clock: Clock, previous?: AuthorProfile): AuthorProfile {
  const byPlatform: Record<string, number> = {};
  const depth: Record<string, number> = {};
  for (const p of publications) byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
  for (const e of index.entries) depth[e.depth] = (depth[e.depth] ?? 0) + 1;
  const dates = publications.map((p) => p.publicationDate).filter((d): d is string => Boolean(d)).sort();
  const withText = publications.filter((p) => p.text.length > 200);
  const styles = withText.map((p) => checkStyle(p.text, config.author.styleProfile));
  const habitCounts = new Map<string, number>();
  for (const s of styles) for (const rule of new Set(s.findings.filter((f) => f.severity !== 'info').map((f) => f.rule))) habitCounts.set(rule, (habitCounts.get(rule) ?? 0) + 1);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const termCounts = new Map<string, number>();
  for (const e of index.entries) for (const c of e.concepts.filter((x) => x.source === 'key-term')) termCounts.set(c.concept, (termCounts.get(c.concept) ?? 0) + 1);

  const derived: AuthorProfile['derived'] = {
    publications: { total: publications.length, byPlatform },
    knownProjects: continuity.projects.map((p) => ({ id: p.id, name: p.name, publications: p.publicationIds.length })),
    depthDistribution: depth,
    averageWords: avg(index.entries.map((e) => e.wordCount)),
    previousSubjects: index.entries.map((e) => e.mainSubject.values[0] ?? e.title),
    topicsAlreadyExplained: continuity.concepts.filter((c) => c.coverage === 'explained').map((c) => c.label),
    repeatedIdeas: continuity.themes.map((t) => t.label),
    frequentTerms: [...termCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([t]) => t),
    writingTendencies: {
      codeBlocksPerArticle: avg(publications.map((p) => p.codeBlocks.length)),
      sectionsPerArticle: avg(publications.map((p) => p.headings.length)),
      emDashPer1000: avg(styles.map((s) => s.metrics.emDashPer1000)),
      notXButYPer1000: avg(styles.map((s) => s.metrics.notXButYPer1000)),
    },
    undesiredHabitsObserved: [...habitCounts].map(([rule, n]) => ({ rule, publications: n })).sort((a, b) => b.publications - a.publications),
    openNarrativeThreads: continuity.unfinishedThreads.map((t) => `${t.kind}: ${t.text}`),
  };
  if (dates[0]) derived.publications.first = dates[0];
  if (dates.at(-1)) derived.publications.last = dates.at(-1);
  return {
    schemaVersion: AUTHOR_PROFILE_SCHEMA_VERSION,
    updatedAt: clock.now().toISOString(),
    name: config.author.name,
    language: config.language,
    styleProfile: config.author.styleProfile,
    profiles: config.author.profiles,
    derived,
    manual: previous?.manual ?? { tone: '', technicalDepth: '', preferredTerminology: [], avoid: [], voiceNotes: [] },
  };
}

export function renderAuthorProfile(p: AuthorProfile): string {
  const style = getStyleProfile(p.styleProfile);
  const d = p.derived;
  return [
    `# Author profile — ${p.name}`,
    '',
    `Updated ${p.updatedAt}. Language: ${p.language}. Style profile: \`${p.styleProfile}\`.`,
    '',
    '> Author identity and voice. Platform presentation conventions live in platform strategies and must not replace this voice.',
    '',
    '## Voice (manual — edit `manual` in author-profile.json)',
    '',
    mdList([`tone: ${p.manual.tone || '_not set_'}`, `technical depth: ${p.manual.technicalDepth || '_not set_'}`, `preferred terminology: ${p.manual.preferredTerminology.join(', ') || '_not set_'}`, `avoid: ${p.manual.avoid.join(', ') || '_not set_'}`, ...p.manual.voiceNotes]),
    '',
    '## Style guidance',
    '',
    mdList(style.guidance),
    '',
    '## Publications',
    '',
    mdTable(['Platform', 'Count'], Object.entries(d.publications.byPlatform)),
    '',
    `First: ${d.publications.first?.slice(0, 10) ?? '—'}; last: ${d.publications.last?.slice(0, 10) ?? '—'}; average ${d.averageWords} words; depth ${Object.entries(d.depthDistribution).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
    '',
    '## Known projects',
    '',
    mdList(d.knownProjects.map((x) => `${x.name} (\`${x.id}\`) — ${x.publications} publication(s)`)),
    '',
    '## Previous subjects',
    '',
    mdList(d.previousSubjects),
    '',
    '## Topics already explained',
    '',
    mdList(d.topicsAlreadyExplained.slice(0, 40)),
    '',
    '## Repeated ideas',
    '',
    mdList(d.repeatedIdeas.slice(0, 20)),
    '',
    '## Writing tendencies (measured)',
    '',
    mdList([`code blocks per article: ${d.writingTendencies.codeBlocksPerArticle}`, `sections per article: ${d.writingTendencies.sectionsPerArticle}`, `em dashes per 1000 words: ${d.writingTendencies.emDashPer1000}`, `"не X, а Y" per 1000 words: ${d.writingTendencies.notXButYPer1000}`]),
    '',
    '## Undesired habits observed',
    '',
    mdList(d.undesiredHabitsObserved.map((h) => `${h.rule} — in ${h.publications} publication(s)`)),
    '',
    '## Open narrative threads',
    '',
    mdList(d.openNarrativeThreads),
    '',
  ].join('\n');
}
