/**
 * Deterministic text utilities shared by similarity, indexing and research.
 * Supports Russian and English, which are the initial target languages.
 * Nothing here calls external services.
 */

const RU_STOPWORDS = new Set(
  (
    'и в во не что он на я с со как а то все всё она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее неё сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это эта также который которые которая которое которых которой котором которую которым которыми этих свой кого кому чей чья чьё чье нём нем ею ими своей своих весь очень просто нужно можно будут может быть каждый каждая каждое каждом каждого какие такие такое так как тоже либо дальше вообще пока просто почти сразу лишь '
  ).split(/\s+/).filter(Boolean),
);

const EN_STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from into onto over under about as is are was were be been being it its this that these those i we you he she they them our your my me us his her their not no yes do does did done have has had can could should would will shall may might must so than too very just also only there here what which who whom whose when where why how all any both each few more most other some such own same up down out off again further once s t don now via per vs etc using use used'
  ).split(/\s+/).filter(Boolean),
);

export function isStopword(token: string): boolean {
  return RU_STOPWORDS.has(token) || EN_STOPWORDS.has(token);
}

/** Lowercases, folds ё→е and strips everything except letters, digits and in-word hyphens. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[`*_#>|~[\](){}<>"«»„“”'’.,:;!?/\\=+@$%^&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rawTokens(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 0);
}

const RU_SUFFIXES = [
  'иями', 'ями', 'ами', 'ией', 'иям', 'ием', 'иях', 'ость', 'ости', 'остью', 'остей',
  'ения', 'ение', 'ений', 'ением', 'ению', 'ании', 'ание', 'аний', 'анием',
  'ировать', 'ировали', 'ировал', 'ирован', 'ованный', 'ованная', 'ованное', 'ованные',
  'ывать', 'ивать', 'ывал', 'ивал',
  'ого', 'ему', 'ому', 'ыми', 'ими', 'ых', 'их', 'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей',
  // Past-tense verb endings (-ал/-ила…) are deliberately absent: they collide with
  // nouns ("правило", "сигнал"); single-letter stripping still groups past forms.
  'ешь', 'ете', 'ите', 'ишь', 'ать', 'ять', 'еть', 'ить', 'ыть',
  'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ов', 'ев', 'ей',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
];

const EN_SUFFIXES = ['ational', 'ization', 'ations', 'ation', 'ements', 'ement', 'ments', 'ment', 'ings', 'ing', 'ness', 'ities', 'ity', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 'ly', 's'];

/**
 * Light, deterministic suffix-stripping stemmer. It is intentionally simple:
 * the goal is stable grouping of word forms ("архитектура", "архитектуры"),
 * not linguistic accuracy.
 */
export function stem(token: string): string {
  if (/^[0-9]/.test(token)) return token;
  const isCyrillic = /[а-я]/.test(token);
  const suffixes = isCyrillic ? RU_SUFFIXES : EN_SUFFIXES;
  const minStem = isCyrillic ? 4 : 3;
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && token.length - suffix.length >= minStem) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

export interface TokenizeOptions {
  stem?: boolean;
  keepStopwords?: boolean;
  minLength?: number;
}

export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const minLength = options.minLength ?? 2;
  const tokens: string[] = [];
  for (const token of rawTokens(text)) {
    if (token.length < minLength) continue;
    if (!options.keepStopwords && isStopword(token)) continue;
    if (/^\d+$/.test(token) && token.length < 3) continue;
    tokens.push(options.stem === false ? token : stem(token));
  }
  return tokens;
}

/** Adjacent token pairs, useful for phrase-level overlap ("finding lifecycle"). */
export function bigrams(tokens: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) result.push(`${tokens[i]} ${tokens[i + 1]}`);
  return result;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ0-9«"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function wordCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(text: string, maxLength = 60): string {
  const transliterated = [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  const slug = transliterated
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function countBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
