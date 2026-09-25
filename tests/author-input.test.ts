import { describe, expect, it } from 'vitest';
import { addAuthorInputItem, authorInputTemplate, forbiddenPhrases, itemsByPriority, parseAuthorInput, verbatimPhrase } from '../src/editorial/author-input.js';
import { compareProvenance } from '../src/editorial/provenance.js';
import { AUTHOR_INPUT, authorInput, provenance } from './editorial-helpers.js';

describe('author input', () => {
  it('accepts an empty file and the empty template', () => {
    expect(parseAuthorInput('').items).toEqual([]);
    expect(parseAuthorInput('').issues).toEqual([]);
    const template = parseAuthorInput(authorInputTemplate('my-story'), { expectedStory: 'my-story' });
    expect(template.story).toBe('my-story');
    expect(template.items).toEqual([]);
    expect(template.issues).toEqual([]);
  });

  it('parses every priority section, including the non-publishable ones', () => {
    const src = `${AUTHOR_INPUT}
## BACKGROUND ONLY

- Only context.

## RAW NOTES

a loose thought

## PERSONAL CONTEXT

- I wrote it for my own vault.

## POSSIBLE HUMOR

- updatedAt got two jobs at once.

## QUESTIONS / UNCERTAINTIES

- Is this worth a separate article?
`;
    const input = parseAuthorInput(src);
    const by = itemsByPriority(input);
    expect(by.verbatim).toHaveLength(1);
    expect(by.must).toHaveLength(1);
    expect(by.should).toHaveLength(1);
    expect(by.may.map((i) => i.section).sort()).toEqual(['humor', 'may', 'personal-context']);
    expect(by.background).toHaveLength(1);
    expect(by.avoid).toHaveLength(1);
    expect(by.unclassified).toHaveLength(1);
    expect(by.question).toHaveLength(1);
    expect(input.items.find((i) => i.section === 'personal-context')?.authorExperience).toBe(true);
    expect(input.issues).toEqual([]);
  });

  it('keeps a VERBATIM phrase exactly (quotes are delimiters, not content)', () => {
    const input = authorInput();
    const v = itemsByPriority(input).verbatim[0]!;
    expect(v.text).toBe('Finding перестал быть просто строкой в отчёте.');
    expect(verbatimPhrase(v)).toBe('Finding перестал быть просто строкой в отчёте.');
    const guillemets = parseAuthorInput('## VERBATIM\n\n- «Поле устроилось на две работы.»\n');
    expect(guillemets.items[0]!.text).toBe('Поле устроилось на две работы.');
    const inner = parseAuthorInput('## VERBATIM\n\n- "a" and "b"\n');
    expect(inner.items[0]!.text).toBe('"a" and "b"');
  });

  it('reads Unicode and multi-line fragments as one item each', () => {
    const src = `## RAW NOTES

мне тут хочется сказать что сначала updatedAt вообще казался
нормальным решением, а потом оказалось что поле отвечает
за два разных смысла

- Finding перестал быть просто строкой в отчёте.
  И это главное.
- Можно пошутить, что updatedAt устроился сразу на две работы.
`;
    const input = parseAuthorInput(src);
    expect(input.items).toHaveLength(3);
    expect(input.items[0]!.text).toContain('нормальным решением');
    expect(input.items[0]!.lines).toEqual([3, 5]);
    expect(input.items[1]!.text).toBe('Finding перестал быть просто строкой в отчёте.\nИ это главное.');
    expect(input.items.every((i) => i.priority === 'unclassified')).toBe(true);
  });

  it('ignores HTML comments and reports unknown sections as raw notes', () => {
    const input = parseAuthorInput('## MUST USE\n\n<!-- guidance, not an item -->\n\n## SOMETHING ELSE\n\n- a thought\n');
    expect(input.items).toHaveLength(1);
    expect(input.items[0]!.section).toBe('raw-notes');
    expect(input.issues[0]!.message).toMatch(/Unknown section "SOMETHING ELSE"/);
  });

  it('rejects malformed frontmatter', () => {
    expect(() => parseAuthorInput('---\nstory: [unclosed\n---\n')).toThrow(/not valid YAML/);
    expect(() => parseAuthorInput('---\nstory: x\n')).toThrow(/never closed/);
    expect(() => parseAuthorInput('---\n- a\n- b\n---\n')).toThrow(/YAML mapping/);
    expect(() => parseAuthorInput('---\nschemaVersion: 2\n---\n')).toThrow(/unsupported schemaVersion 2/);
    expect(parseAuthorInput('---\nstory: other\n---\n', { expectedStory: 'mine' }).issues[0]!.message).toMatch(/belongs to story "other"/);
  });

  it('has a deterministic source hash and content-derived ids', () => {
    const a = authorInput();
    const b = authorInput(AUTHOR_INPUT.replace(/\n/g, '\r\n'));
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    expect(a.items[0]!.id).toMatch(/^verbatim-[0-9a-f]{8}$/);
  });

  it('an edit changes the hash, and recorded plans report drift', () => {
    const edited = authorInput(AUTHOR_INPUT.replace('революционный', 'революционный\n- инновационный'));
    const recorded = provenance();
    const current = provenance({ authorInput: { hash: edited.sourceHash, items: edited.items.length } });
    expect(edited.sourceHash).not.toBe(authorInput().sourceHash);
    const drift = compareProvenance(recorded, current, 'voice plan');
    expect(drift.map((d) => d.message)).toEqual(['author input (author-input.md) changed since voice plan was created']);
  });

  it('extracts literal DO NOT USE phrases from quotes inside an instruction', () => {
    expect(forbiddenPhrases({ text: 'не писать «революционный» и "game changer"' })).toEqual(['революционный', 'game changer']);
    expect(forbiddenPhrases({ text: 'революционный' })).toEqual(['революционный']);
  });

  it('surfaces a conflict between required material and DO NOT USE', () => {
    const input = parseAuthorInput('## MUST USE\n\n- Это революционный подход.\n\n## DO NOT USE\n\n- революционный\n');
    expect(input.issues.some((i) => i.severity === 'error' && /DO NOT USE wins/.test(i.message))).toBe(true);
  });

  it('adds items without disturbing the rest of the file', () => {
    const base = authorInputTemplate('s');
    const once = addAuthorInputItem(base, 'must', 'Explain the conflict.');
    const twice = addAuthorInputItem(once, 'must', 'Second point\nwith a second line');
    const parsed = parseAuthorInput(twice);
    expect(parsed.items.map((i) => [i.section, i.text])).toEqual([
      ['must', 'Explain the conflict.'],
      ['must', 'Second point\nwith a second line'],
    ]);
    expect(twice.split('## SHOULD USE')[1]).toBe(base.split('## SHOULD USE')[1]);
    const noSection = addAuthorInputItem('# Author input\n', 'avoid', 'x');
    expect(parseAuthorInput(noSection).items[0]!.section).toBe('avoid');
    expect(() => addAuthorInputItem(base, 'may', '   ')).toThrow(/empty/);
  });
});

describe('phrase matching', () => {
  it('matches whole words only, across line wrapping', async () => {
    const { findPhrase } = await import('../src/editorial/author-input.js');
    expect(findPhrase('в линии связи', 'ИИ', { caseInsensitive: true })).toBe(-1);
    expect(findPhrase('про ИИ и заметки', 'ии', { caseInsensitive: true })).toBe(4);
    expect(findPhrase('перестал\n  быть', 'перестал быть')).toBe(0);
    expect(findPhrase('Перестал быть', 'перестал быть')).toBe(-1);
  });
});
