import { isStopword, rawTokens, stem, wordCount } from '../../shared/text.js';
import { analyzeDryness } from '../dryness.js';
import { blockProse, excerptOf, type ReviewDocument } from '../document.js';
import type { ReviewProfile } from '../profiles.js';
import type { PendingFinding } from '../types.js';

/**
 * Structure and clarity heuristics, plus the expectations of the chosen
 * review profile. All of them are advisory: they describe what was found and
 * why it may matter, and the author decides.
 */

const SUMMARY_HEADING = /итог|вывод|заключ|conclusion|summary|резюме|takeaway|вместо заключения/i;
const GENERIC_HEADING = /^(?:что дальше|дальше|итоги?|выводы?|заключение|введение|вступление|ссылки|благодарности|вместо заключения|p\.?s\.?|conclusion|summary|introduction|next steps|what'?s next|references|links)\.?$/i;
const CONFLICT = /проблем|не работал|ломал|сломал|падал|упал|тормозил|медленн|ошиб|баг|терял|потер|перестал|оказалось|столкнул|ограничени|не хватало|не отличал|problem|broke|failed|\bbug|slow|couldn't|could not|didn't scale|ran into|limitation|bottleneck/iu;
const LIMITATION = /ограничени|не умеет|пока не|недостат|компромисс|trade-?off|limitation|caveat|не решает|не покрывает|known issue/iu;
const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:я|мне|меня|мой|моя|моё|мое|мои|мы|нас|нам|наш|наша|наше|наши|i|me|my|we|us|our)(?![\p{L}\p{N}])/iu;
const COMMON_ACRONYMS = new Set(['API', 'HTTP', 'HTTPS', 'SQL', 'JSON', 'YAML', 'CLI', 'UI', 'URL', 'CSS', 'HTML', 'CPU', 'RAM', 'OS', 'CI', 'CD', 'PR', 'ID', 'IT', 'AI', 'ИИ', 'SDK', 'README', 'ADR', 'TODO', 'RSS', 'MVP', 'IDE', 'PDF', 'DNS', 'TCP', 'UDP', 'SSH', 'GPU', 'LLM', 'RAG', 'ORM', 'UUID', 'UTF', 'JS', 'TS', 'MD']);

function contentStems(text: string): Set<string> {
  return new Set(rawTokens(text).filter((t) => t.length >= 4 && !isStopword(t)).map(stem));
}

