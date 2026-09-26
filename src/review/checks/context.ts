import type { PlatformStrategy } from '../../../platforms/schema.js';
import type { Publication } from '../../publications/schema.js';
import { compare } from '../../similarity/index.js';
import { isStopword, rawTokens, stem } from '../../shared/text.js';
import type { SaturationState } from '../../topics/saturation.js';
import { containsPhrase, findPhrase, forbiddenPhrases, verbatimPhrase, type AuthorInput } from '../author-input.js';
import { blockProse, excerptOf, type ReviewDocument } from '../document.js';
import { findExternalOverlap } from '../originality.js';
import { lineAt } from '../parse.js';
import type { PendingFinding } from '../types.js';

/**
 * Review against context: the platform landscape (context only, never a rule
 * that overrides the author), the author's own archive (possible repetition
 * of an earlier article) and the author's own notes (author-input.md).
 */

// ------------------------------------------------------------ platform fit

export interface PlatformContext {
  strategy: PlatformStrategy;
  publicationType?: string;
  /** Medians over recent platform articles with parsed structure. */
  sample?: { n: number; wordCount: number | null; headingDensity: number | null; introWords: number | null; codeBlocks: number | null; conflictFirstShare: number | null; topConflictFirstShare: number | null };
  /** Saturation of topics this article is about. */
  topics?: Array<{ topicId: string; label: string; state: SaturationState; share: number; articleCount: number; sampleSize: number }>;
  /** Titles of researched articles (provenance only), to flag reused wording. */
  titles?: Array<{ id: string; title: string; url?: string }>;
}

const CONFLICT = /проблем|не работал|ломал|сломал|падал|упал|ошиб|баг|терял|перестал|оказалось|не отличал|problem|broke|failed|\bbug|ran into|bottleneck/iu;

