/**
 * Pure value parsers for Habr's human-formatted numbers and dates.
 */

const MONTHS: Record<string, number> = {
  янв: 0, фев: 1, мар: 2, апр: 3, мая: 4, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Habr displays times in Moscow time (UTC+3, no DST since 2014). */
const MSK_OFFSET_HOURS = 3;

export interface ParsedCount {
  value: number;
  approximate: boolean;
}

/** Parses "12K", "1.2K", "1,2K", "3.4M", "12 345", "Комментарии 12", "+52", "−3". */
export function parseCount(text: string | undefined): ParsedCount | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/[−–—]/g, '-').trim();
  const match = cleaned.match(/([+-]?)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*([KkКкMmМм])?/);
  if (!match) return undefined;
  const sign = match[1] === '-' ? -1 : 1;
  const numeric = Number(match[2]!.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return undefined;
  const suffix = match[3]?.toLowerCase();
  const multiplier = suffix === 'k' || suffix === 'к' ? 1_000 : suffix === 'm' || suffix === 'м' ? 1_000_000 : 1;
  return { value: Math.round(sign * numeric * multiplier), approximate: multiplier > 1 };
}

/** Parses "Всего голосов 58: ↑55 и ↓3" style vote breakdowns. */
export function parseVotes(title: string | undefined): { total?: number; up?: number; down?: number } {
  if (!title) return {};
  const total = title.match(/(?:голосов|votes?)\s*:?\s*(\d+)/i);
  const up = title.match(/↑\s*(\d+)/);
  const down = title.match(/↓\s*(\d+)/);
  const result: { total?: number; up?: number; down?: number } = {};
  if (total) result.total = Number(total[1]);
  if (up) result.up = Number(up[1]);
  if (down) result.down = Number(down[1]);
  return result;
}

function mskToIso(year: number, month: number, day: number, hours: number, minutes: number): string {
  return new Date(Date.UTC(year, month, day, hours - MSK_OFFSET_HOURS, minutes)).toISOString();
}

/**
 * Parses a Habr date. Preference: ISO `datetime` attribute, then the
 * "2024-05-13, 12:01" title attribute, then Russian display text such as
 * "13 мая 2024 в 12:01", "13 мая в 12:01" (current year), "вчера в 12:01",
 * "сегодня в 09:15". Display text is interpreted as Moscow time.
 */
export function parseHabrDate(input: { datetime?: string; title?: string; text?: string }, now: Date): string | undefined {
  if (input.datetime) {
    const d = new Date(input.datetime);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (input.title) {
    const m = input.title.match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{1,2}):(\d{2})/);
    if (m) return mskToIso(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }
  const text = input.text?.toLowerCase().replace(/\u00a0/g, ' ').trim();
  if (!text) return undefined;
  const nowMsk = new Date(now.getTime() + MSK_OFFSET_HOURS * 3_600_000);
  const time = text.match(/(\d{1,2}):(\d{2})/);
  const hh = time ? Number(time[1]) : 0;
  const mm = time ? Number(time[2]) : 0;
  const relative = text.match(/^(сегодня|вчера|today|yesterday)/);
  if (relative) {
    const offsetDays = relative[1] === 'вчера' || relative[1] === 'yesterday' ? 1 : 0;
    const base = new Date(nowMsk.getTime() - offsetDays * 86_400_000);
    return mskToIso(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm);
  }
  const abs = text.match(/(\d{1,2})\s+([a-zа-я]{3})[a-zа-я]*\.?\s*(\d{4})?/);
  if (abs) {
    const month = MONTHS[abs[2]!];
    if (month === undefined) return undefined;
    const year = abs[3] ? Number(abs[3]) : nowMsk.getUTCFullYear();
    return mskToIso(year, month, Number(abs[1]), hh, mm);
  }
  return undefined;
}

/** Extracts the numeric article id from Habr article URLs (articles, company blogs, legacy /post/). */
export function habrArticleId(url: string): string | undefined {
  const m = url.match(/\/(?:articles|post|news|blog\/[^/]+)\/(\d+)(?:\/|$|\?|#)/) ?? url.match(/\/companies\/[^/]+\/(?:articles|news)\/(\d+)/);
  return m?.[1];
}

export function hubSlugFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/hubs?\/([^/?#]+)/)?.[1];
}
