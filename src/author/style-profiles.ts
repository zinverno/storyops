/**
 * Style profiles are data: pattern rules plus density thresholds. The
 * checker reports findings; it never rewrites text.
 */
export interface PatternRule {
  id: string;
  pattern: RegExp;
  message: string;
  severity: 'error' | 'warning' | 'info';
  /** Only check the first N characters (for openings). */
  withinFirstChars?: number;
}

export interface StyleProfile {
  id: string;
  language: string;
  description: string;
  rules: PatternRule[];
  thresholds: {
    /** Long em dashes per 1000 words. */
    emDashPer1000: number;
    /** "не X, а Y" constructions per 1000 words. */
    notXButYPer1000: number;
    exclamationsPer1000: number;
    /** Share of sentences longer than this many words. */
    longSentenceWords: number;
    longSentenceShare: number;
  };
  guidance: string[];
}

const ru: StyleProfile = {
  id: 'ru-technical',
  language: 'ru',
  description: 'Natural technical Russian: a developer discussing a real project. Concrete, not promotional.',
  rules: [
    { id: 'generic-opening', pattern: /^\s*(?:#[^\n]*\n\s*)?(?:в современном мире|в наше время|в наши дни|ни для кого не секрет|искусственный интеллект вс[её] больше|сегодня (?:уже )?сложно представить|технологии развиваются)/i, message: 'Generic introduction. Start from the concrete situation or from what changed since the previous publication.', severity: 'error', withinFirstChars: 400 },
    { id: 'announce-opening', pattern: /^\s*(?:#[^\n]*\n\s*)?(?:в этой статье (?:я|мы) (?:расскажу|расскажем|поговорим)|сегодня (?:я|мы) (?:расскажу|расскажем|поговорим))/i, message: 'Announcing the article instead of starting it. Usually the first concrete sentence works better.', severity: 'warning', withinFirstChars: 300 },
    { id: 'marketing', pattern: /революционн|уникальн(?:ое|ый|ая) решени|не имеющ\p{L}* аналогов|мощн(?:ый|ейший) инструмент|инновационн|прорывн|беспрецедентн|game[- ]changer|cutting[- ]edge|seamless(?:ly)?|best[- ]in[- ]class/iu, message: 'Promotional wording. Replace with a concrete property or drop it.', severity: 'warning' },
    { id: 'ai-marketing', pattern: /на базе (?:ии|искусственного интеллекта)|ai[- ]powered|умн(?:ый|ого) помощник|магия (?:ии|нейросетей)|волшебств/iu, message: 'Generic AI marketing. Say what the component actually does.', severity: 'warning' },
    { id: 'bureaucratic', pattern: /(?:является неотъемлемой частью|играет ключевую роль|в рамках данной|данный (?:подход|инструмент|модуль|проект)|осуществля\p{L}+|в целях обеспечения|на сегодняшний день|производится (?:\p{L}+ )?(?:обработка|проверка|запуск))/iu, message: 'Bureaucratic phrasing. Use a plain verb.', severity: 'warning' },
    { id: 'cliche', pattern: /(?:как известно|не секрет, что|стоит отметить, что|важно понимать, что|давайте разберёмся|давайте разберемся|без лишних слов|итак, приступим)/iu, message: 'Cliché filler.', severity: 'info' },
    { id: 'inflated-claim', pattern: /(?:в разы|кардинально|многократно|на порядок|драматически|колоссальн|в десятки раз)/iu, message: 'Inflated quantitative claim. Back it with a measurement or soften it.', severity: 'warning' },
    { id: 'invented-adoption', pattern: /(?:тысячи|сотни|миллионы) (?:пользователей|компаний|разработчиков)|используют в продакшене|used in production by/iu, message: 'Adoption/usage claim. Only keep it with evidence.', severity: 'warning' },
  ],
  thresholds: { emDashPer1000: 12, notXButYPer1000: 2, exclamationsPer1000: 3, longSentenceWords: 40, longSentenceShare: 0.15 },
  guidance: [
    'Write like a developer discussing a real project; concrete over promotional.',
    'For a continuing series, start from what changed since the previous publication.',
    'Explain architecture through actual engineering problems.',
    'Mention limitations when evidence exists. Never invent experiences, failures, users or adoption.',
    'Avoid repetitive "не X, а Y", artificial triads and heavy em-dash use.',
    'Moderate natural humour is fine; no fake drama.',
  ],
};

const en: StyleProfile = {
  id: 'en-technical',
  language: 'en',
  description: 'Plain technical English: concrete, specific, no hype.',
  rules: [
    { id: 'generic-opening', pattern: /^\s*(?:#[^\n]*\n\s*)?(?:in today's (?:fast-paced )?world|in the modern world|it's no secret that|ai is (?:increasingly|rapidly))/i, message: 'Generic introduction.', severity: 'error', withinFirstChars: 400 },
    { id: 'marketing', pattern: /revolutionary|game[- ]changer|cutting[- ]edge|seamless(?:ly)?|best[- ]in[- ]class|unparalleled|next[- ]gen/i, message: 'Promotional wording.', severity: 'warning' },
    { id: 'ai-marketing', pattern: /ai[- ]powered|magic of ai|supercharge/i, message: 'Generic AI marketing.', severity: 'warning' },
    { id: 'inflated-claim', pattern: /(?:orders of magnitude|dramatically|massively|10x)/i, message: 'Inflated claim; back it with a measurement.', severity: 'warning' },
  ],
  thresholds: { emDashPer1000: 12, notXButYPer1000: 3, exclamationsPer1000: 3, longSentenceWords: 35, longSentenceShare: 0.15 },
  guidance: ['Concrete over promotional.', 'State limitations.', 'Never invent users, results or experiences.'],
};

export const STYLE_PROFILES: Record<string, StyleProfile> = { [ru.id]: ru, [en.id]: en };
