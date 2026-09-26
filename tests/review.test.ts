import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../platforms/registry.js';
import { parseConfig } from '../src/config/load.js';
import { checkClaim, type RepoEvidence } from '../src/review/checks/factual.js';
import { loadProfileCatalog } from '../src/review/profiles.js';
import { alternativeAllowed, reviewArticle, type ReviewInput } from '../src/review/review.js';
import { setFindingStatus } from '../src/review/store.js';
import { sha256 } from '../src/shared/hash.js';
import { silentLogger } from '../src/shared/logger.js';
import { db, workspaceFor, type AppContext } from '../src/workflow/context.js';
import { reviewWorkflow } from '../src/workflow/review.js';
import { clock, FIXTURES, tempDir } from './helpers.js';

const base = (markdown: string, extra: Partial<ReviewInput> = {}): ReviewInput => ({ markdown, articlePath: '/tmp/a.md', articleKey: 'a.md', now: clock.now().toISOString(), languageProfile: 'ru-technical', maxAlternativeChars: 240, ...extra });

function workspace(dir: string): AppContext {
  const config = parseConfig({ author: { name: 'Test' } });
  return { workspace: workspaceFor(dir, config, path.join(dir, 'storyops.config.json')), config, configWarnings: [], registry: createDefaultRegistry(), clock, logger: silentLogger };
}

const LANGUAGE = `# Индексатор

Данная система позволяет осуществлять анализ заметок в хранилище.

Индекс хранит заметку, и каждая заметка попадает в индекс заметок только после проверки.

Когда пользователь открывает хранилище, индексатор сначала читает конфигурацию, потом обходит все папки, собирает список файлов, сравнивает его с сохранённым списком из предыдущего запуска, вычисляет хэши изменённых файлов, обновляет записи в базе и только после этого показывает пользователю первые результаты анализа в боковой панели.

Стоит отметить, что индексатор работает локально. Давайте разберёмся, как он устроен.
`;

