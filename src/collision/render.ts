import { mdList, mdTable } from '../shared/markdown.js';
import type { CollisionReport, OverlapMatch } from './analyze.js';

const rows = (matches: OverlapMatch[]) =>
  mdTable(
    ['Level', 'Title', 'Platform', 'cosine', 'BM25 (norm.)', 'kw Jaccard', 'Shared terms'],
    matches.map((m) => [m.level, m.url ? `[${m.title}](${m.url})` : m.title, m.platform, m.cosine, m.bm25Normalized, m.keywordJaccard, m.sharedTerms.slice(0, 6).join(', ')]),
  );

export function renderCollision(report: CollisionReport): string {
  return [
    `# Topic collision — "${report.topic}"`,
    '',
    `Generated ${report.generatedAt}.`,
    '',
    '## Summary',
    '',
    mdList(report.summary),
    '',
    '## Author overlap',
    '',
    report.authorOverlap.length ? rows(report.authorOverlap) : '_no publications indexed_',
    '',
    '## Recent ecosystem overlap',
    '',
    report.ecosystemSources.length ? mdList(report.ecosystemSources.map((s) => `${s.platform}: snapshot ${s.collectedAt} (${s.status}, N=${s.sampleSize})`)) : '_no research snapshot_',
    '',
    report.ecosystemOverlap.length ? rows(report.ecosystemOverlap) : '_no overlapping titles_',
    '',
    '## Already-covered concepts',
    '',
    mdList(report.alreadyCoveredConcepts.map((c) => `${c.concept} (${c.coverage}) — ${c.publicationIds.join(', ')}`)),
    '',
    '## Saturated angles',
    '',
    mdList(report.saturatedAngles.map((s) => `${s.label} — ${s.count}/${s.sampleSize} in ${s.platform} sample; e.g. ${s.examples.join(' | ')}`)),
    '',
    '## Novel contribution',
    '',
    mdList([...report.novelContribution.gaps.map((g) => `narrative gap: ${g}`), ...(report.novelContribution.terms.length ? [`terms not seen in either corpus: ${report.novelContribution.terms.join(', ')}`] : [])]),
    '',
    '## Possible alternative angles',
    '',
    mdList(report.alternativeAngles.map((a) => `${a.angle} — ${a.why} Evidence: ${a.evidence.join(', ')}`)),
    '',
    '## Method',
    '',
    report.method,
    '',
    mdList(report.notes),
    '',
  ].join('\n');
}
