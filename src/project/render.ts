import { mdList, mdTable } from '../shared/markdown.js';
import type { ProjectReport } from './schema.js';

const d = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

export function renderProjectReport(report: ProjectReport): string {
  const categories = new Map<string, number>();
  for (const c of report.commits) categories.set(c.messageCategory, (categories.get(c.messageCategory) ?? 0) + 1);
  const out = [
    `# Project report — ${report.name}`,
    '',
    `Inspected ${report.inspectedAt} at \`${report.root}\`${report.head ? ` (HEAD ${report.head.slice(0, 10)})` : ''}.`,
    '',
    report.isGitRepository ? `Git history: ${report.commits.length} commits, ${report.tags.length} tags.` : '_Not a git repository._',
    '',
    '## Manifests',
    '',
    mdList(report.metadata.manifests.map((m) => `\`${m.path}\`: ${m.name ?? '?'}${m.version ? `@${m.version}` : ''}${m.description ? ` — ${m.description}` : ''}`)),
    '',
    '## Modules',
    '',
    mdTable(
      ['Module', 'Files', 'Test files', 'Commits', 'First seen', 'Last changed', 'Status'],
      report.modules.map((m) => [m.path, m.files, m.testFiles, m.commits, d(m.firstSeen), d(m.lastChanged), m.exists ? 'present' : `removed ${d(m.deletedAt)}`]),
    ),
    '',
    '## Documentation',
    '',
    mdTable(['Path', 'Kind', 'Title', 'Status', 'Last commit'], report.docs.map((doc) => [doc.path, doc.kind, doc.title, doc.status, d(doc.lastCommitDate)])),
    '',
    '## Tests',
    '',
    `${report.tests.files} test file(s). ${report.tests.note}`,
    '',
    '## Chronology (tags, modules, ADRs, notable commits)',
    '',
    mdTable(['Date', 'Kind', 'What', 'Ref'], report.chronology.map((c) => [d(c.date), c.kind, c.title, c.ref])),
    '',
    '## Commit categories (from messages; verify against source)',
    '',
    mdList([...categories].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`)),
    '',
  ];
  const mismatches = report.commits.filter((c) => c.mismatch);
  if (mismatches.length) out.push('### Message/file mismatches', '', mdList(mismatches.map((c) => `\`${c.shortHash}\` ${c.subject} — ${c.mismatch}`)), '');
  if (report.changelog.length) out.push('## Changelog', '', mdList(report.changelog.slice(0, 10).map((e) => `${e.version}${e.date ? ` (${e.date})` : ''}: ${e.items.slice(0, 5).join('; ')}`)), '');
  if (report.warnings.length) out.push('## Warnings', '', mdList(report.warnings), '');
  out.push(`_${report.skippedSecretPaths} secret-like path(s) were skipped and not read._`, '');
  return out.join('\n');
}