describe('review: language, style, logic, factual, repetition', () => {
  it('reports канцеляризм with a local alternative, a repeated word, a very long sentence and an AI-like cliché', () => {
    const r = reviewArticle(base(LANGUAGE));
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['bureaucratic-enable', 'word-repetition', 'long-sentence', 'cliche']));
    const enable = r.findings.find((f) => f.rule === 'bureaucratic-enable')!;
    expect(enable).toMatchObject({ category: 'language', lines: { start: 3, end: 3 }, alternative: 'Система анализирует' });
    expect(r.findings.find((f) => f.rule === 'word-repetition')!.problem).toMatch(/«индекс» ×2, «заметку» ×2/);
    expect(r.findings.find((f) => f.rule === 'long-sentence')!.lines).toEqual({ start: 7, end: 7 });
    expect(r.findings.filter((f) => f.rule === 'cliche').map((f) => f.excerpt)).toEqual(expect.arrayContaining(['Стоит отметить, что', 'Давайте разберёмся']));
    expect(r.findings.every((f) => f.status === 'open')).toBe(true);
  });

  it('flags style patterns as findings, never as an AI probability', () => {
    const triads = 'Код быстрый, простой и надёжный. Команда умная, дружная и опытная. Процесс гибкий, прозрачный и понятный.';
    const r = reviewArticle(base(`# T\n\n${triads}\n`));
    expect(r.findings.find((f) => f.rule === 'repeated-triads')?.category).toBe('style');
    expect(JSON.stringify(r.findings)).not.toMatch(/probability|ai-generated|\d+ ?% (?:AI|ИИ)/i);
    expect(Object.keys(r.metrics).join(' ')).not.toMatch(/ai/i);
    expect(r.limitations.join(' ')).toMatch(/not an "AI detector" and carry no probability/);
  });

  it('reports statement vs not-statement, and absolute vs qualified guarantees (lexical heuristic)', () => {
    const md = '# T\n\nКэш хранит свежие данные о каждой заметке.\n\nМежду запусками кэш не хранит свежие данные о каждой заметке.\n\nНаходка гарантирует актуальное состояние заметки в отчёте.\n\nАктуальное состояние заметки находка проверяет только при запуске анализа.\n';
    const r = reviewArticle(base(md));
    const logic = r.findings.filter((f) => f.category === 'logic');
    expect(logic.map((f) => f.rule).sort()).toEqual(['absolute-vs-qualified', 'possible-contradiction']);
    expect(logic.find((f) => f.rule === 'possible-contradiction')).toMatchObject({ lines: { start: 3, end: 3 }, related: { lines: { start: 5, end: 5 } } });
    expect(logic[0]!.why).toMatch(/эвристик|heuristic|Если это разные гарантии/);
  });

  it('does not treat a before/after contrast as a contradiction', () => {
    const r = reviewArticle(base('# T\n\nРаньше отчёт не хранил историю находок между запусками.\n\nТеперь отчёт хранит историю находок между запусками.\n'));
    expect(r.findings.filter((f) => f.category === 'logic')).toEqual([]);
  });

  it('factual: "performance improved by 50%" without a benchmark is unsupported', () => {
    const evidence: RepoEvidence = { repositoryId: 'x', modules: [{ path: 'src/audit', name: 'audit', exists: true }], events: [], docs: [{ path: 'README.md', kind: 'readme', text: 'Notegarden keeps a vault healthy.' }] };
    const r = reviewArticle(base('# T\n\nПосле оптимизации производительность выросла на 50%.\n', { repoEvidence: evidence }));
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ kind: 'performance', status: 'unsupported' });
    const f = r.findings.find((x) => x.category === 'factual')!;
    expect(f).toMatchObject({ severity: 'warning', evidence: { status: 'unsupported' } });
    expect(f.suggestion).toMatch(/измерени/);
  });

  it('factual: supported, partially supported, contradicted and needs-human-confirmation', () => {
    const evidence: RepoEvidence = {
      repositoryId: 'x',
      modules: [{ path: 'src/audit', name: 'audit', exists: true }, { path: 'src/legacy', name: 'legacy', exists: false }],
      events: [],
      docs: [{ path: 'bench/RESULTS.md', kind: 'benchmark', text: 'Indexing 4000 notes: 1200 ms before, 600 ms after (50% faster).' }],
    };
    expect(checkClaim({ line: 1, text: 'Индексация ускорилась на 50%.', kind: 'performance' }, evidence)).toMatchObject({ status: 'supported', refs: ['bench/RESULTS.md'] });
    expect(checkClaim({ line: 1, text: 'Индексация ускорилась в 3 раза.', kind: 'performance' }, evidence)).toMatchObject({ status: 'partially-supported' });
    expect(checkClaim({ line: 1, text: 'Я удалил модуль audit целиком.', kind: 'repository' }, evidence)).toMatchObject({ status: 'contradicted', refs: ['src/audit'] });
    expect(checkClaim({ line: 1, text: 'Тысячи пользователей уже перешли.', kind: 'adoption' }, evidence).status).toBe('needs-human-confirmation');
    expect(checkClaim({ line: 1, text: 'Индексация ускорилась в 3 раза.', kind: 'performance' }, undefined).status).toBe('needs-human-confirmation');
    const r = reviewArticle(base('# T\n\nЯ удалил модуль audit целиком.\n', { repoEvidence: evidence }));
    expect(r.findings.find((f) => f.evidence?.status === 'contradicted')?.severity).toBe('error');
  });

  it('repetition: two near-identical paragraphs are reported with both locations; nothing is deleted', () => {
    const para = 'Каждый запуск анализа пишет квитанцию сверки: какие заметки он видел, с хэшами содержимого, и какие сохранённые находки подтвердил или закрыл.';
    const md = `# T\n\n${para}\n\nДругой абзац про ограничения хранилища и одновременные запуски анализа.\n\n${para.replace('подтвердил или закрыл', 'подтвердил, закрыл или не трогал')}\n`;
    const r = reviewArticle(base(md));
    const dup = r.findings.find((f) => f.rule === 'near-duplicate-paragraphs')!;
    expect(dup).toMatchObject({ category: 'repetition', lines: { start: 7, end: 7 }, related: { lines: { start: 3, end: 3 } } });
    expect(dup.related!.similarity).toBeGreaterThan(0.8);
    expect(dup.related!.details.join(' ')).toMatch(/квитанцию/);
    expect(dup.alternative).toBeUndefined();
  });
});

describe('review: suggestion boundaries', () => {
  it('keeps alternatives local: one line, bounded, not much longer than the excerpt', () => {
    expect(alternativeAllowed('система анализирует', 'данная система позволяет осуществлять анализ', 240)).toBe(true);
    expect(alternativeAllowed('a'.repeat(241), 'b'.repeat(200), 240)).toBe(false);
    expect(alternativeAllowed('line one\nline two', 'excerpt', 240)).toBe(false);
    expect(alternativeAllowed('x'.repeat(100), 'short', 240)).toBe(false);
    expect(alternativeAllowed('anything', undefined, 240)).toBe(false);
  });

  it('never returns a rewritten article: every alternative and excerpt is short', async () => {
    const article = await readFile(path.join(FIXTURES, 'review/article.md'), 'utf8');
    const r = reviewArticle(base(article));
    const alternatives = r.findings.map((f) => f.alternative).filter((a): a is string => Boolean(a));
    for (const a of alternatives) {
      expect(a.length).toBeLessThanOrEqual(240);
      expect(a).not.toMatch(/\n/);
    }
    for (const f of r.findings) expect((f.excerpt ?? '').length).toBeLessThanOrEqual(160);
    expect(alternatives.join('').length).toBeLessThan(article.length / 10);
    // The report never contains a whole paragraph of the article, let alone the article.
    const paragraphs = article.split(/\n\n+/).filter((p) => p.length > 200);
    const json = JSON.stringify(r);
    for (const p of paragraphs) expect(json.includes(p.trim())).toBe(false);
  });
});

