import { isStopword, rawTokens, stem, wordCount } from '../../shared/text.js';
import { blockProse, excerptOf, lineInBlock, type ReviewDocument } from '../document.js';
import type { PendingFinding } from '../types.js';

/**
 * Deterministic language heuristics (Russian first, a few English rules).
 * They catch frequent, recognisable problems; they do not "solve grammar".
 * Anything subtler is left to a human or the reviewing agent.
 */

interface PhraseRule {
  id: string;
  lang: 'ru' | 'en';
  pattern: RegExp;
  problem: string;
  why: string;
  suggestion: string;
  severity: PendingFinding['severity'];
  category?: PendingFinding['category'];
  /** A local alternative for the matched excerpt only. */
  alternative?: (m: RegExpExecArray) => string | undefined;
}

/** Nominalisation → verb (singular, plural) for "позволяет осуществлять <noun>". */
const NOUN_TO_VERB: Record<string, [string, string]> = {
  анализ: ['анализирует', 'анализируют'],
  проверку: ['проверяет', 'проверяют'],
  обработку: ['обрабатывает', 'обрабатывают'],
  поиск: ['ищет', 'ищут'],
  мониторинг: ['отслеживает', 'отслеживают'],
  хранение: ['хранит', 'хранят'],
  запуск: ['запускает', 'запускают'],
  сравнение: ['сравнивает', 'сравнивают'],
  контроль: ['контролирует', 'контролируют'],
  сбор: ['собирает', 'собирают'],
  управление: ['управляет', 'управляют'],
  генерацию: ['генерирует', 'генерируют'],
  загрузку: ['загружает', 'загружают'],
  синхронизацию: ['синхронизирует', 'синхронизируют'],
};

const DEMONSTRATIVE: Record<string, string> = { ый: 'этот', ая: 'эта', ое: 'это', ые: 'эти', ого: 'этого', ой: 'этой', ом: 'этом', ых: 'этих', ым: 'этим', ую: 'эту', ыми: 'этими', ому: 'этому' };

const keepCase = (source: string, replacement: string) => (/^\p{Lu}/u.test(source) ? replacement[0]!.toUpperCase() + replacement.slice(1) : replacement);

const BUREAUCRATIC_WHY = 'Канцелярская конструкция: отглагольное существительное вместо глагола делает фразу длиннее и абстрактнее.';

