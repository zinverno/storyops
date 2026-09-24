/**
 * Minimal robots.txt (RFC 9309) evaluator: user-agent groups, Allow/Disallow,
 * longest-match precedence, `*` wildcards and `$` anchors. Crawl-delay is
 * surfaced so the HTTP client can honour it when it is larger than our own
 * delay.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds?: number;
}

export function parseRobots(content: string, userAgentToken: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | undefined;
  let lastWasAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' && value) current.rules.allow.push(value);
    else if (key === 'disallow' && value) current.rules.disallow.push(value);
    else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.rules.crawlDelaySeconds = n;
    }
  }

  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const merged: RobotsRules = { allow: [], disallow: [] };
  for (const g of chosen) {
    merged.allow.push(...g.rules.allow);
    merged.disallow.push(...g.rules.disallow);
    if (g.rules.crawlDelaySeconds !== undefined) merged.crawlDelaySeconds = Math.max(merged.crawlDelaySeconds ?? 0, g.rules.crawlDelaySeconds);
  }
  return merged;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { length: number; allow: boolean } | undefined;
  const consider = (patterns: string[], allow: boolean) => {
    for (const p of patterns) {
      if (patternToRegex(p).test(pathWithQuery)) {
        const length = p.length;
        if (!best || length > best.length || (length === best.length && allow)) best = { length, allow };
      }
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best ? best.allow : true;
}
