import { describe, expect, it } from 'vitest';
import { itemsByPriority } from '../src/editorial/author-input.js';
import { buildPatternTransfer, validatePatternTransfer, type PatternTransfer } from '../src/editorial/pattern-transfer.js';
import { compareProvenance } from '../src/editorial/provenance.js';
import { authorInput, provenance, snapshot } from './editorial-helpers.js';

const NOW = '2026-09-25T10:00:00.000Z';
const build = (previous?: PatternTransfer) => buildPatternTransfer({ story: 'notegarden-health-model', platform: 'habr', now: NOW, basedOn: provenance(), snapshot: { snapshot: snapshot(), file: '.editorial/research/2026-09-24/habr.json' }, ...(previous ? { previous } : {}) });

function decide(pt: PatternTransfer, id: string, patch: Partial<PatternTransfer['items'][number]>): PatternTransfer {
  return { ...pt, items: pt.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

const APPLY = { decision: 'apply' as const, decidedBy: 'agent' as const, rationale: 'The story has a real, evidenced conflict.', placement: ['opening'], consequence: 'Open with the noisy report before the history.' };

describe('pattern transfer', () => {
  it('copies observations with source, strength, sample and provenance from the compressed snapshot', () => {
    const pt = build();
    const item = pt.items.find((i) => i.id === 'body-conflict-early')!;
    expect(item.observation).toMatch(/concrete technical problem within the first 150 words/);
    expect(item.strength).toBe('moderate');
    expect(item.sample).toEqual({ window: 'weekly', size: 3, groupSize: 2, comparisonSize: 1 });
    expect(item.provenance).toEqual({ snapshot: '.editorial/research/2026-09-24/habr.json', collectedAt: '2026-09-24T12:00:00.000Z', status: 'cache', supportingArticleIds: ['habr:1', 'habr:2'] });
    expect(item.limitations).toEqual(['Small sample (N=3); treat as anecdotal.']);
    expect(item.decision).toBe('pending');
    expect(pt.items.find((i) => i.id === 'saturated:ai-generic')?.kind).toBe('saturated-angle');
    expect(pt.safeguards.join(' ')).toMatch(/Do not copy any title/);
  });

  it('weak observations start as skipped by rule and may stay skipped', () => {
    const weak = build().items.find((i) => i.id === 'median-title-length')!;
    expect(weak).toMatchObject({ decision: 'skip', decidedBy: 'rule', skipReason: 'weak-sample' });
    const resolved = decide(decide(build(), 'body-conflict-early', APPLY), 'saturated:ai-generic', { decision: 'skip', decidedBy: 'agent', skipReason: 'does-not-fit-story', rationale: 'No AI framing in this story.' });
    expect(validatePatternTransfer(resolved, { authorInput: authorInput(), snapshot: snapshot() })).toEqual([]);
  });

  it('every non-pending item needs a decision and a rationale', () => {
    const issues = validatePatternTransfer(build(), {}).map((i) => i.message);
    expect(issues).toContain('pattern "body-conflict-early": decision pending (apply, adapt or skip).');
    const noRationale = decide(build(), 'body-conflict-early', { ...APPLY, rationale: '' });
    expect(validatePatternTransfer(noRationale, {}).map((i) => i.message)).toContain('pattern "body-conflict-early": decision "apply" has no rationale.');
  });

  it('applied patterns require a placement and a concrete consequence', () => {
    const pt = decide(build(), 'body-conflict-early', { ...APPLY, placement: [], consequence: 'TODO(agent): later' });
    const messages = validatePatternTransfer(pt, {}).map((i) => i.message);
    expect(messages).toContain('pattern "body-conflict-early": "apply" requires a placement (where in the article).');
    expect(messages).toContain('pattern "body-conflict-early": "apply" requires the concrete editorial consequence for this article.');
  });

  it('skipped patterns require a rationale', () => {
    const pt = decide(build(), 'saturated:ai-generic', { decision: 'skip', decidedBy: 'agent', rationale: '' });
    expect(validatePatternTransfer(pt, {}).map((i) => i.message)).toContain('pattern "saturated:ai-generic": decision "skip" has no rationale.');
  });

  it('refuses external article text in the artifact', () => {
    const pt = decide(build(), 'body-conflict-early', { ...APPLY, consequence: 'Title it like "Почему мой кэш врал три месяца подряд" with our nouns.' });
    const errors = validatePatternTransfer(pt, { snapshot: snapshot() }).filter((i) => i.severity === 'error');
    expect(errors.some((e) => /repeats wording of researched article habr:2/.test(e.message))).toBe(true);
    // Observations themselves are abstract and never contain titles.
    expect(JSON.stringify(build())).not.toMatch(/кэш врал|потеряли данные|Нейросеть пишет/);
  });

  it('author MUST material takes precedence over a conflicting advisory trend', () => {
    const must = itemsByPriority(authorInput()).must[0]!;
    const conflicting = decide(build(), 'body-conflict-early', { ...APPLY, conflictsWithAuthorItems: [must.id] });
    expect(validatePatternTransfer(conflicting, { authorInput: authorInput() }).some((i) => i.severity === 'error' && /Explicit author material takes precedence/.test(i.message))).toBe(true);
    const adapted = decide(conflicting, 'body-conflict-early', { decision: 'adapt' });
    expect(validatePatternTransfer(adapted, { authorInput: authorInput() }).some((i) => /takes precedence/.test(i.message))).toBe(false);
  });

  it('a pattern consequence cannot introduce DO NOT USE wording', () => {
    const pt = decide(build(), 'body-conflict-early', { ...APPLY, consequence: 'Call the change революционный in the opening.' });
    expect(validatePatternTransfer(pt, { authorInput: authorInput() }).some((i) => /DO NOT USE forbids/.test(i.message))).toBe(true);
  });

  it('keeps decisions on refresh when the observation is unchanged, and resets changed ones', () => {
    const decided = decide(build(), 'body-conflict-early', APPLY);
    expect(build(decided).items.find((i) => i.id === 'body-conflict-early')?.decision).toBe('apply');
    const changed = { ...decided, items: decided.items.map((i) => (i.id === 'body-conflict-early' ? { ...i, observation: 'older wording' } : i)) };
    expect(build(changed).items.find((i) => i.id === 'body-conflict-early')?.decision).toBe('pending');
  });

  it('detects research snapshot drift', () => {
    const recorded = provenance();
    const modified = provenance({ research: { ...recorded.research!, hash: 'different' } });
    const newer = provenance({ research: { ...recorded.research!, file: '.editorial/research/2026-10-01/habr.json', collectedAt: '2026-10-01T09:00:00.000Z', hash: 'x' } });
    expect(compareProvenance(recorded, modified, 'pattern transfer')[0]!.message).toBe('research snapshot .editorial/research/2026-09-24/habr.json was modified since pattern transfer was created');
    expect(compareProvenance(recorded, newer, 'pattern transfer')[0]!.message).toBe('research snapshot changed (2026-09-24 → 2026-10-01) since pattern transfer was created');
    expect(compareProvenance(recorded, provenance({ research: null }), 'pattern transfer')[0]!.message).toBe('research snapshot is gone since pattern transfer was created');
  });

  it('without research, the artifact is valid and empty', () => {
    const pt = buildPatternTransfer({ story: 's', platform: 'linkedin', now: NOW, basedOn: provenance({ research: null }) });
    expect(pt.items).toEqual([]);
    expect(pt.notes[0]).toMatch(/No research snapshot/);
    expect(validatePatternTransfer(pt, {})).toEqual([]);
  });
});
