import { describe, expect, it } from 'vitest';
import { itemsByPriority } from '../src/editorial/author-input.js';
import { auditDraft, type EditorialAudit } from '../src/editorial/audit.js';
import { analyzeDryness } from '../src/editorial/dryness.js';
import { parseDraft, resolveLocation } from '../src/editorial/draft.js';
import { buildPatternTransfer, type PatternTransfer } from '../src/editorial/pattern-transfer.js';
import { authorInput, provenance, snapshot } from './editorial-helpers.js';

const DRAFT = `---
platform: habr
status: draft
---

# Аудит, который начал помнить

<!-- революционный: this comment is not published -->

Каждый запуск заканчивался отчётом, где новая находка стояла рядом со старой. Отчёт каждый раз строился с нуля.

Можно сказать, что у аудита была амнезия.

## Находка получает состояние

Finding перестал быть
просто строкой в отчёте.
`;

const input = authorInput();
const by = itemsByPriority(input);
const pt: PatternTransfer = (() => {
  const p = buildPatternTransfer({ story: 'notegarden-health-model', platform: 'habr', now: 'n', basedOn: provenance(), snapshot: { snapshot: snapshot(), file: 'r.json' } });
  p.items = p.items.map((i) => (i.id === 'body-conflict-early' ? { ...i, decision: 'apply', rationale: 'r', placement: ['opening'], consequence: 'Open on the conflict.' } : { ...i, decision: 'skip', rationale: 'r' }));
  return p;
})();

const audit = (draft = DRAFT, previous?: EditorialAudit) =>
  auditDraft({ draftMarkdown: draft, output: 'outputs/habr.md', story: 'notegarden-health-model', platform: 'habr', authorInput: input, patternTransfer: pt, styleProfile: 'ru-technical', now: '2026-09-25T10:00:00.000Z', ...(previous ? { previous } : {}) });

function record(a: EditorialAudit, material: Record<string, object>, patterns: Record<string, object> = {}): EditorialAudit {
  return { ...a, material: a.material.map((m) => ({ ...m, ...(material[m.itemId] ?? {}) })), patterns: a.patterns.map((p) => ({ ...p, ...(patterns[p.patternId] ?? {}) })) } as EditorialAudit;
}

const item = (a: EditorialAudit, id: string) => a.material.find((m) => m.itemId === id)!;

describe('editorial audit', () => {
  it('VERBATIM present (whitespace-normalised only) → pass, with the detected line', () => {
    const v = item(audit(), by.verbatim[0]!.id);
    expect(v).toMatchObject({ status: 'incorporated', detection: 'exact', result: 'pass' });
    expect(v.detected[0]!.line).toBe(16);
  });

  it('VERBATIM absent or materially rewritten → error', () => {
    const rewritten = audit(DRAFT.replace('Finding перестал быть\nпросто строкой в отчёте.', 'Finding больше не просто строка в отчёте.'));
    expect(item(rewritten, by.verbatim[0]!.id)).toMatchObject({ status: 'missing', result: 'error' });
    const recased = audit(DRAFT.replace('Finding перестал', 'finding перестал'));
    expect(item(recased, by.verbatim[0]!.id).message).toMatch(/case-different variant is at line 16; that is not the exact phrase/);
  });

  it('MUST mapped to a real location → pass; unmapped → error', () => {
    const must = by.must[0]!.id;
    const first = audit();
    expect(item(first, must)).toMatchObject({ status: 'unmapped', result: 'error' });
    const mapped = audit(DRAFT, record(first, { [must]: { status: 'incorporated', location: { paragraphs: [1, 1], excerpt: 'строился с нуля' } } }));
    expect(item(mapped, must)).toMatchObject({ status: 'incorporated', detection: 'agent', result: 'pass' });
    expect(mapped.summary.must).toEqual({ total: 1, incorporated: 1, omitted: 0, unmapped: 0 });
  });

  it('a recorded location must exist and contain its excerpt', () => {
    const must = by.must[0]!.id;
    const bad = audit(DRAFT, record(audit(), { [must]: { status: 'incorporated', location: { paragraphs: [9, 9] } } }));
    expect(item(bad, must).message).toMatch(/paragraph 9 does not exist \(the output has 3\)/);
    const wrong = audit(DRAFT, record(audit(), { [must]: { status: 'incorporated', location: { paragraphs: [2, 2], excerpt: 'строился с нуля' } } }));
    expect(item(wrong, must).result).toBe('error');
    const noLoc = audit(DRAFT, record(audit(), { [must]: { status: 'incorporated' } }));
    expect(item(noLoc, must).message).toMatch(/without an output location/);
  });

  it('MUST omitted with a reason → warning; without a reason → error', () => {
    const must = by.must[0]!.id;
    expect(item(audit(DRAFT, record(audit(), { [must]: { status: 'omitted', reason: 'Author agreed to drop it.' } })), must).result).toBe('warning');
    expect(item(audit(DRAFT, record(audit(), { [must]: { status: 'omitted', reason: '' } })), must).result).toBe('error');
  });

  it('SHOULD unmapped → warning; MAY unused → nothing', () => {
    const a = audit();
    expect(item(a, by.should[0]!.id)).toMatchObject({ status: 'unmapped', result: 'warning' });
    expect(item(a, by.may[0]!.id)).toMatchObject({ status: 'unmapped', result: 'pass', message: '' });
    expect(a.issues.some((i) => i.message.includes(by.may[0]!.text))).toBe(false);
    expect(a.summary.may).toEqual({ used: 0, unused: 1 });
  });

  it('DO NOT USE exact phrase in publishable text → error (comments do not count)', () => {
    const avoid = by.avoid[0]!.id;
    expect(item(audit(), avoid)).toMatchObject({ status: 'clear', result: 'pass', semanticReview: 'pending' });
    const bad = audit(DRAFT.replace('Можно сказать,', 'Это Революционный шаг. Можно сказать,'));
    expect(item(bad, avoid)).toMatchObject({ status: 'violated', result: 'error' });
    expect(item(bad, avoid).detected[0]!.line).toBe(12);
    const semantic = audit(DRAFT, record(audit(), { [avoid]: { semanticReview: 'violated', reason: 'paraphrased as "переворот"' } }));
    expect(item(semantic, avoid).result).toBe('error');
  });

  it('a selected pattern without a mapping → warning; mapped → pass', () => {
    const a = audit();
    expect(a.patterns).toHaveLength(1);
    expect(a.patterns[0]).toMatchObject({ patternId: 'body-conflict-early', status: 'unmapped', result: 'warning' });
    const mapped = audit(DRAFT, record(a, {}, { 'body-conflict-early': { status: 'incorporated', location: { paragraphs: [1, 2] } } }));
    expect(mapped.patterns[0]!.result).toBe('pass');
    expect(mapped.summary.patterns).toEqual({ expected: 1, incorporated: 1, overridden: 0, missing: 0 });
  });

  it('an explicit author override suppresses the trend warning', () => {
    const overridden = audit(DRAFT, record(audit(), {}, { 'body-conflict-early': { status: 'overridden-by-author', reason: 'The author wants a chronological opening.' } }));
    expect(overridden.patterns[0]).toMatchObject({ status: 'overridden-by-author', result: 'info' });
    expect(overridden.issues.some((i) => i.area === 'patterns')).toBe(false);
    expect(overridden.summary.patterns.overridden).toBe(1);
  });

  it('marks style findings inside a VERBATIM phrase as author-provided', () => {
    const custom = auditDraft({ draftMarkdown: '# T\n\nЭто мощный инструмент для заметок, честно.\n', output: 'o.md', story: 's', platform: 'habr', authorInput: authorInput('## VERBATIM\n\n- "Это мощный инструмент для заметок, честно."\n'), styleProfile: 'ru-technical', now: 'n' });
    const f = custom.style.findings.find((x) => x.rule === 'marketing')!;
    expect(f.authorProvided).toBe(true);
    expect(custom.issues.find((i) => i.area === 'style')?.severity).toBe('info');
  });

  it('warns when a line reuses a researched title', () => {
    const a = auditDraft({ draftMarkdown: '# Почему мой кэш врал три месяца подряд\n\nТекст.\n', output: 'o.md', story: 's', platform: 'habr', styleProfile: 'ru-technical', snapshot: snapshot(), now: 'n' });
    expect(a.originality[0]).toMatchObject({ articleId: 'habr:2', line: 1 });
  });

  it('flags missing plans and stale author input', () => {
    const a = audit();
    expect(a.issues.some((i) => /No editorial plan/.test(i.message))).toBe(true);
  });
});