export function platformFitFindings(doc: ReviewDocument, markdown: string, ctx: PlatformContext, options: { language: 'ru' | 'en' }): PendingFinding[] {
  const ru = options.language === 'ru';
  const findings: PendingFinding[] = [];
  const s = ctx.strategy;
  const context = ru ? 'Контекст платформы, не правило: решение остаётся за автором.' : 'Platform context, not a rule: the author decides.';
  const chars = [...markdown.replace(/^---\n[\s\S]*?\n---\n/, '')].length;
  for (const c of s.formatting.constraints.filter((x) => x.kind === 'constraint')) {
    const limit = c.text.match(/(\d[\d,]*)\s*characters/i);
    if (limit && chars > Number(limit[1]!.replace(/,/g, ''))) findings.push({ category: 'platform-fit', rule: 'platform-constraint', severity: 'warning', problem: `${s.displayName}: ${c.text} (${chars} characters now).`, why: c.source ?? 'Documented platform limit.', suggestion: ru ? 'Проверить, как текст будет опубликован (разбить, сократить или ссылаться на полную версию).' : 'Check how the text will be published.' });
  }
  const type = ctx.publicationType && s.reviewContext.typicalLength[ctx.publicationType] ? ctx.publicationType : Object.keys(s.reviewContext.typicalLength)[0];
  const range = type ? s.reviewContext.typicalLength[type] : undefined;
  if (range) {
    const value = range.unit === 'words' ? doc.words : chars;
    if (value < range.min || value > range.max) findings.push({ category: 'platform-fit', rule: 'typical-length', severity: 'info', problem: ru ? `Объём ${value} ${range.unit === 'words' ? 'слов' : 'символов'}; типично для «${type}» на ${s.displayName}: ${range.min}–${range.max}.` : `${value} ${range.unit}; typical for ${type} on ${s.displayName}: ${range.min}–${range.max}.`, why: context, suggestion: ru ? 'Сверить объём с тем, что нужно материалу.' : 'Compare with what the material needs.' });
  }
  if (ctx.sample && ctx.sample.n >= 5) {
    const m = ctx.sample;
    const headings = doc.parsed.blocks.filter((b) => b.kind === 'heading' && (b.level ?? 1) > 1).length;
    const density = doc.words ? Math.round((headings * 1000 * 10) / doc.words) / 10 : 0;
    const introWords = doc.sections[0] && !doc.sections[0].heading ? doc.sections[0].words : 0;
    const code = doc.parsed.blocks.filter((b) => b.kind === 'code').length;
    const rows = [
      m.wordCount !== null ? `${ru ? 'слов' : 'words'}: ${doc.words} (${ru ? 'медиана выборки' : 'sample median'} ${m.wordCount})` : '',
      m.headingDensity !== null ? `${ru ? 'заголовков на 1000 слов' : 'headings per 1000 words'}: ${density} (${m.headingDensity})` : '',
      m.introWords !== null ? `${ru ? 'вступление' : 'intro words'}: ${introWords} (${m.introWords})` : '',
      m.codeBlocks !== null ? `${ru ? 'блоков кода' : 'code blocks'}: ${code} (${m.codeBlocks})` : '',
    ].filter(Boolean);
    findings.push({ category: 'platform-fit', rule: 'sample-structure', severity: 'info', problem: ru ? `Структура статьи рядом с медианами недавней выборки ${s.displayName} (N=${m.n}).` : `Structure next to recent ${s.displayName} sample medians (N=${m.n}).`, why: context, suggestion: ru ? 'Только для сведения; медианы не являются целью.' : 'For information only; medians are not targets.', related: { details: rows } });
    if (m.topConflictFirstShare !== null && m.conflictFirstShare !== null) {
      const early = doc.sentences.slice(0, 10).some((x) => CONFLICT.test(x.text));
      if (!early && m.topConflictFirstShare - m.conflictFirstShare >= 0.2) findings.push({ category: 'platform-fit', rule: 'opening-pattern', severity: 'info', problem: ru ? `Начало статьи отличается от частого паттерна: в выборке ${Math.round(m.topConflictFirstShare * 100)}% статей с высоким моментумом называют конкретную проблему в начале (против ${Math.round(m.conflictFirstShare * 100)}% остальных).` : 'The opening differs from a pattern common among high-momentum sample articles (concrete problem early).', why: context, suggestion: ru ? 'Имеет смысл, только если в статье есть реальный инженерный конфликт. Не подражать трендам.' : 'Only relevant if the article has a real engineering conflict. Do not imitate trends.' });
    }
  }
  if (ctx.titles?.length) {
    const lines = doc.parsed.publishable.split('\n').map((text, i) => ({ where: String(i + 1), text }));
    for (const m of findExternalOverlap(lines, ctx.titles.map((t) => ({ id: t.id, text: t.title })))) {
      const line = Number(m.where);
      const src = ctx.titles.find((t) => t.id === m.id);
      findings.push({ category: 'platform-fit', rule: 'shared-title-wording', severity: 'suggestion', lines: { start: line, end: line }, excerpt: m.sequence, problem: ru ? `Строка ${line} дословно повторяет формулировку заголовка другой статьи из выборки (${src?.url ?? m.id}).` : `Line ${line} reuses the wording of a researched article's title (${src?.url ?? m.id}).`, why: ru ? 'StoryOps не копирует чужие заголовки и формулировки; совпадение может быть случайным.' : 'Other authors\' titles are never templates; the match may be accidental.', suggestion: ru ? 'Проверить, своя ли это формулировка.' : 'Check that the wording is your own.' });
    }
  }
  for (const t of (ctx.topics ?? []).filter((x) => x.state === 'crowded' || x.state === 'highly-saturated')) {
    findings.push({ category: 'platform-fit', rule: 'crowded-topic', severity: 'info', problem: ru ? `Тема «${t.label}» занимает большую долю текущей выборки ${s.displayName} (${t.articleCount} из ${t.sampleSize}, состояние ${t.state}).` : `Topic "${t.label}" occupies a large share of the current ${s.displayName} sample (${t.articleCount}/${t.sampleSize}, ${t.state}).`, why: context, suggestion: ru ? 'Проверить, чем статья отличается от типичной подачи этой темы.' : 'Check what distinguishes the article from the common framing.' });
  }
  return findings;
}

// --------------------------------------------------------- author archive

export const ARCHIVE_SECTION_THRESHOLD = 0.35;