export const LANGUAGE_RULES: readonly PhraseRule[] = [
  {
    id: 'bureaucratic-enable',
    lang: 'ru',
    pattern: /(?<![\p{L}])(?:(данн(?:ая|ый|ое|ые))\s+)?(\p{L}+)\s+позволя(ет|ют)\s+осуществлять\s+(\p{L}+)/giu,
    problem: 'Канцелярит: «позволяет осуществлять …».',
    why: BUREAUCRATIC_WHY,
    suggestion: 'Сделать фразу короче и прямее: глагол вместо «позволяет осуществлять + существительное».',
    severity: 'suggestion',
    alternative: (m) => {
      const verb = NOUN_TO_VERB[m[4]!.toLowerCase()];
      return verb ? keepCase(m[0]!, `${m[2]!.toLowerCase()} ${m[3] === 'ют' ? verb[1] : verb[0]}`) : undefined;
    },
  },
  {
    id: 'bureaucratic-dannyi',
    lang: 'ru',
    pattern: /(?<![\p{L}])данн(ый|ая|ое|ые|ого|ой|ом|ых|ым|ую|ыми|ому)\s+(\p{L}+)/giu,
    problem: 'Канцелярское «данный».',
    why: 'В живом техническом тексте «данный» почти всегда заменяется на «этот» или просто опускается.',
    suggestion: 'Заменить на «этот/эта/это» или убрать.',
    severity: 'suggestion',
    alternative: (m) => (DEMONSTRATIVE[m[1]!.toLowerCase()] ? keepCase(m[0]!, `${DEMONSTRATIVE[m[1]!.toLowerCase()]} ${m[2]}`) : undefined),
  },
  { id: 'bureaucratic-osushchestvlyat', lang: 'ru', pattern: /(?<![\p{L}])осуществл\p{L}*/giu, problem: 'Канцелярит: «осуществлять».', why: BUREAUCRATIC_WHY, suggestion: 'Обычно лучше прямой глагол действия («проверять», «запускать»).', severity: 'suggestion' },
  { id: 'bureaucratic-yavlyaetsya', lang: 'ru', pattern: /(?<![\p{L}])явля(?:ется|ются)(?![\p{L}])/giu, problem: 'Связка «является».', why: 'В разговорном техническом тексте связка «является» часто лишняя и утяжеляет фразу.', suggestion: 'Попробовать тире или перестроить фразу без связки.', severity: 'info' },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /на сегодняшний день/giu, problem: 'Канцелярит: «на сегодняшний день».', why: BUREAUCRATIC_WHY, suggestion: 'Короче: «сейчас».', severity: 'suggestion', alternative: (m) => keepCase(m[0]!, 'сейчас') },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /в связи с тем,? что/giu, problem: 'Канцелярит: «в связи с тем, что».', why: BUREAUCRATIC_WHY, suggestion: 'Короче: «потому что» или «так как».', severity: 'suggestion', alternative: (m) => keepCase(m[0]!, 'потому что') },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /имеет место/giu, problem: 'Канцелярит: «имеет место».', why: BUREAUCRATIC_WHY, suggestion: 'Прямее: «есть», «происходит», «случается».', severity: 'suggestion' },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /в рамках данн\p{L}+/giu, problem: 'Канцелярит: «в рамках данного/данной».', why: BUREAUCRATIC_WHY, suggestion: 'Прямее: «в этом/этой …».', severity: 'suggestion' },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /осуществлять контроль/giu, problem: 'Канцелярит: «осуществлять контроль».', why: BUREAUCRATIC_WHY, suggestion: 'Глагол: «контролировать».', severity: 'suggestion', alternative: (m) => keepCase(m[0]!, 'контролировать') },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /(?:провести|проводить|произвести|производить) (анализ|оптимизацию|проверку|настройку)/giu, problem: 'Канцелярит: «провести/произвести + существительное».', why: BUREAUCRATIC_WHY, suggestion: 'Глагол вместо конструкции («проанализировать», «оптимизировать», «проверить»).', severity: 'suggestion' },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /оказ(?:ывать|ывает|ывают|ал|ала|али) влияние/giu, problem: 'Канцелярит: «оказывать влияние».', why: BUREAUCRATIC_WHY, suggestion: 'Глагол: «влиять».', severity: 'suggestion' },
  { id: 'bureaucratic-phrase', lang: 'ru', pattern: /является неотъемлемой частью/giu, problem: 'Штамп: «является неотъемлемой частью».', why: BUREAUCRATIC_WHY, suggestion: 'Конкретнее: что именно эта часть делает.', severity: 'suggestion' },
  // Orthography: frequent misspellings (a dictionary, not a grammar checker).
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])вообщем(?![\p{L}])/giu, problem: 'Орфография: «вообщем».', why: 'Правильно раздельно: «в общем».', suggestion: 'Исправить на «в общем».', severity: 'warning', alternative: (m) => keepCase(m[0]!, 'в общем') },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])не смотря на(?![\p{L}])/giu, problem: 'Орфография: «не смотря на».', why: 'Предлог «несмотря на» пишется слитно.', suggestion: 'Исправить на «несмотря на».', severity: 'warning', alternative: (m) => keepCase(m[0]!, 'несмотря на') },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])в следствии(?![\p{L}])/giu, problem: 'Орфография: «в следствии».', why: 'В значении «из-за» пишется «вследствие».', suggestion: 'Исправить на «вследствие».', severity: 'warning', alternative: (m) => keepCase(m[0]!, 'вследствие') },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])что-бы(?![\p{L}])/giu, problem: 'Орфография: «что-бы».', why: 'Союз «чтобы» пишется слитно, без дефиса.', suggestion: 'Исправить на «чтобы».', severity: 'warning', alternative: (m) => keepCase(m[0]!, 'чтобы') },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])(из|из) (за|под)(?![\p{L}-])/giu, problem: 'Орфография: предлог пишется через дефис.', why: 'Составные предлоги «из-за», «из-под» пишутся через дефис.', suggestion: 'Поставить дефис.', severity: 'warning', alternative: (m) => `${m[1]}-${m[2]}` },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])(кто|что|где|когда|какой|какая|какое|какие|куда|зачем|почему) (то|нибудь)(?![\p{L}])/giu, problem: 'Орфография: частица «-то/-нибудь» пишется через дефис.', why: 'Неопределённые местоимения пишутся через дефис («кто-то», «что-нибудь»).', suggestion: 'Проверить и поставить дефис.', severity: 'suggestion', alternative: (m) => `${m[1]}-${m[2]}` },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])в течении (?=\d|\p{L}+ (?:дн|недел|месяц|лет|год|час|минут|секунд))/giu, problem: 'Орфография: «в течении» в значении времени.', why: 'В значении продолжительности пишется «в течение».', suggestion: 'Исправить на «в течение».', severity: 'warning', alternative: (m) => keepCase(m[0]!, 'в течение ') },
  { id: 'orthography', lang: 'ru', pattern: /(?<![\p{L}])(координальн|будующ|расчит|оффициальн|инциндент|извените)\p{L}*/giu, problem: 'Орфография: частая опечатка.', why: 'Слово с распространённой ошибкой (кардинально, будущий, рассчитать, официальный, инцидент, извините).', suggestion: 'Проверить написание.', severity: 'warning' },
  // Punctuation
  { id: 'punctuation-space-before', lang: 'ru', pattern: /(?<=[\p{L}\p{N}»)])[ \t]+[,;:!?](?!\S*[=<>])/gu, problem: 'Пробел перед знаком препинания.', why: 'Перед запятой, точкой с запятой, двоеточием, «!» и «?» пробел не ставится.', suggestion: 'Убрать пробел.', severity: 'suggestion' },
  { id: 'punctuation-space-after', lang: 'ru', pattern: /(?<=[\p{L}]),(?=[\p{L}])/gu, problem: 'Нет пробела после запятой.', why: 'После запятой ставится пробел.', suggestion: 'Добавить пробел.', severity: 'suggestion' },
  { id: 'punctuation-double', lang: 'ru', pattern: /,,|(?<!\.)\.\.(?!\.)|;;/gu, problem: 'Сдвоенный знак препинания.', why: 'Скорее всего, опечатка.', suggestion: 'Оставить один знак (или многоточие «…»).', severity: 'suggestion' },
  { id: 'punctuation-comma-no', lang: 'ru', pattern: /(?<=[\p{L}\p{N}»)])[ \t]+но[ \t]+/gu, problem: 'Возможно, пропущена запятая перед «но».', why: 'Перед противительным союзом «но» внутри предложения обычно ставится запятая.', suggestion: 'Проверить, нужна ли запятая.', severity: 'info' },
  // English
  { id: 'wordiness', lang: 'en', pattern: /\b(?:in order to|due to the fact that|at this point in time|is able to|make use of)\b/gi, problem: 'Wordy phrase.', why: 'A shorter phrase says the same.', suggestion: 'Shorten ("to", "because", "now", "can", "use").', severity: 'suggestion' },
];

