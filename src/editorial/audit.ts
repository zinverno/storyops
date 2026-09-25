import { z } from 'zod';
import { checkStyle } from '../author/style-check.js';
import type { ResearchSnapshot } from '../research/types.js';
import { hashText } from '../shared/hash.js';
import { mdList } from '../shared/markdown.js';
import { abbreviate, containsPhrase, findPhrase, forbiddenPhrases, verbatimPhrase, type AuthorInput, type AuthorInputItem } from './author-input.js';
import { isUnresolved } from './common.js';
import type { EditorialDirection } from './direction.js';
import { lineAt, locationSchema, paragraphAtLine, paragraphIndex, parseDraft, resolveLocation, type OutputLocation, type ParsedDraft } from './draft.js';
import { analyzeDryness } from './dryness.js';
import { findExternalOverlap } from './originality.js';
import type { PatternTransfer } from './pattern-transfer.js';
import type { StylePreset } from './styles.js';
import type { VoicePlan } from './voice-plan.js';

/**
 * Post-draft editorial audit. Deterministic where determinism is honest:
 * VERBATIM phrases and DO NOT USE phrases are checked literally; locations
 * the agent records are verified to exist and to contain their excerpt.
 * Semantic incorporation (MUST/SHOULD ideas, applied patterns) is recorded by
 * the agent in audit.json and the CLI checks that the record exists and
 * points at real text. There are no confidence percentages and no quality score.
 */

export const EDITORIAL_AUDIT_SCHEMA_VERSION = 1;

const resultSchema = z.enum(['pass', 'error', 'warning', 'info']);

export const materialAuditSchema = z.object({
  itemId: z.string(),
  priority: z.string(),
  section: z.string(),
  text: z.string(),
  /** Agent-editable for MUST/SHOULD/MAY/BACKGROUND/raw notes: incorporated | omitted | unmapped. Computed for VERBATIM and DO NOT USE. */
  status: z.enum(['incorporated', 'omitted', 'unmapped', 'missing', 'violated', 'clear']),
  detection: z.enum(['exact', 'agent', 'none']).default('none'),
  location: locationSchema.optional(),
  detected: z.array(z.object({ line: z.number().int(), paragraph: z.number().int().optional(), excerpt: z.string() })).default([]),
  reason: z.string().default(''),
  /** DO NOT USE only: the agent's semantic review (paraphrased violations are not detectable lexically). */
  semanticReview: z.enum(['pending', 'clear', 'violated']).optional(),
  result: resultSchema.default('pass'),
  message: z.string().default(''),
});
export type MaterialAudit = z.infer<typeof materialAuditSchema>;

export const patternAuditSchema = z.object({
  patternId: z.string(),
  decision: z.string(),
  expectedPlacement: z.array(z.string()),
  consequence: z.string(),
  /** Agent-editable: incorporated | overridden-by-author | not-used | unmapped. */
  status: z.enum(['unmapped', 'incorporated', 'overridden-by-author', 'not-used']),
  location: locationSchema.optional(),
  reason: z.string().default(''),
  result: resultSchema.default('pass'),
  message: z.string().default(''),
});
export type PatternAudit = z.infer<typeof patternAuditSchema>;

const issueSchema = z.object({ severity: z.enum(['error', 'warning', 'info']), area: z.string(), message: z.string() });

