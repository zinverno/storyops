import { mdList, mdTable } from '../shared/markdown.js';
import type { OpportunityCandidate, OpportunityReport, Quadrant } from './types.js';

/**
 * Markdown renderers. Reports describe; they never title, outline or draft an
 * article, and they never pick a winner.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function dimensionRows(c: OpportunityCandidate): Array<[string, string, string]> {
  const d = c.dimensions;
  return [
    ['Repository novelty', d.repositoryNovelty.level, d.repositoryNovelty.reason],
    ['Evidence strength', d.evidenceStrength.level, d.evidenceStrength.reason],
    ['Author overlap', d.authorOverlap.level, d.authorOverlap.reason],
    ['Platform activity', d.platformActivity.level, d.platformActivity.reason],
    ['Saturation', d.saturation.state, d.saturation.reason],
    ['Trend direction', d.trendDirection.direction, d.trendDirection.reason],
    ['Technical specificity', d.technicalSpecificity.level, d.technicalSpecificity.reason],
    ['Recency', d.recency.level, d.recency.lastEventAt ? `last event ${d.recency.lastEventAt.slice(0, 10)} (${d.recency.days} days ago)` : '—'],
  ];
}

/** One-line summary without evaluative wording ("high novelty, low overlap, …"). */
export function dimensionSummary(c: OpportunityCandidate): string {
  const d = c.dimensions;
  return `${d.repositoryNovelty.level} repository novelty, ${d.authorOverlap.level} author overlap, ${d.platformActivity.level} platform activity, saturation ${d.saturation.state}, trend ${d.trendDirection.direction}`;
}

export function renderMatrix(matrix: Record<Quadrant, string[]>): string {
  const cell = (q: Quadrant) => (matrix[q].length ? matrix[q].join(', ') : '—');
  return [
    '```text',
    '                            PLATFORM ACTIVITY',
    '                      low                         high/medium',
    `REPO NOVELTY  high   niche                       active opportunity`,
    `              low    low relevance               crowded/repetitive`,
    '```',
    '',
    mdTable(
      ['Quadrant', 'Candidates'],
      [
        ['active opportunity (novelty high, activity high/medium)', cell('active opportunity')],
        ['niche (novelty high, activity low)', cell('niche')],
        ['crowded/repetitive (novelty low, activity high/medium)', cell('crowded/repetitive')],
        ['low relevance (novelty low, activity low)', cell('low relevance')],
        ['unknown platform data', cell('unknown platform data')],
      ],
    ),
  ].join('\n');
}

function renderThemes(c: OpportunityCandidate): string[] {
  if (!c.platform) return ['_No platform selected._'];
  if (c.platform.themes.length === 0) return [`_No ${c.platform.id} data for this topic or its related themes._`];
  return [
    mdTable(
      ['Theme', 'Relation', 'Articles (window)', 'Share', 'Saturation', 'Activity', 'Trend'],
      c.platform.themes.map((t) => [t.label, t.relation, `${t.articleCount}/${t.sampleSize} in ${t.window.days}d`, pct(t.share), t.state, t.activity, t.trend]),
    ),
  ];
}

export function renderCandidate(c: OpportunityCandidate, options: { heading?: string; detailed?: boolean } = {}): string {
  const out = [
    `${options.heading ?? '##'} ${c.topic.label} (\`${c.id}\`)`,
    '',
    `${dimensionSummary(c)}. Quadrant: **${c.quadrant}**.`,
    '',
    mdTable(['Dimension', 'Value', 'Why'], dimensionRows(c)),
    '',
    '**Repository evidence**',
    '',
    c.repository ? mdList(c.repository.events.map((e) => `${e.date.slice(0, 10)} \`${e.type}\`${e.aspects.length ? ` (+${e.aspects.join(', ')})` : ''}: ${e.summary} — ${e.strength} evidence, ${e.basis}${options.detailed ? `; refs: ${e.evidence.map((x) => `${x.kind}:${x.ref}`).join(', ')}` : ''}`)) : '_none_',
    '',
    '**Why it may be technically interesting**',
    '',
    mdList(c.whyTechnicallyInteresting, '_no significant events_'),
    '',
    '**Author archive**',
    '',
    `Coverage: ${c.author.coverageText}.`,
    '',
    mdList(c.author.alreadyCovered, '_Nothing on this topic in the archive._'),
    '',
    '_Genuinely new since the archive:_',
    '',
    mdList(c.author.genuinelyNew, '_nothing new since the last publication_'),
  ];
  if (c.author.similar.length) out.push('', '_Lexically similar publications:_', '', mdList(c.author.similar.map((s) => `"${s.title}" (cosine ${s.cosine}; shared: ${s.sharedTerms?.join(', ') ?? '—'})`)));
  out.push('', `**Platform landscape${c.platform ? ` (${c.platform.id})` : ''}**`, '', ...renderThemes(c));
  if (c.patterns.length) out.push('', '**Related structural patterns (observed, not prescribed)**', '', mdList(c.patterns.map((p) => `${p.patternId} (${p.strength}): ${p.observation} — ${p.possibleRelevance}`)));
  if (c.possibleDirections.length) out.push('', '**Possible directions**', '', mdList(c.possibleDirections));
  out.push('', '**Risks**', '', mdList(c.risks, '_none identified_'), '', '**Questions for the author**', '', mdList(c.questions, '_none_'), '', '**Unknowns**', '', mdList(c.unknowns), '');
  return out.join('\n');
}

