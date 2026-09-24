import { mdList, mdTable } from '../shared/markdown.js';
import type { ContinuityMap, PublicationRef } from './schema.js';

const d = (iso?: string) => (iso ? iso.slice(0, 10) : 'undated');
const label = (p: PublicationRef) => `${p.title} (${p.platform}, ${d(p.date)}, ${p.depth})`;

export function renderContinuityMarkdown(map: ContinuityMap): string {
  const out: string[] = [
    `# Continuity map — ${map.author}`,
    '',
    `Generated ${map.generatedAt}. ${map.publications.length} publication(s).`,
    '',
    `> Method: ${map.method}`,
    '',
    '## Chronology',
    '',
    mdTable(
      ['Date', 'Platform', 'Title', 'Depth', 'Roles', 'Projects'],
      map.publications.map((p) => [d(p.date), p.platform, p.title, p.depth, p.roles.join(', '), p.projects.join(', ') || '—']),
    ),
    '',
    '## Projects previously discussed',
    '',
  ];
  for (const project of map.projects) {
    out.push(`### ${project.name} (\`${project.id}\`)`, '');
    if (project.publicationIds.length === 0) {
      out.push('_Not discussed in any indexed publication yet._', '');
      continue;
    }
    out.push(`- Publications: ${project.publicationIds.length} on ${project.platforms.join(', ')}`);
    out.push(`- First: ${d(project.firstPublishedAt)}, last: ${d(project.lastPublishedAt)}`);
    out.push('- Already covered:');
    for (const a of project.coveredAspects) out.push(`  - ${a.label} — ${label(a.publication)}`);
    out.push('');
  }
  out.push('## Concepts already explained', '', mdList(map.concepts.filter((c) => c.coverage === 'explained').map((c) => `${c.label} — ${c.occurrences.filter((o) => o.treatment === 'explained').map((o) => `${o.platform}/${d(o.date)}`).join(', ')}`)), '');
  out.push('## Concepts only mentioned (not yet explained in depth)', '', mdList(map.concepts.filter((c) => c.coverage === 'mentioned').slice(0, 40).map((c) => `${c.label} — ${c.occurrences.map((o) => `${o.platform}/${o.depth}`).join(', ')}`)), '');
  out.push('## Major themes (≥2 publications)', '', mdList(map.themes.slice(0, 30).map((t) => `${t.label} — ${t.publicationIds.length} publications on ${t.platforms.join(', ')}`)), '');
  if (map.repeatedExplanations.length) {
    out.push('## Explained more than once (avoid re-explaining again)', '', mdList(map.repeatedExplanations.map((r) => `${r.label} — ${r.publicationIds.join(', ')}`)), '');
  }
  const section = (title: string, rows: Array<{ publication: PublicationRef; items: string[] }>) => {
    out.push(`## ${title}`, '');
    if (rows.length === 0) out.push('_none detected_', '');
    for (const row of rows) out.push(`**${label(row.publication)}**`, '', mdList(row.items), '');
  };
  section('Architecture already described', map.architectureDescribed);
  section('Problems already introduced', map.problemsIntroduced);
  section('Results already reported', map.resultsReported);
  out.push('## Promises to readers', '', mdList(map.promises.map((p) => `[${p.status}${p.addressedBy ? ` → ${p.addressedBy}` : ''}] ${p.text} — ${label(p.publication)}`)), '');
  out.push('## Open questions', '', mdList(map.openQuestions.map((q) => `[${q.status}${q.addressedBy ? ` → ${q.addressedBy}` : ''}] ${q.text} — ${label(q.publication)}`)), '');
  out.push('## Unfinished story threads', '', mdList(map.unfinishedThreads.map((t) => `${t.kind}: ${t.text} (since ${d(t.since)}, ${t.publicationId})`)), '');
  out.push('', '_Heuristic extraction. Treat entries as leads to verify, not as ground truth._', '');
  return out.join('\n');
}