export const editorialAuditSchema = z.object({
  schemaVersion: z.literal(EDITORIAL_AUDIT_SCHEMA_VERSION),
  story: z.string(),
  platform: z.string(),
  output: z.string(),
  outputHash: z.string(),
  generatedAt: z.string(),
  authorInputHash: z.string().nullable(),
  plan: z.object({ direction: z.boolean(), patternTransfer: z.boolean(), voicePlan: z.boolean(), style: z.string().nullable() }),
  summary: z.object({
    verbatim: z.object({ total: z.number().int(), incorporated: z.number().int() }),
    must: z.object({ total: z.number().int(), incorporated: z.number().int(), omitted: z.number().int(), unmapped: z.number().int() }),
    should: z.object({ total: z.number().int(), incorporated: z.number().int(), omitted: z.number().int(), unmapped: z.number().int() }),
    may: z.object({ used: z.number().int(), unused: z.number().int() }),
    avoid: z.object({ total: z.number().int(), violations: z.number().int() }),
    patterns: z.object({ expected: z.number().int(), incorporated: z.number().int(), overridden: z.number().int(), missing: z.number().int() }),
    errors: z.number().int(),
    warnings: z.number().int(),
  }),
  material: z.array(materialAuditSchema),
  patterns: z.array(patternAuditSchema),
  voice: z.object({ words: z.number(), metrics: z.record(z.string(), z.unknown()), findings: z.array(z.object({ rule: z.string(), severity: z.string(), message: z.string() })) }),
  style: z.object({
    profile: z.string(),
    metrics: z.record(z.string(), z.number()),
    findings: z.array(z.object({ rule: z.string(), severity: z.string(), message: z.string(), line: z.number().optional(), excerpt: z.string().optional(), authorProvided: z.boolean().default(false) })),
  }),
  originality: z.array(z.object({ articleId: z.string(), sequence: z.string(), line: z.number().int() })),
  calibration: z.object({ required: z.boolean(), status: z.string() }).nullable(),
  issues: z.array(issueSchema),
});
export type EditorialAudit = z.infer<typeof editorialAuditSchema>;

export interface AuditInput {
  draftMarkdown: string;
  output: string;
  story: string;
  platform: string;
  authorInput?: AuthorInput;
  direction?: EditorialDirection;
  patternTransfer?: PatternTransfer;
  voicePlan?: VoicePlan;
  style?: StylePreset;
  styleProfile: string;
  snapshot?: ResearchSnapshot;
  /** Previous audit.json: the agent's incorporation records are read from it and preserved. */
  previous?: EditorialAudit;
  now: string;
}

function detections(draft: ParsedDraft, phrase: string, caseInsensitive: boolean): MaterialAudit['detected'] {
  const found: MaterialAudit['detected'] = [];
  let offset = 0;
  let rest = draft.publishable;
  for (let guard = 0; guard < 20; guard += 1) {
    const i = findPhrase(rest, phrase, { caseInsensitive });
    if (i < 0) break;
    const line = lineAt(draft, offset + i);
    const paragraph = paragraphAtLine(draft, line);
    found.push({ line, ...(paragraph !== undefined ? { paragraph } : {}), excerpt: abbreviate(rest.slice(i, i + phrase.length + 20), 100) });
    offset += i + Math.max(1, phrase.length);
    rest = draft.publishable.slice(offset);
  }
  return found;
}

function checkAgentMapping(entry: MaterialAudit, draft: ParsedDraft, level: 'error' | 'warning' | 'none'): MaterialAudit {
  const label = `${entry.priority.toUpperCase()} "${abbreviate(entry.text, 70)}"`;
  if (entry.status === 'incorporated') {
    if (!entry.location) return { ...entry, detection: 'agent', result: 'error', message: `${label} is marked incorporated without an output location.` };
    const r = resolveLocation(draft, entry.location);
    if ('error' in r) return { ...entry, detection: 'agent', result: 'error', message: `${label}: recorded location is invalid (${r.error}).` };
    return { ...entry, detection: 'agent', result: 'pass', message: '' };
  }
  if (entry.status === 'omitted') {
    if (isUnresolved(entry.reason)) return { ...entry, result: level === 'none' ? 'info' : 'error', message: `${label} is omitted without a reason.` };
    return { ...entry, result: level === 'error' ? 'warning' : 'info', message: `${label} omitted: ${entry.reason}` };
  }
  if (level === 'none') return { ...entry, status: 'unmapped', result: 'pass', message: '' };
  return { ...entry, status: 'unmapped', result: level, message: `${label} has no incorporation record (map it to an output location, or mark it omitted with a reason).` };
}

