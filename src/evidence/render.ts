import { mdList } from '../shared/markdown.js';
import type { EvidenceMap } from './schema.js';

export function renderEvidence(map: EvidenceMap): string {
  const byId = new Map(map.records.map((r) => [r.id, r]));
  const out = [
    `# Evidence — ${map.story}`,
    '',
    `Collected ${map.collectedAt}${map.projectRoot ? ` from \`${map.projectRoot}\`` : ''}. ${map.records.length} evidence record(s), ${map.claims.length} claim(s).`,
    '',
    '> EVIDENCE → STORY → ARTICLE. Claims marked verified-fact must point here before drafting.',
    '',
  ];
  if (map.issues.length) out.push('## Issues', '', mdList(map.issues.map((i) => `**${i.severity}**${i.claimId ? ` [${i.claimId}]` : ''}: ${i.message}`)), '');
  out.push('## Claims', '');
  for (const c of map.claims) {
    out.push(`### Claim: ${c.text}`, '', `- id: \`${c.claimId}\``, `- classification: **${c.classification}**`, `- status: **${c.status}**`, '', 'Evidence:', '');
    if (c.evidenceIds.length === 0) out.push('_none_');
    for (const id of c.evidenceIds) {
      const r = byId.get(id)!;
      out.push(`- \`${r.ref}\` (${r.kind}) — ${r.title}${r.date ? `, ${r.date.slice(0, 10)}` : ''}`);
    }
    if (c.unresolvedRefs.length) out.push('', 'Unresolved:', mdList(c.unresolvedRefs.map((r) => `\`${r}\``)));
    if (c.suggestions.length) out.push('', 'Candidate evidence (lexical search, verify before use):', mdList(c.suggestions.map((s) => `\`${s.ref}\` (cosine ${s.score})`)));
    out.push('');
  }
  out.push('## Evidence records', '');
  for (const r of map.records) {
    out.push(`### \`${r.ref}\``, '', `${r.kind} — ${r.title}${r.date ? ` (${r.date.slice(0, 10)})` : ''}`, '');
    if (r.excerpt) out.push('```text', r.excerpt, '```', '');
  }
  return out.join('\n');
}
