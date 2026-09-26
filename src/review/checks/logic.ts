import { isStopword, rawTokens, stem } from '../../shared/text.js';
import { excerptOf, type ReviewDocument, type Sentence } from '../document.js';
import type { PendingFinding } from '../types.js';

/**
 * Lexical consistency heuristics. Full logical review cannot be done
 * deterministically; these rules only surface pairs of statements that talk
 * about the same thing with opposite polarity or with incompatible
 * absolute/qualified wording. Every finding says it is a heuristic, and the
 * reviewing agent (or author) decides.
 */

const NEGATION = new Set(['не', 'нет', 'никогда', 'ни', 'not', 'never', 'no', "doesn't", "don't", "isn't", "aren't", "won't", "cannot", "can't"]);
const ABSOLUTE = /(?<![\p{L}])(?:всегда|гарантиру\p{L}*|гарантир\p{L}*|всё|все|полностью|always|guarantee\p{L}*|every|fully)(?![\p{L}])/iu;
const TEMPORAL = /(?<![\p{L}])(?:раньше|теперь|сейчас|сначала|потом|затем|когда-то|было|стало|прежн\p{L}*|стар\p{L}* верси\p{L}*|before|after|now|previously|used to|originally|later)(?![\p{L}])/iu;
const QUALIFIED = /(?<![\p{L}])(?:только|лишь|не всегда|не гарантир\p{L}*|иногда|частично|only|not always|sometimes|partially)(?![\p{L}])/iu;

function content(sentence: string): { stems: Set<string>; negated: boolean } {
  const tokens = rawTokens(sentence);
  const negated = tokens.some((t) => NEGATION.has(t));
  return { stems: new Set(tokens.filter((t) => !NEGATION.has(t) && !isStopword(t) && t.length >= 3 && !/^\d+$/.test(t)).map(stem)), negated };
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  const shared = [...a].filter((x) => b.has(x));
  const union = a.size + b.size - shared.length;
  return { score: union ? shared.length / union : 0, shared };
}

export function logicFindings(doc: ReviewDocument, options: { language: 'ru' | 'en' }): PendingFinding[] {
  const ru = options.language === 'ru';
  const findings: PendingFinding[] = [];
  const sentences = doc.sentences.filter((s) => s.text.split(/\s+/).length >= 4);
  const analysed = sentences.map((s) => ({ s, ...content(s.text) }));
  const reported = new Set<string>();
  const push = (a: Sentence, b: Sentence, rule: string, problem: string, why: string, shared: string[]) => {
    const key = `${a.line}:${b.line}`;
    if (reported.has(key) || findings.length >= 10) return;
    reported.add(key);
    findings.push({
      category: 'logic',
      rule,
      severity: 'warning',
      lines: { start: a.line, end: a.line },
      excerpt: excerptOf(a.text, 140),
      problem,
      why,
      suggestion: ru ? 'Проверить, действительно ли утверждения противоречат друг другу; если нет, уточнить формулировку, чтобы разница была явной.' : 'Check whether the statements conflict; if not, make the difference explicit.',
      related: { lines: { start: b.line, end: b.line }, details: [`${ru ? 'второе утверждение' : 'second statement'}: «${excerptOf(b.text, 140)}»`, `${ru ? 'общие слова' : 'shared words'}: ${shared.slice(0, 8).join(', ')}`] },
    });
  };
  for (let i = 0; i < analysed.length; i += 1) {
    for (let j = i + 1; j < analysed.length; j += 1) {
      const a = analysed[i]!;
      const b = analysed[j]!;
      // "Раньше X не делал Y. Теперь делает." is a before/after contrast, not a contradiction.
      if (TEMPORAL.test(a.s.text) || TEMPORAL.test(b.s.text)) continue;
      const { score, shared } = jaccard(a.stems, b.stems);
      if (shared.length < 3) continue;
      if (a.negated !== b.negated && score >= 0.5) {
        push(a.s, b.s, 'possible-contradiction', ru ? `Возможное противоречие: утверждение и его отрицание (строки ${a.s.line} и ${b.s.line}).` : `Possible contradiction between lines ${a.s.line} and ${b.s.line}.`, ru ? 'Два предложения говорят об одном и том же, но одно из них с отрицанием. Лексическая эвристика: смысл может различаться.' : 'Two sentences share most words but one is negated (lexical heuristic).', shared);
      } else if (score >= 0.3 && ((ABSOLUTE.test(a.s.text) && QUALIFIED.test(b.s.text)) || (QUALIFIED.test(a.s.text) && ABSOLUTE.test(b.s.text)))) {
        push(a.s, b.s, 'absolute-vs-qualified', ru ? `Разные гарантии для одного предмета: абсолютное утверждение и ограниченное (строки ${a.s.line} и ${b.s.line}).` : `Absolute and qualified statements about the same subject (lines ${a.s.line} and ${b.s.line}).`, ru ? 'Одно предложение обещает «всегда/гарантирует», другое говорит «только/лишь». Если это разные гарантии, текст должен это различать.' : 'One sentence promises always/guarantees, another says only/sometimes.', shared);
      }
    }
  }
  return findings;
}