function auditItem(item: AuthorInputItem, draft: ParsedDraft, previous: MaterialAudit | undefined): MaterialAudit {
  const base: MaterialAudit = { itemId: item.id, priority: item.priority, section: item.section, text: item.text, status: 'unmapped', detection: 'none', detected: [], reason: previous?.reason ?? '', result: 'pass', message: '' };
  if (item.priority === 'verbatim') {
    const phrase = verbatimPhrase(item);
    const hits = detections(draft, phrase, false);
    if (hits.length) return { ...base, status: 'incorporated', detection: 'exact', detected: hits, location: { lines: [hits[0]!.line, hits[0]!.line] }, result: 'pass' };
    const near = detections(draft, phrase, true);
    return { ...base, status: 'missing', result: 'error', detected: [], message: `VERBATIM phrase not found exactly: "${abbreviate(phrase, 90)}".${near.length ? ` A case-different variant is at line ${near[0]!.line}; that is not the exact phrase.` : ''} Only whitespace differences are tolerated.` };
  }
  if (item.priority === 'avoid') {
    const hits = forbiddenPhrases(item).flatMap((p) => detections(draft, p, true));
    const semanticReview = previous?.semanticReview ?? 'pending';
    if (hits.length) return { ...base, status: 'violated', detection: 'exact', detected: hits, semanticReview, result: 'error', message: `DO NOT USE "${abbreviate(item.text, 70)}" appears at line ${hits.map((h) => h.line).join(', ')}.` };
    if (semanticReview === 'violated') return { ...base, status: 'violated', detection: 'agent', semanticReview, result: 'error', message: `DO NOT USE "${abbreviate(item.text, 70)}": agent review found a paraphrased violation.${base.reason ? ` ${base.reason}` : ''}` };
    return { ...base, status: 'clear', semanticReview, result: 'pass', message: semanticReview === 'pending' ? 'No literal match; paraphrases need agent review (semanticReview).' : '' };
  }
  const entry: MaterialAudit = { ...base, status: previous?.status && ['incorporated', 'omitted', 'unmapped'].includes(previous.status) ? previous.status : 'unmapped', ...(previous?.location ? { location: previous.location as OutputLocation } : {}) };
  // An idea written word for word is found without an agent record.
  if (entry.status === 'unmapped' && item.text.length >= 12) {
    const hits = detections(draft, item.text, false);
    if (hits.length) return { ...entry, status: 'incorporated', detection: 'exact', detected: hits, location: { lines: [hits[0]!.line, hits[0]!.line] }, result: 'pass' };
  }
  switch (item.priority) {
    case 'must':
      return checkAgentMapping(entry, draft, 'error');
    case 'should':
      return checkAgentMapping(entry, draft, 'warning');
    case 'background': {
      const r = checkAgentMapping(entry, draft, 'none');
      return r.status === 'incorporated' && r.result === 'pass' ? { ...r, result: 'info', message: 'BACKGROUND material was published; make sure the author promoted it.' } : r;
    }
    default:
      return checkAgentMapping(entry, draft, 'none');
  }
}

function auditPatterns(pt: PatternTransfer, draft: ParsedDraft, previous: EditorialAudit | undefined): PatternAudit[] {
  const prev = new Map((previous?.patterns ?? []).map((p) => [p.patternId, p]));
  return pt.items
    .filter((p) => p.decision === 'apply' || p.decision === 'adapt')
    .map((p) => {
      const old = prev.get(p.id);
      const entry: PatternAudit = { patternId: p.id, decision: p.decision, expectedPlacement: p.placement, consequence: p.consequence, status: old?.status ?? 'unmapped', ...(old?.location ? { location: old.location as OutputLocation } : {}), reason: old?.reason ?? '', result: 'pass', message: '' };
      if (entry.status === 'incorporated') {
        if (!entry.location) return { ...entry, result: 'error' as const, message: `Pattern "${p.id}" is marked incorporated without an output location.` };
        const r = resolveLocation(draft, entry.location);
        return 'error' in r ? { ...entry, result: 'error' as const, message: `Pattern "${p.id}": recorded location is invalid (${r.error}).` } : entry;
      }
      if (entry.status === 'overridden-by-author') {
        return isUnresolved(entry.reason) ? { ...entry, result: 'warning' as const, message: `Pattern "${p.id}" is marked overridden by the author without a note.` } : { ...entry, result: 'info' as const, message: `Overridden by author: ${entry.reason}` };
      }
      if (entry.status === 'not-used') return { ...entry, result: 'warning' as const, message: `Pattern "${p.id}" was selected (${p.decision}) but not used${entry.reason ? `: ${entry.reason}` : ''}.` };
      return { ...entry, result: 'warning' as const, message: `Pattern "${p.id}" was selected (${p.decision}, expected: ${p.placement.join(', ') || '?'}) but is not mapped to the output.` };
    });
}