export function archiveFindings(doc: ReviewDocument, publications: readonly Publication[], options: { language: 'ru' | 'en' }): PendingFinding[] {
  const ru = options.language === 'ru';
  if (publications.length === 0) return [];
  const findings: PendingFinding[] = [];
  const corpus = publications.map((p) => ({ id: p.id, text: `${p.title}\n${p.text}`, headings: p.headings.map((h) => h.text) }));
  for (const s of doc.sections.filter((x) => x.words >= 60)) {
    const best = compare({ id: 'section', text: s.text, headings: s.heading ? [s.heading] : [] }, corpus)[0];
    if (!best || best.cosine < ARCHIVE_SECTION_THRESHOLD) continue;
    const pub = publications.find((p) => p.id === best.id)!;
    const pubStems = new Set(rawTokens(`${pub.title} ${pub.text}`).map(stem));
    const fresh = [...new Set(rawTokens(s.text).filter((t) => t.length >= 5 && !isStopword(t) && !pubStems.has(stem(t))))].slice(0, 10);
    findings.push({
      category: 'archive',
      rule: 'archive-overlap',
      severity: 'suggestion',
      lines: { start: s.startLine, end: s.endLine },
      excerpt: s.heading ?? excerptOf(s.text, 80),
      problem: ru ? `Раздел заметно повторяет материал вашей статьи «${pub.title}»${pub.publicationDate ? ` (${pub.publicationDate.slice(0, 10)})` : ''}.` : `This section substantially repeats material from your previous article "${pub.title}".`,
      why: ru ? 'Читатели предыдущей статьи уже знают это; повтор может быть нужен, но лучше решать это явно.' : 'Readers of the earlier article already know this; repeating may be fine, but decide deliberately.',
      suggestion: ru ? 'Сократить до ссылки на прежнюю статью или явно показать, что изменилось.' : 'Shorten to a reference, or make explicit what changed.',
      related: { publicationId: pub.id, title: pub.title, similarity: best.cosine, details: [`${ru ? 'что повторяется (общие термины)' : 'repeated (shared terms)'}: ${best.sharedTerms.slice(0, 8).join(', ')}`, `${ru ? 'что нового (слова, которых не было в прежней статье)' : 'new (words not in the earlier article)'}: ${fresh.join(', ') || '—'}`, ...(pub.url ? [pub.url] : [])] },
    });
  }
  return findings;
}

// ----------------------------------------------------------- author input

export function authorInputFindings(doc: ReviewDocument, input: AuthorInput, options: { language: 'ru' | 'en' }): PendingFinding[] {
  const ru = options.language === 'ru';
  const findings: PendingFinding[] = [];
  const text = doc.parsed.publishable;
  const articleStems = new Set(rawTokens(doc.prose.map(blockProse).join('\n')).map(stem));
  for (const item of input.items) {
    if (item.priority === 'verbatim') {
      const phrase = verbatimPhrase(item);
      if (phrase && findPhrase(text, phrase) < 0) findings.push({ category: 'author-input', rule: 'verbatim-missing', severity: 'suggestion', excerpt: excerptOf(phrase), problem: ru ? `VERBATIM-фраза из author-input.md не найдена дословно: «${excerptOf(phrase, 100)}».` : `VERBATIM phrase not found exactly: "${excerptOf(phrase, 100)}".`, why: ru ? 'Вы отметили её как фразу, которую хотите видеть в статье.' : 'You marked it as a phrase you want in the article.', suggestion: ru ? 'Проверить, осталась ли фраза нужной.' : 'Check whether you still want it.' });
    } else if (item.priority === 'must') {
      const keys = [...new Set(rawTokens(item.text).filter((t) => t.length >= 5 && !isStopword(t)).map(stem))];
      const present = keys.filter((k) => articleStems.has(k)).length;
      if (keys.length && present / keys.length < 0.5) findings.push({ category: 'author-input', rule: 'must-use-missing', severity: 'suggestion', excerpt: excerptOf(item.text, 100), problem: ru ? `Пункт MUST USE, возможно, не раскрыт: «${excerptOf(item.text, 100)}» (найдено ${present} из ${keys.length} ключевых слов).` : `MUST USE item may be missing: "${excerptOf(item.text, 100)}".`, why: ru ? 'Вы отметили этот пункт как обязательный. Проверка лексическая: пересказ другими словами она не видит.' : 'You marked it as required. The check is lexical and misses paraphrases.', suggestion: ru ? 'Проверить вручную.' : 'Check manually.' });
    } else if (item.priority === 'avoid') {
      for (const phrase of forbiddenPhrases(item)) {
        const at = findPhrase(text, phrase, { caseInsensitive: true });
        if (at < 0 || !containsPhrase(text, phrase, { caseInsensitive: true })) continue;
        const line = lineAt(doc.parsed, at);
        findings.push({ category: 'author-input', rule: 'do-not-use', severity: 'warning', lines: { start: line, end: line }, excerpt: excerptOf(phrase), problem: ru ? `В тексте есть фраза из DO NOT USE: «${phrase}».` : `A DO NOT USE phrase appears: "${phrase}".`, why: ru ? 'Вы сами отметили её как нежелательную.' : 'You marked it as unwanted.', suggestion: ru ? 'Убрать или переформулировать.' : 'Remove or rephrase.' });
      }
    }
  }
  return findings;
}
