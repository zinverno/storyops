import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'fixtures');

export async function fixture(rel: string): Promise<string> {
  return readFile(path.join(FIXTURES, rel), 'utf8');
}

export async function tempDir(prefix = 'editorial-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

import { parseArticlePage } from '../platforms/habr/parser.js';
import { publicationFromArticle } from '../platforms/habr/research.js';
import { importMarkdownPublication } from '../src/publications/import.js';
import type { Publication } from '../src/publications/schema.js';
import { fixedClock } from '../src/shared/clock.js';
import { parseConfig } from '../src/config/load.js';

export const NOW_ISO = '2026-09-24T12:00:00.000Z';
export const clock = fixedClock(NOW_ISO);

/** The fixture author's publications: two Habr articles and one Telegram note. */
export async function fixturePublications(): Promise<Publication[]> {
  const pubs: Publication[] = [];
  for (const id of ['900001', '900002']) {
    const url = `https://habr.com/ru/articles/${id}/`;
    pubs.push(publicationFromArticle(parseArticlePage(await fixture(`habr/article-${id}.html`), url, clock.now()), NOW_ISO, false));
  }
  pubs.push(await importMarkdownPublication(path.join(FIXTURES, 'author/telegram-2025-04-12-lifecycle.md'), { clock }));
  return pubs;
}

export const fixtureConfig = parseConfig({
  author: { name: 'Demo Author', profiles: { habr: 'https://habr.com/ru/users/demo_author/' } },
  projects: [
    {
      id: 'notegarden',
      name: 'Notegarden',
      path: './notegarden',
      glossary: [
        { term: 'аудит', aliases: ['audit'] },
        { term: 'правила', aliases: ['rules'] },
        { term: 'отчёт', aliases: ['report'] },
        { term: 'модель здоровья', aliases: ['health model', 'health'] },
        { term: 'жизненный цикл находок', aliases: ['finding lifecycle', 'findings', 'lifecycle'] },
        { term: 'анализ знаний', aliases: ['knowledge analysis', 'knowledge'] },
        { term: 'SQLite', aliases: ['storage'] },
      ],
    },
  ],
});