describe('dryness metrics (advisory)', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ');

  it('flags documentation-like structure without producing a score', () => {
    const spec = ['# T', '', '## Проблема', '', `${words(80)}.`, '', '## Решение', '', `${words(80)}.`, '', '## Результаты', '', ...Array.from({ length: 12 }, (_, i) => `- пункт ${i} ${words(8)}`), '', '## Ограничения', '', `${words(80)}.`].join('\n');
    const r = analyzeDryness(parseDraft(spec));
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toContain('mirrors-story-structure');
    expect(rules).toContain('list-density');
    expect(r.metrics.storyFieldHeadings).toEqual(['проблема', 'решение', 'результаты', 'ограничения']);
    expect(Object.keys(r)).not.toContain('score');
  });

  it('warns (not errors) when a first-person style has no first person', async () => {
    const { loadStyleCatalog } = await import('../src/editorial/styles.js');
    const { STYLES_DIR } = await import('./editorial-helpers.js');
    const style = (await loadStyleCatalog({ builtInDir: STYLES_DIR })).get('engineering-story').preset;
    const text = `# T\n\n${words(320)}.\n`;
    const f = analyzeDryness(parseDraft(text), { style }).findings.find((x) => x.rule === 'no-first-person');
    expect(f?.severity).toBe('warning');
    expect(analyzeDryness(parseDraft(`# T\n\nЯ ${words(320)}.\n`), { style }).findings.some((x) => x.rule === 'no-first-person')).toBe(false);
  });

  it('counts short-paragraph runs and definition openings', () => {
    const choppy = Array.from({ length: 6 }, (_, i) => `Коротко ${i}.`).join('\n\n');
    expect(analyzeDryness(parseDraft(choppy)).findings.map((f) => f.rule)).toContain('short-paragraph-run');
    const glossary = ['Finding — это находка.', 'Health — это оценка.', 'Pipeline — это конвейер.'].join('\n\n');
    expect(analyzeDryness(parseDraft(glossary)).metrics.definitionOpenings).toBe(3);
  });

  it('resolves locations by heading and lines', () => {
    const d = parseDraft(DRAFT);
    expect('text' in resolveLocation(d, { heading: 'Находка получает состояние', excerpt: 'Finding перестал быть просто строкой' })).toBe(true);
    expect(resolveLocation(d, { lines: [8, 8] })).toEqual({ error: 'the location contains no publishable text (only comments or blank lines)' });
    expect(resolveLocation(d, { heading: 'Нет такого' })).toEqual({ error: 'heading "Нет такого" does not exist' });
  });
});
