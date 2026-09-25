import { checkStyle } from '../../author/style-check.js';
import { splitSentences, wordCount } from '../../shared/text.js';
import { blockProse, excerptOf, lineInBlock, type ReviewDocument } from '../document.js';
import type { PendingFinding } from '../types.js';

/**
 * Style findings: observable patterns that often make text read as
 * formulaic or machine-written (repeated triads, "не X, а Y", generic section
 * openings, identical paragraph rhythm, repeated conclusions, em-dash
 * density, clichés). This is NOT an "AI detector": there is no probability,
 * only patterns with their locations and counts.
 */

const CLICHES: Array<[RegExp, string]> = [
  [/в современном мире|в наше время|в наши дни|в эпоху (?:ии|нейросетей|цифровизации)/giu, 'обобщённое вступление'],
  [/давайте разбер[её]мся|давайте погрузимся|погрузимся в|без лишних слов|итак, приступим/giu, 'разговорная формула-связка'],
  [/стоит отметить,? что|важно понимать,? что|не секрет,? что|как известно/giu, 'пустая вводная формула'],
  [/играет ключевую роль|играет важную роль|мощный инструмент|настоящий прорыв|меняет правила игры/giu, 'штамп'],
  [/подводя итог|в заключение (?:хочется|стоит|можно) сказать|таким образом, можно сделать вывод/giu, 'шаблонная концовка'],
  [/in today's (?:fast-paced )?world|it's worth noting that|let's dive in|delve into|game[- ]changer|unlock the power/gi, 'formulaic phrase'],
];

const SECTION_OPENING = /^(?:в этом разделе|в этой части|теперь давайте|давайте|итак,|рассмотрим|перейд[её]м к|in this section|now let's|let's)/iu;
const CONCLUSION_OPENING = /^(?:таким образом|в итоге|итак|итог:|в сухом остатке|thus|in short|overall|to sum up)/iu;
const TRIAD = /(?<![\p{L}])(\p{L}{3,}), (\p{L}{3,}) и (\p{L}{3,})(?![\p{L}])/gu;

export function styleFindings(doc: ReviewDocument, markdown: string, options: { styleProfile: string }): PendingFinding[] {
  const findings: PendingFinding[] = [];
  const ru = !options.styleProfile.startsWith('en');

  // Clichés
  doc.parsed.blocks.forEach((b) => {
    if (!doc.prose.includes(b)) return;
    const text = blockProse(b);
    for (const [re, kind] of CLICHES) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
        const line = lineInBlock(b, text, m.index ?? 0);
        findings.push({ category: 'style', rule: 'cliche', severity: 'suggestion', lines: { start: line, end: line }, excerpt: excerptOf(m[0]), problem: ru ? `Шаблонная фраза (${kind}).` : `Formulaic phrase (${kind}).`, why: ru ? 'Такие формулы не несут информации и делают текст похожим на шаблон.' : 'Carries no information and reads as template text.', suggestion: ru ? 'Убрать или заменить конкретикой.' : 'Remove it or replace it with something concrete.' });
      }
    }
  });

  // Existing style profile metrics: "не X, а Y", em dashes, exclamations, short-sentence runs, marketing
  const report = checkStyle(markdown, options.styleProfile);
  for (const f of report.findings) {
    if (f.rule === 'bureaucratic' || f.rule === 'long-sentences' || f.rule === 'cliche') continue; // covered by language/cliché rules
    const category: PendingFinding['category'] = f.rule === 'generic-opening' || f.rule === 'announce-opening' ? 'structure' : f.rule === 'inflated-claim' || f.rule === 'invented-adoption' ? 'factual' : 'style';
    const finding: PendingFinding = {
      category,
      rule: f.rule,
      severity: f.severity === 'error' ? 'warning' : f.severity === 'warning' ? 'suggestion' : 'info',
      problem: f.message,
      why: category === 'factual' ? 'A strong claim needs support the reader can check.' : ru ? 'Наблюдаемый шаблон; решение за автором.' : 'An observable pattern; the author decides.',
      suggestion: category === 'factual' ? 'Back it with a measurement or source, or soften it.' : ru ? 'Проверить, намеренно ли это.' : 'Check whether it is intentional.',
    };
    if (f.line) {
      finding.lines = { start: f.line, end: f.line };
    }
    if (f.excerpt) finding.excerpt = excerptOf(f.excerpt);
    findings.push(finding);
  }

  // Repeated triads ("X, Y и Z")
  const triads = doc.sentences.filter((s) => new RegExp(TRIAD.source, TRIAD.flags).test(s.text));
  if (triads.length >= 3) {
    findings.push({ category: 'style', rule: 'repeated-triads', severity: 'suggestion', lines: { start: triads[0]!.line, end: triads.at(-1)!.line }, excerpt: excerptOf(triads[0]!.text, 100), problem: ru ? `Перечисления из трёх элементов («X, Y и Z») в ${triads.length} предложениях (строки ${triads.map((t) => t.line).join(', ')}).` : `Three-item lists in ${triads.length} sentences.`, why: ru ? 'Частые тройки создают узнаваемый механический ритм.' : 'Frequent triads create a mechanical rhythm.', suggestion: ru ? 'Проверить, нужны ли все три элемента в каждом случае.' : 'Check whether every item is needed.' });
  }

  // Generic section openings
  const openings = doc.parsed.blocks.filter((b, i) => b.kind === 'paragraph' && i > 0 && doc.parsed.blocks[i - 1]!.kind === 'heading' && SECTION_OPENING.test(blockProse(b).trim()));
  if (openings.length >= 2) {
    findings.push({ category: 'style', rule: 'generic-section-openings', severity: 'suggestion', lines: { start: openings[0]!.startLine, end: openings.at(-1)!.startLine }, excerpt: excerptOf(blockProse(openings[0]!), 80), problem: ru ? `${openings.length} разделов начинаются с формулы-анонса («В этом разделе…», «Давайте…»): строки ${openings.map((o) => o.startLine).join(', ')}.` : `${openings.length} sections open with an announcement.`, why: ru ? 'Анонс вместо содержания задерживает читателя и звучит шаблонно.' : 'Announcing instead of saying delays the reader.', suggestion: ru ? 'Начинать раздел сразу с сути.' : 'Start sections with the substance.' });
  }

  // Repeated conclusion pattern
  const conclusions = doc.parsed.blocks.filter((b) => b.kind === 'paragraph').filter((b) => {
    const sentences = splitSentences(blockProse(b));
    return sentences.length > 0 && CONCLUSION_OPENING.test(sentences.at(-1)!.trim());
  });
  if (conclusions.length >= 3) {
    findings.push({ category: 'style', rule: 'repeated-conclusions', severity: 'suggestion', lines: { start: conclusions[0]!.startLine, end: conclusions.at(-1)!.endLine }, problem: ru ? `${conclusions.length} абзацев заканчиваются выводом-формулой («Таким образом…», «В итоге…»): строки ${conclusions.map((c) => c.startLine).join(', ')}.` : `${conclusions.length} paragraphs end with a formulaic conclusion.`, why: ru ? 'Повторяющаяся схема «абзац — вывод» делает ритм однообразным.' : 'The repeated paragraph-then-summary shape is monotonous.', suggestion: ru ? 'Оставить выводы там, где они действительно нужны.' : 'Keep summaries where they add something.' });
  }

  // Identical paragraph rhythm: ≥ 5 consecutive paragraphs with the same sentence count and similar length
  const paras = doc.parsed.blocks.filter((b) => b.kind === 'paragraph').map((b) => ({ b, sentences: splitSentences(blockProse(b)).length, words: wordCount(blockProse(b)) }));
  let runStart = 0;
  for (let i = 1; i <= paras.length; i += 1) {
    const same = i < paras.length && paras[i]!.sentences === paras[runStart]!.sentences && Math.abs(paras[i]!.words - paras[runStart]!.words) <= Math.max(4, paras[runStart]!.words * 0.2);
    if (!same) {
      if (i - runStart >= 5) {
        findings.push({ category: 'style', rule: 'uniform-paragraph-rhythm', severity: 'info', lines: { start: paras[runStart]!.b.startLine, end: paras[i - 1]!.b.endLine }, problem: ru ? `${i - runStart} абзацев подряд одинаковой формы (${paras[runStart]!.sentences} предл., ~${paras[runStart]!.words} слов).` : `${i - runStart} consecutive paragraphs of identical shape.`, why: ru ? 'Одинаковый ритм абзацев воспринимается как механический.' : 'Identical rhythm reads as mechanical.', suggestion: ru ? 'Проверить, не стоит ли разнообразить длину абзацев.' : 'Consider varying paragraph length.' });
      }
      runStart = i;
    }
  }
  return findings;
}