describe('review: read-only guarantee', () => {
  it('article.md is byte-identical (hash and mtime) after a full review', async () => {
    const tmp = await tempDir();
    try {
      const ctx = workspace(tmp.dir);
      const article = path.join(tmp.dir, 'article.md');
      await writeFile(article, await readFile(path.join(FIXTURES, 'review/article.md')));
      const before = sha256(await readFile(article));
      const mtime = (await stat(article)).mtimeMs;
      const r = await reviewWorkflow(ctx, article, { noDb: true });
      expect(r.articleHashBefore).toBe(before);
      expect(r.articleHashAfter).toBe(before);
      expect(sha256(await readFile(article))).toBe(before);
      expect((await stat(article)).mtimeMs).toBe(mtime);
      expect(path.relative(tmp.dir, r.files.md)).toBe(path.join('reviews', 'article-2026-09-24', 'review.md'));
      expect(r.report.findings.length).toBeGreaterThan(0);
    } finally {
      await tmp.cleanup();
    }
  });

  it('refuses an output path that would overwrite the article', async () => {
    const tmp = await tempDir();
    try {
      const ctx = workspace(tmp.dir);
      const article = path.join(tmp.dir, 'review.md');
      await writeFile(article, '# Черновик\n\nДанная система позволяет осуществлять анализ.\n');
      const before = sha256(await readFile(article));
      await expect(reviewWorkflow(ctx, article, { noDb: true, out: tmp.dir })).rejects.toThrow(/is the article itself; refusing/);
      expect(sha256(await readFile(article))).toBe(before);
    } finally {
      await tmp.cleanup();
    }
  });

  it('remembers author decisions: a dismissed finding stays dismissed in the next review', async () => {
    const tmp = await tempDir();
    try {
      const ctx = workspace(tmp.dir);
      const article = path.join(tmp.dir, 'note.md');
      await writeFile(article, '# Заметка\n\nДанная система позволяет осуществлять анализ заметок.\n');
      const first = await reviewWorkflow(ctx, article);
      const finding = first.report.findings.find((f) => f.rule === 'bureaucratic-enable')!;
      setFindingStatus(await db(ctx), first.report.id, finding.id, 'dismissed', clock.now().toISOString(), 'intentional');
      const second = await reviewWorkflow(ctx, article);
      const again = second.report.findings.find((f) => f.fingerprint === finding.fingerprint)!;
      expect(again.status).toBe('dismissed');
      expect(second.report.summary.carriedDecisions).toBe(1);
      ctx.database?.close();
    } finally {
      await tmp.cleanup();
    }
  });

  it('review profiles are review criteria, never style templates', async () => {
    const catalog = await loadProfileCatalog();
    expect(catalog.issues).toEqual([]);
    expect(catalog.ids()).toEqual(expect.arrayContaining(['engineering-story', 'postmortem', 'tutorial']));
    const p = catalog.get('engineering-story').profile;
    expect(p.expectations).toMatchObject({ firstPerson: 'expected', conflictEarly: true, codeRole: 'supporting', limitations: 'expected', documentationRisk: 'warn' });
    const r = reviewArticle(base(`# T\n\n${'Модуль индексирует файлы и сохраняет результат в базу. '.repeat(40)}\n`, { profile: p }));
    expect(r.findings.find((f) => f.rule === 'profile-first-person')?.suggestion).toMatch(/Никогда не добавлять выдуманный опыт|Never add invented experiences/);
  });
});

describe('review: platform fit never imitates', () => {
  it('flags an article line that reuses the wording of a researched title', async () => {
    const { createDefaultRegistry: registry } = await import('../platforms/registry.js');
    const strategy = registry().get('habr').strategy;
    const r = reviewArticle(base('# Как мы сократили время сборки монорепозитория с 40 до 7 минут\n\nТекст.\n', { platform: { strategy, titles: [{ id: 'habr:910004', title: 'Как мы сократили время сборки монорепозитория с 40 до 7 минут', url: 'https://habr.com/ru/articles/910004/' }] } }));
    const f = r.findings.find((x) => x.rule === 'shared-title-wording')!;
    expect(f).toMatchObject({ category: 'platform-fit', lines: { start: 1, end: 1 } });
    expect(f.problem).toMatch(/910004/);
    expect(r.findings.filter((x) => x.category === 'platform-fit').every((x) => x.severity !== 'error')).toBe(true);
  });
});