export function structureFindings(doc: ReviewDocument, options: { language: 'ru' | 'en'; profile?: ReviewProfile }): PendingFinding[] {
  const ru = options.language === 'ru';
  const findings: PendingFinding[] = [];
  const blocks = doc.parsed.blocks;
  const intro = doc.sections[0] && !doc.sections[0].heading ? doc.sections[0] : undefined;

  // Long introduction before the first section
  if (intro && doc.sections.length > 1 && (intro.words > 300 || (intro.words > 150 && intro.words / Math.max(1, doc.words) > 0.25))) {
    findings.push({ category: 'structure', rule: 'long-introduction', severity: 'suggestion', lines: { start: intro.startLine, end: intro.endLine }, problem: ru ? `Длинное вступление до первого раздела: ${intro.words} слов (${Math.round((intro.words / Math.max(1, doc.words)) * 100)}% текста).` : `Long introduction before the first section: ${intro.words} words.`, why: ru ? 'Читатель долго не видит, о чём статья и почему она ему нужна.' : 'The reader waits long to see what the article is about.', suggestion: ru ? 'Проверить, можно ли быстрее перейти к конкретной ситуации.' : 'Check whether the concrete situation can come sooner.' });
  }

  // Dense blocks
  for (const b of blocks.filter((x) => x.kind === 'paragraph')) {
    const w = wordCount(blockProse(b));
    if (w > 180) findings.push({ category: 'structure', rule: 'dense-paragraph', severity: 'suggestion', lines: { start: b.startLine, end: b.endLine }, excerpt: excerptOf(blockProse(b), 80), problem: ru ? `Очень длинный абзац (${w} слов).` : `Very long paragraph (${w} words).`, why: ru ? 'Плотный блок без разрывов трудно читать с экрана.' : 'A dense block is hard to read on screen.', suggestion: ru ? 'Разбить по смысловым шагам.' : 'Split it at its logical steps.' });
  }
  for (const s of doc.sections) {
    const breaks = s.blocks.filter((b) => b.kind === 'list' || b.kind === 'code' || b.kind === 'image' || b.kind === 'table' || (b.kind === 'heading' && (b.level ?? 3) >= 3)).length;
    if (s.words > 700 && breaks === 0) findings.push({ category: 'structure', rule: 'dense-section', severity: 'suggestion', lines: { start: s.startLine, end: s.endLine }, excerpt: s.heading, problem: ru ? `Раздел «${s.heading ?? 'вступление'}» — ${s.words} слов без подзаголовков, списков, кода или иллюстраций.` : `Section "${s.heading ?? 'intro'}" has ${s.words} words without any break.`, why: ru ? 'Длинный сплошной раздел сложно просматривать.' : 'Long unbroken sections are hard to scan.', suggestion: ru ? 'Проверить, есть ли естественная точка разделения.' : 'Look for a natural split point.' });
  }

  // Empty sections (heading directly followed by a heading of the same or higher level)
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if (b.kind === 'heading' && (b.level ?? 1) > 1 && next?.kind === 'heading' && (next.level ?? 1) <= (b.level ?? 1)) {
      findings.push({ category: 'structure', rule: 'empty-section', severity: 'info', lines: { start: b.startLine, end: b.startLine }, excerpt: b.text, problem: ru ? `Раздел «${b.text}» пустой.` : `Section "${b.text}" is empty.`, why: ru ? 'Заголовок без текста выглядит как незаконченный фрагмент.' : 'A heading without content looks unfinished.', suggestion: ru ? 'Заполнить или убрать.' : 'Fill it or remove it.' });
    }
  });

  // Heading ↔ content mismatch (needs ≥ 2 content words; word forms compared by a 5-letter prefix)
  const prefix = (x: string) => x.slice(0, 5);
  for (const s of doc.sections.filter((x) => x.heading && !GENERIC_HEADING.test(x.heading.trim()) && x.words >= 40)) {
    const h = contentStems(s.heading!);
    if (h.size < 2) continue;
    const body = new Set([...contentStems(s.text)].map(prefix));
    if (![...h].some((x) => body.has(prefix(x)))) {
      findings.push({ category: 'structure', rule: 'heading-content-mismatch', severity: 'info', lines: { start: s.startLine, end: s.startLine }, excerpt: s.heading, problem: ru ? `Слова заголовка «${s.heading}» не встречаются в тексте раздела.` : `Words of the heading "${s.heading}" do not appear in the section.`, why: ru ? 'Возможно, заголовок обещает не то, о чём раздел (лексическая проверка, синонимы не учитываются).' : 'The heading may promise something else (lexical check; synonyms are not detected).', suggestion: ru ? 'Сверить заголовок с содержанием раздела.' : 'Compare the heading with the section content.' });
    }
  }

  // Conclusion introducing new facts (numbers not seen before)
  const last = doc.sections.at(-1);
  if (last?.heading && SUMMARY_HEADING.test(last.heading) && doc.sections.length > 1) {
    const before = doc.sections.slice(0, -1).map((s) => s.text).join('\n');
    const fresh = [...new Set([...last.text.matchAll(/\d+(?:[.,]\d+)?\s?%?/g)].map((m) => m[0].trim()))].filter((n) => !before.includes(n.replace(/\s?%$/, '')));
    if (fresh.length) findings.push({ category: 'structure', rule: 'conclusion-new-facts', severity: 'suggestion', lines: { start: last.startLine, end: last.endLine }, excerpt: last.heading, problem: ru ? `В заключении появляются числа, которых не было в тексте: ${fresh.slice(0, 5).join(', ')}.` : `The conclusion introduces numbers not mentioned before: ${fresh.slice(0, 5).join(', ')}.`, why: ru ? 'Новые факты в выводах не подкреплены основной частью.' : 'New facts in a conclusion are not supported by the body.', suggestion: ru ? 'Перенести факт в основную часть или убрать из заключения.' : 'Move the fact into the body or drop it from the conclusion.' });
  }

  // Definition after first use
  const DEF = /^([\p{L}\p{N}`«»"_-]+(?:\s+[\p{L}\p{N}`«»"_-]+){0,2})\s+[—–-]\s+это(?![\p{L}])/u;
  for (const s of doc.sentences) {
    const m = s.text.trim().match(DEF);
    if (!m) continue;
    const term = rawTokens(m[1]!).map(stem);
    if (term.length === 0 || term.every((t) => isStopword(t))) continue;
    const earlier = doc.sentences.filter((x) => x.line < s.line && rawTokens(x.text).map(stem).join(' ').includes(term.join(' ')));
    if (earlier.length >= 2) findings.push({ category: 'structure', rule: 'definition-after-use', severity: 'suggestion', lines: { start: s.line, end: s.line }, excerpt: excerptOf(m[0]), problem: ru ? `Понятие «${m[1]}» определяется только в строке ${s.line}, хотя используется раньше (строки ${earlier.slice(0, 4).map((x) => x.line).join(', ')}).` : `"${m[1]}" is defined at line ${s.line} but used earlier.`, why: ru ? 'Читатель встречает термин до объяснения и может неверно его понять.' : 'Readers meet the term before its definition.', suggestion: ru ? 'Проверить, не стоит ли дать определение при первом упоминании.' : 'Consider defining it at first use.' });
  }

  // Clarity: undefined acronyms, very long parentheticals
  const acronyms = new Map<string, number[]>();
  for (const s of doc.sentences) for (const m of s.text.matchAll(/(?<![\p{L}])([A-ZА-ЯЁ]{2,6})(?![\p{L}])/gu)) acronyms.set(m[1]!, [...(acronyms.get(m[1]!) ?? []), s.line]);
  for (const [acr, lines] of acronyms) {
    if (lines.length < 2 || COMMON_ACRONYMS.has(acr)) continue;
    const expanded = doc.sentences.some((s) => new RegExp(`\\(${acr}\\)|${acr}\\s*\\(|${acr}\\s+[—–-]\\s+это`, 'u').test(s.text));
    if (!expanded) findings.push({ category: 'clarity', rule: 'undefined-acronym', severity: 'info', lines: { start: lines[0]!, end: lines[0]! }, excerpt: acr, problem: ru ? `Сокращение ${acr} не расшифровано (встречается ${lines.length} раз).` : `Acronym ${acr} is never expanded (${lines.length} uses).`, why: ru ? 'Не все читатели знают сокращение.' : 'Not every reader knows it.', suggestion: ru ? 'Расшифровать при первом упоминании, если оно не общеизвестно.' : 'Expand it at first use unless it is common knowledge.' });
  }
  for (const s of doc.sentences) {
    for (const m of s.text.matchAll(/\(([^()]{150,})\)/g)) {
      findings.push({ category: 'clarity', rule: 'long-parenthetical', severity: 'suggestion', lines: { start: s.line, end: s.line }, excerpt: excerptOf(m[0], 80), problem: ru ? `Длинная вставка в скобках (${wordCount(m[1]!)} слов).` : 'Long parenthetical.', why: ru ? 'Длинная вставка разрывает мысль.' : 'A long aside breaks the sentence.', suggestion: ru ? 'Вынести в отдельное предложение.' : 'Move it into its own sentence.' });
    }
  }

  // Review profile expectations
  const p = options.profile;
  if (p && doc.words >= 300) {
    const e = p.expectations;
    const allText = doc.sections.map((s) => s.text).join('\n');
    if (e.firstPerson === 'expected' && !FIRST_PERSON.test(allText)) {
      findings.push({ category: 'structure', rule: 'profile-first-person', severity: 'suggestion', problem: ru ? `Профиль «${p.id}» предполагает авторскую позицию, но в тексте нет первого лица.` : `Profile "${p.id}" expects the author's perspective; the text has no first person.`, why: ru ? 'Для этого жанра читатель ждёт решений и выводов автора.' : 'This kind of article usually carries the author’s own decisions.', suggestion: ru ? 'Решить, нужна ли авторская позиция. Никогда не добавлять выдуманный опыт.' : 'Decide whether your perspective belongs here. Never add invented experiences.' });
    }
    if (e.conflictEarly) {
      const early = doc.sentences.filter((s) => doc.sentences.indexOf(s) < 12).some((s) => CONFLICT.test(s.text));
      if (!early) findings.push({ category: 'structure', rule: 'profile-problem-early', severity: 'info', problem: ru ? `Профиль «${p.id}» (${e.flow}): в начале текста не видно конкретной проблемы.` : `Profile "${p.id}" (${e.flow}): no concrete problem is visible early.`, why: ru ? 'В этом жанре читатель обычно понимает ставку статьи по первой проблеме (лексическая проверка).' : 'This kind of article usually shows its problem early (lexical check).', suggestion: ru ? 'Проверить, где читатель узнаёт, в чём была сложность.' : 'Check where the reader learns what the difficulty was.' });
    }
    const codeBlocks = blocks.filter((b) => b.kind === 'code').length;
    if ((e.codeRole === 'central' || (e.codeRole === 'supporting' && doc.words >= 1200)) && codeBlocks === 0) {
      findings.push({ category: 'structure', rule: 'profile-code', severity: 'info', problem: ru ? `Профиль «${p.id}» предполагает код (${e.codeRole}), в тексте нет ни одного блока кода.` : `Profile "${p.id}" expects code (${e.codeRole}); there is none.`, why: ru ? 'Код часто служит доказательством технического утверждения.' : 'Code often proves a technical point.', suggestion: ru ? 'Решить, нужен ли код; не добавлять его ради объёма.' : 'Decide whether code is needed; never add it for volume.' });
    }
    if (e.limitations === 'expected' && !LIMITATION.test(allText)) {
      findings.push({ category: 'structure', rule: 'profile-limitations', severity: 'info', problem: ru ? 'Не упомянуты ограничения или компромиссы решения.' : 'No limitations or trade-offs are mentioned.', why: ru ? `Для профиля «${p.id}» читатель ждёт честного описания ограничений.` : `For "${p.id}" readers expect limitations.`, suggestion: ru ? 'Проверить, есть ли известные ограничения, о которых стоит сказать.' : 'Check whether known limitations should be mentioned.' });
    }
    if (e.documentationRisk === 'warn') {
      const dry = analyzeDryness(doc.parsed);
      for (const f of dry.findings.filter((x) => ['list-density', 'heading-density', 'definition-openings', 'short-paragraph-run'].includes(x.rule))) {
        findings.push({ category: 'structure', rule: `documentation-risk:${f.rule}`, severity: 'info', problem: f.message, why: ru ? `Для профиля «${p.id}» текст рискует читаться как документация или release notes.` : `For "${p.id}" the text may read like documentation.`, suggestion: ru ? 'Проверить, намеренно ли это.' : 'Check whether this is intended.' });
      }
    }
  }
  return findings;
}