export function auditDraft(input: AuditInput): EditorialAudit {
  const draft = parseDraft(input.draftMarkdown);
  const prevMaterial = new Map((input.previous?.material ?? []).map((m) => [m.itemId, m]));
  const items = (input.authorInput?.items ?? []).filter((i) => i.priority !== 'question');
  const material = items.map((item) => auditItem(item, draft, prevMaterial.get(item.id)));
  const patterns = input.patternTransfer ? auditPatterns(input.patternTransfer, draft, input.previous) : [];

  const verbatimPhrases = items.filter((i) => i.priority === 'verbatim').map(verbatimPhrase);
  const styleReport = checkStyle(input.draftMarkdown, input.styleProfile);
  const styleFindings = styleReport.findings.map((f) => ({ ...f, authorProvided: Boolean(f.excerpt && verbatimPhrases.some((p) => containsPhrase(p, f.excerpt!, { caseInsensitive: true }))) }));
  const voice = analyzeDryness(draft, input.style ? { style: input.style } : {});

  const originality = input.snapshot
    ? findExternalOverlap(
        draft.publishable.split('\n').map((text, i) => ({ where: String(i + 1), text })),
        input.snapshot.articles.map((a) => ({ id: a.id, text: a.title })),
      ).map((m) => ({ articleId: m.id, sequence: m.sequence, line: Number(m.where) }))
    : [];

  const issues: EditorialAudit['issues'] = [];
  if (!input.authorInput) issues.push({ severity: 'info', area: 'author-input', message: 'No author-input.md: nothing to audit for author material.' });
  for (const i of input.authorInput?.issues ?? []) issues.push({ severity: i.severity, area: 'author-input', message: i.message });
  if (!input.direction || !input.voicePlan) issues.push({ severity: 'warning', area: 'plan', message: 'No editorial plan (direction + voice plan) for this platform. Run `editorial-kit editorial plan` before drafting long-form prose.' });
  if (input.voicePlan && input.authorInput?.sourceHash && input.voicePlan.basedOn.authorInput?.hash !== input.authorInput.sourceHash) {
    issues.push({ severity: 'warning', area: 'plan', message: 'author input changed since voice plan was created; review the plan (`editorial-kit editorial plan` then `editorial validate`).' });
  }
  for (const m of material) if (m.result === 'error' || m.result === 'warning') issues.push({ severity: m.result, area: 'author-material', message: m.message });
  for (const p of patterns) if (p.result === 'error' || p.result === 'warning') issues.push({ severity: p.result, area: 'patterns', message: p.message });
  for (const f of voice.findings) issues.push({ severity: f.severity, area: 'voice', message: f.message });
  for (const f of styleFindings.filter((x) => x.severity !== 'info')) issues.push({ severity: f.authorProvided ? 'info' : f.severity === 'error' ? 'error' : 'warning', area: 'style', message: `[${f.rule}]${f.line ? ` line ${f.line}` : ''} ${f.message}${f.authorProvided ? ' (inside an author VERBATIM phrase: author material wins)' : ''}` });
  for (const o of originality) issues.push({ severity: 'warning', area: 'originality', message: `Line ${o.line} shares "${o.sequence}" with the title of researched article ${o.articleId}. Do not reuse or template external titles.` });
  const calibration = input.voicePlan ? { required: input.voicePlan.calibration.required, status: input.voicePlan.calibration.status } : null;
  if (calibration?.required && calibration.status === 'pending') issues.push({ severity: 'info', area: 'calibration', message: 'Long-form draft without a recorded voice calibration (voice plan calibration.status is "pending").' });

  const count = (prio: string, status?: string) => material.filter((m) => m.priority === prio && (!status || m.status === status)).length;
  const summary: EditorialAudit['summary'] = {
    verbatim: { total: count('verbatim'), incorporated: count('verbatim', 'incorporated') },
    must: { total: count('must'), incorporated: material.filter((m) => m.priority === 'must' && m.status === 'incorporated' && m.result === 'pass').length, omitted: count('must', 'omitted'), unmapped: count('must', 'unmapped') },
    should: { total: count('should'), incorporated: material.filter((m) => m.priority === 'should' && m.status === 'incorporated' && m.result === 'pass').length, omitted: count('should', 'omitted'), unmapped: count('should', 'unmapped') },
    may: { used: material.filter((m) => (m.priority === 'may' || m.priority === 'unclassified') && m.status === 'incorporated').length, unused: material.filter((m) => (m.priority === 'may' || m.priority === 'unclassified') && m.status !== 'incorporated').length },
    avoid: { total: count('avoid'), violations: count('avoid', 'violated') },
    patterns: { expected: patterns.length, incorporated: patterns.filter((p) => p.status === 'incorporated' && p.result === 'pass').length, overridden: patterns.filter((p) => p.status === 'overridden-by-author').length, missing: patterns.filter((p) => p.status === 'unmapped' || p.status === 'not-used').length },
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
  return editorialAuditSchema.parse({
    schemaVersion: EDITORIAL_AUDIT_SCHEMA_VERSION,
    story: input.story,
    platform: input.platform,
    output: input.output,
    outputHash: hashText(input.draftMarkdown),
    generatedAt: input.now,
    authorInputHash: input.authorInput?.sourceHash ?? null,
    plan: { direction: Boolean(input.direction), patternTransfer: Boolean(input.patternTransfer), voicePlan: Boolean(input.voicePlan), style: input.style?.id ?? input.direction?.style.id ?? null },
    summary,
    material,
    patterns,
    voice: { words: voice.words, metrics: voice.metrics, findings: voice.findings },
    style: { profile: styleReport.profile, metrics: styleReport.metrics, findings: styleFindings },
    originality,
    calibration,
    issues,
  });
}

const mark = (ok: boolean) => (ok ? '✓' : '✗');

export function renderAudit(a: EditorialAudit, draftMarkdown: string): string {
  const s = a.summary;
  const out = [
    `# Editorial audit — ${a.story} (${a.platform})`,
    '',
    `Output: \`${a.output}\`. Generated ${a.generatedAt}. Style: ${a.plan.style ?? '—'}. Plan: direction ${a.plan.direction ? 'yes' : 'NO'}, pattern transfer ${a.plan.patternTransfer ? 'yes' : 'NO'}, voice plan ${a.plan.voicePlan ? 'yes' : 'NO'}.`,
    '',
    `**${s.errors} error(s), ${s.warnings} warning(s).** Structural checks cannot prove that prose is good; read the draft.`,
    '',
    '## Author material',
    '',
    '```text',
    `VERBATIM     ${mark(s.verbatim.incorporated === s.verbatim.total)} ${s.verbatim.incorporated}/${s.verbatim.total} incorporated exactly`,
    `MUST USE     ${mark(s.must.incorporated === s.must.total)} ${s.must.incorporated}/${s.must.total} incorporated${s.must.omitted ? `, ${s.must.omitted} omitted (reason recorded)` : ''}${s.must.unmapped ? `, ${s.must.unmapped} UNMAPPED` : ''}`,
    `SHOULD USE   ${s.should.incorporated === s.should.total ? '✓' : '○'} ${s.should.incorporated}/${s.should.total} incorporated${s.should.omitted ? `, ${s.should.omitted} omitted (reason recorded)` : ''}${s.should.unmapped ? `, ${s.should.unmapped} unmapped` : ''}`,
    `MAY USE      ${s.may.used} used, ${s.may.unused} unused`,
    `DO NOT USE   ${s.avoid.violations === 0 ? '✓ no direct violations detected' : `✗ ${s.avoid.violations} violation(s)`}`,
    `PATTERNS     ${s.patterns.incorporated}/${s.patterns.expected} selected patterns mapped${s.patterns.overridden ? `, ${s.patterns.overridden} overridden by author` : ''}${s.patterns.missing ? `, ${s.patterns.missing} not mapped` : ''}`,
    '```',
    '',
  ];
  for (const m of a.material) {
    const where = m.detected.length ? `lines ${m.detected.map((d) => d.line).join(', ')}${m.detected[0]?.paragraph ? ` (¶${m.detected[0].paragraph})` : ''}` : m.location ? describeLocation(m.location) : '—';
    out.push(`- [${m.priority}] **${m.status}** ${m.result !== 'pass' ? `(${m.result}) ` : ''}\`${m.itemId}\` — ${abbreviate(m.text, 100)}  \n  location: ${where}${m.detection !== 'none' ? ` (${m.detection})` : ''}${m.reason ? `; reason: ${m.reason}` : ''}${m.semanticReview ? `; semantic review: ${m.semanticReview}` : ''}${m.message ? `  \n  ${m.message}` : ''}`);
  }
  if (a.material.length === 0) out.push('_No author material._');
  out.push('', '## Pattern usage', '');
  if (a.patterns.length === 0) out.push('_No applied or adapted patterns._');
  for (const p of a.patterns) out.push(`- **${p.patternId}** (${p.decision}) expected: ${p.expectedPlacement.join(', ') || '—'} → ${p.status}${p.location ? ` at ${describeLocation(p.location)}` : ''}${p.message ? ` — ${p.message}` : ''}`);
  out.push(
    '',
    '## Voice and dryness (advisory)',
    '',
    `${a.voice.words} words. These are editorial warnings, not a score; never tune prose mechanically to silence them.`,
    '',
    mdList(a.voice.findings.map((f) => `${f.severity}: [${f.rule}] ${f.message}`), '_no dryness warnings_'),
    '',
    '## Style',
    '',
    `Profile \`${a.style.profile}\`: em dashes ${a.style.metrics.emDashPer1000 ?? 0}/1000, "не X, а Y" ${a.style.metrics.notXButYPer1000 ?? 0}/1000.`,
    '',
    mdList(a.style.findings.map((f) => `${f.severity}: [${f.rule}]${f.line ? ` line ${f.line}` : ''} ${f.message}${f.excerpt ? ` («${f.excerpt}»)` : ''}${f.authorProvided ? ' — author VERBATIM, keep' : ''}`), '_no style findings_'),
    '',
    '## Originality',
    '',
    mdList(a.originality.map((o) => `line ${o.line}: shares "${o.sequence}" with researched article ${o.articleId}`), '_no overlap with researched titles_'),
    '',
  );
  if (a.calibration) out.push('## Voice calibration', '', `${a.calibration.required ? 'Required' : 'Not required'}; status: ${a.calibration.status}.`, '');
  out.push('## Issues', '', mdList(a.issues.map((i) => `${i.severity}: [${i.area}] ${i.message}`), '_none_'), '');
  out.push(
    '## How to record incorporation',
    '',
    'Edit `material[]` / `patterns[]` in audit.json, then re-run `editorial-kit editorial audit`:',
    '`"status": "incorporated", "location": { "paragraphs": [3, 4], "excerpt": "short quote" }` or `"status": "omitted", "reason": "…"`.',
    'Patterns may also be `"overridden-by-author"` (with a reason). DO NOT USE items take `"semanticReview": "clear" | "violated"`.',
    '',
    '## Paragraph index',
    '',
    '```text',
    ...paragraphIndex(parseDraft(draftMarkdown)),
    '```',
    '',
  );
  return out.join('\n');
}

function describeLocation(l: OutputLocation): string {
  return [l.paragraphs ? `¶${l.paragraphs[0]}–${l.paragraphs[1]}` : '', l.lines ? `lines ${l.lines[0]}–${l.lines[1]}` : '', l.heading ? `§ ${l.heading}` : '', l.excerpt ? `«${abbreviate(l.excerpt, 50)}»` : ''].filter(Boolean).join(', ');
}
