import { mdList, mdTable } from '../shared/markdown.js';
import type { Finding, ReviewReport } from './types.js';

const where = (f: Finding) => (f.lines ? (f.lines.start === f.lines.end ? `L${f.lines.start}` : `L${f.lines.start}–L${f.lines.end}`) : '—');

export function renderFinding(f: Finding): string {
  const lines = [
    `### ${f.id} · ${where(f)} · ${f.category} · ${f.severity}${f.status !== 'open' ? ` · ${f.status}` : ''}`,
    '',
    `Possible issue: ${f.problem}`,
  ];
  if (f.excerpt) lines.push('', `> ${f.excerpt}`);
  lines.push('', `Why it may matter: ${f.why}`, '', `Possible change: ${f.suggestion}`);
  if (f.alternative) lines.push('', `Possible local alternative: «${f.alternative}»`);
  if (f.evidence) lines.push('', `Evidence: **${f.evidence.status}**${f.evidence.refs.length ? ` (${f.evidence.refs.join(', ')})` : ''}. ${f.evidence.note}`);
  if (f.related) {
    const r = f.related;
    const head = [r.lines ? `related lines ${r.lines.start}–${r.lines.end}` : '', r.title ? `previous publication "${r.title}"` : '', r.similarity !== undefined ? `similarity ${r.similarity}` : ''].filter(Boolean).join(', ');
    if (head || r.details.length) lines.push('', mdList([...(head ? [head] : []), ...r.details]));
  }
  lines.push('', `_rule \`${f.rule}\` · fingerprint \`${f.fingerprint}\` · the author decides_`, '');
  return lines.join('\n');
}

export function renderReview(r: ReviewReport): string {
  const open = r.findings.filter((f) => f.status === 'open');
  const decided = r.findings.filter((f) => f.status !== 'open');
  return [
    `# Review: ${r.article.key}`,
    '',
    `Generated ${r.generatedAt}. Review \`${r.id}\`. Article sha256 \`${r.article.sha256.slice(0, 16)}…\`, ${r.article.words} words.`,
    `Profile: ${r.profile ?? '—'}; language profile: ${r.languageProfile}; repository: ${r.context.repository ?? '—'}; platform: ${r.context.platform ?? '—'}; archive: ${r.context.archivePublications} publication(s); author input: ${r.context.authorInput ?? '—'}.`,
    '',
    `> ${r.notice}`,
    '',
    '## Summary',
    '',
    mdTable(['Category', 'Findings'], Object.entries(r.summary.byCategory).sort()),
    '',
    `${r.summary.total} finding(s): ${Object.entries(r.summary.bySeverity).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}. ${r.summary.carriedDecisions ? `${r.summary.carriedDecisions} carry an earlier author decision. ` : ''}`,
    '',
    '## Claims checked against evidence',
    '',
    r.claims.length ? mdTable(['Line', 'Claim', 'Status', 'Evidence'], r.claims.map((c) => [c.line, c.text, c.status, c.refs.join(', ') || c.note])) : '_No factual-looking claims detected._',
    '',
    '## Findings',
    '',
    ...(open.length ? open.map(renderFinding) : ['_No open findings._', '']),
    ...(decided.length ? ['## Findings with an earlier decision', '', ...decided.map(renderFinding)] : []),
    ...(r.watchFor.length ? ['## Profile watch-list (for a human or agent reviewer)', '', mdList(r.watchFor), ''] : []),
    '## Metrics',
    '',
    mdList(Object.entries(r.metrics).map(([k, v]) => `${k}: ${v ?? '—'}`)),
    '',
    '## Limitations',
    '',
    mdList(r.limitations),
    '',
    'Record a decision: `storyops findings set <finding-id> accepted|dismissed|resolved [--review <id>]`.',
    '',
  ].join('\n');
}
