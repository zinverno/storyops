import { mdList, mdTable } from '../shared/markdown.js';
import type { NarrativeGapReport } from './schema.js';

export function renderNarrativeGap(report: NarrativeGapReport): string {
  const d = (iso?: string) => (iso ? iso.slice(0, 10) : '—');
  const strong = report.gaps.filter((g) => g.strength === 'strong');
  return [
    `# Narrative gap — ${report.projectId}`,
    '',
    `Generated ${report.generatedAt}. Boundary: last publication ${d(report.boundary.lastPublicationAt)} (${report.boundary.publications} publication(s) about this project).`,
    '',
    `> Method: ${report.method}`,
    '',
    '## Already covered',
    '',
    mdList(report.alreadyCovered.map((a) => `${a.label} — ${a.platform}, ${d(a.date)} (${a.publicationId})`)),
    '',
    '## New in project',
    '',
    mdList(report.newInProject),
    '',
    '## Strong narrative gap',
    '',
    report.headline ? `**${report.headline}**` : '_none_',
    '',
    mdList(strong.map((g) => `${g.title} — ${g.strengthReason}`)),
    '',
    '## All gaps (ranked by evidence strength, not recency)',
    '',
    mdTable(
      ['Kind', 'Gap', 'Coverage', 'Strength', 'Since', 'Evidence'],
      report.gaps.map((g) => [g.kind, g.title, g.coverage, `${g.strength} (${g.strengthReason})`, d(g.since), g.evidence.slice(0, 4).join(', ')]),
    ),
    '',
    '## Candidates already covered by publications',
    '',
    mdList(report.coveredCandidates.map((c) => `${c.title} — ${c.coverage} in ${c.publicationIds.join(', ')}`)),
    '',
    '## Notes',
    '',
    mdList(report.notes),
    '',
  ].join('\n');
}