export interface LanguageOptions {
  language: 'ru' | 'en';
  longSentenceWords: number;
}

export function languageFindings(doc: ReviewDocument, options: LanguageOptions): PendingFinding[] {
  const findings: PendingFinding[] = [];
  const taken: Array<[number, number, number]> = []; // block, start, end
  const overlaps = (block: number, a: number, b: number) => taken.some(([bl, s, e]) => bl === block && a < e && b > s);
  doc.parsed.blocks.forEach((block, blockIndex) => {
    if (!doc.prose.includes(block)) return;
    const text = blockProse(block);
    for (const rule of LANGUAGE_RULES.filter((r) => r.lang === options.language)) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        if (overlaps(blockIndex, start, end)) continue;
        taken.push([blockIndex, start, end]);
        const line = lineInBlock(block, text, start);
        const f: PendingFinding = { category: rule.category ?? 'language', rule: rule.id, severity: rule.severity, lines: { start: line, end: lineInBlock(block, text, end) }, excerpt: excerptOf(m[0].trim()), problem: rule.problem, why: rule.why, suggestion: rule.suggestion };
        const alt = rule.alternative?.(m);
        if (alt) f.alternative = alt;
        findings.push(f);
      }
    }
  });

  // Overlong sentences
  for (const s of doc.sentences) {
    const words = wordCount(s.text);
    if (words > options.longSentenceWords) {
      findings.push({
        category: 'language',
        rule: 'long-sentence',
        severity: words > options.longSentenceWords * 1.5 ? 'warning' : 'suggestion',
        lines: { start: s.line, end: s.line },
        excerpt: excerptOf(s.text, 120),
        problem: options.language === 'ru' ? `Очень длинное предложение (${words} слов).` : `Very long sentence (${words} words).`,
        why: options.language === 'ru' ? `Предложения длиннее ${options.longSentenceWords} слов трудно читать, особенно с техническими терминами.` : `Sentences longer than ${options.longSentenceWords} words are hard to follow.`,
        suggestion: options.language === 'ru' ? 'Разбить на два-три предложения.' : 'Split it into two or three sentences.',
      });
    }
  }

  // Word repetition inside one sentence. The article's subject terms (≥ 5 uses overall) are exempt.
  const docFreq = new Map<string, number>();
  for (const s of doc.sentences) for (const t of rawTokens(s.text)) if (t.length >= 5) docFreq.set(stem(t), (docFreq.get(stem(t)) ?? 0) + 1);
  for (const s of doc.sentences) {
    const counts = new Map<string, { surface: string; n: number }>();
    for (const token of rawTokens(s.text)) {
      if (token.length < 5 || isStopword(token) || /^\d/.test(token)) continue;
      const st = stem(token);
      const e = counts.get(st) ?? { surface: token, n: 0 };
      e.n += 1;
      counts.set(st, e);
    }
    const repeated = [...counts].filter(([st, c]) => c.n >= 2 && (docFreq.get(st) ?? 0) < 5).map(([, c]) => c);
    if (repeated.length) {
      findings.push({
        category: 'language',
        rule: 'word-repetition',
        severity: 'suggestion',
        lines: { start: s.line, end: s.line },
        excerpt: excerptOf(s.text, 120),
        problem: options.language === 'ru' ? `Повтор слова в одном предложении: ${repeated.map((r) => `«${r.surface}» ×${r.n}`).join(', ')}.` : `Repeated word in one sentence: ${repeated.map((r) => `"${r.surface}" ×${r.n}`).join(', ')}.`,
        why: options.language === 'ru' ? 'Повтор однокоренного слова рядом заметен и утомляет.' : 'A word repeated within one sentence is noticeable.',
        suggestion: options.language === 'ru' ? 'Заменить один повтор местоимением или перестроить предложение (если повтор не намеренный термин).' : 'Replace one occurrence or restructure, unless it is a deliberate term.',
      });
    }
  }

  // Unclear pronoun reference at the start of a paragraph after a heading/code/list
  const PRONOUN = options.language === 'ru' ? /^(?:Он|Она|Оно|Они|Это|Этот|Эта)\s/u : /^(?:It|They|This|These)\s/;
  const blocks = doc.parsed.blocks;
  blocks.forEach((b, i) => {
    if (b.kind !== 'paragraph' || i === 0) return;
    const prev = blocks[i - 1]!;
    if (prev.kind !== 'heading' && prev.kind !== 'code' && prev.kind !== 'image') return;
    const text = blockProse(b).trim();
    if (PRONOUN.test(text)) {
      findings.push({
        category: 'clarity',
        rule: 'unclear-reference',
        severity: 'info',
        lines: { start: b.startLine, end: b.startLine },
        excerpt: excerptOf(text.split(/\s+/).slice(0, 8).join(' ')),
        problem: options.language === 'ru' ? 'Абзац начинается с местоимения сразу после заголовка/кода.' : 'Paragraph opens with a pronoun right after a heading or code block.',
        why: options.language === 'ru' ? 'Непонятно, к чему относится местоимение: заголовок не всегда читается как антецедент.' : 'The referent may be unclear.',
        suggestion: options.language === 'ru' ? 'Назвать предмет явно.' : 'Name the subject explicitly.',
      });
    }
  });
  return findings;
}