export function renderOpportunityReport(r: OpportunityReport): string {
  return [
    '# Topic opportunities',
    '',
    `Generated ${r.generatedAt}.`,
    r.repository ? `Repository: ${r.repository.name} (\`${r.repository.id}\`)${r.repository.head ? `, HEAD ${r.repository.head.slice(0, 10)}` : ''}${r.repository.inspectedAt ? `, inspected ${r.repository.inspectedAt}` : ''}.` : 'Repository: none.',
    r.platform ? `Platform: ${r.platform.id}, ${r.platform.runs} research run(s)${r.platform.latestRunAt ? `, latest ${r.platform.latestRunAt}` : ''}, ${r.platform.windowDays}-day window.` : 'Platform: none.',
    `Author archive: ${r.author.publications} publication(s).`,
    '',
    `> ${r.notice}`,
    '> StoryOps analyses; the author writes. Nothing here is an article, an outline or a title.',
    '',
    '## Opportunity matrix',
    '',
    renderMatrix(r.matrix),
    '',
    '## Candidates (alphabetical)',
    '',
    ...(r.candidates.length ? r.candidates.map((c) => renderCandidate(c)) : ['_No candidates: run `storyops repo inspect` first, or check the project glossary._', '']),
    '## Method',
    '',
    r.method,
    '',
    '## Limitations',
    '',
    mdList(r.limitations),
    '',
  ].join('\n');
}

export function renderComparison(candidates: readonly OpportunityCandidate[]): string {
  const dims = ['Repository novelty', 'Evidence strength', 'Author overlap', 'Platform activity', 'Saturation', 'Trend direction', 'Technical specificity', 'Recency'];
  const rows = dims.map((d, i) => [d, ...candidates.map((c) => dimensionRows(c)[i]![1])]);
  rows.push(['Quadrant', ...candidates.map((c) => c.quadrant)]);
  return [
    '# Topic comparison',
    '',
    '> Side by side, dimension by dimension. There is no winner; the author decides.',
    '',
    mdTable(['Dimension', ...candidates.map((c) => c.query ?? c.topic.label)], rows),
    '',
    ...candidates.flatMap((c) => [`## ${c.query ?? c.topic.label}`, '', mdList(dimensionRows(c).map(([d, v, why]) => `${d}: ${v} — ${why}`)), '', ...(c.risks.length ? ['Risks:', '', mdList(c.risks), ''] : [])]),
  ].join('\n');
}

export interface Dossier {
  schemaVersion: 1;
  generatedAt: string;
  candidate: OpportunityCandidate;
  notice: string;
}

export function renderDossier(d: Dossier): string {
  const c = d.candidate;
  return [
    `# Topic dossier: ${c.topic.label}`,
    '',
    `Generated ${d.generatedAt}. Topic \`${c.topic.id}\` (${c.topic.origin}, ${c.topic.specificity}).`,
    '',
    `> ${d.notice}`,
    '',
    renderCandidate(c, { heading: '##', detailed: true }),
    '## What was already covered',
    '',
    mdList(c.author.alreadyCovered, '_nothing_'),
    '',
    '## What changed in the repository',
    '',
    mdList(c.whatChanged, '_no events_'),
    '',
  ].join('\n');
}
