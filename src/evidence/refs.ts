/**
 * Evidence reference syntax used in canonical stories:
 *   src/health/model.ts            file (relative to the project root)
 *   src/health/model.ts#L10-L40    line range
 *   src/health/                    directory
 *   commit:3f2a1bc                 commit (any unambiguous prefix)
 *   tag:v0.3.0                     tag
 *   publication:habr:812345        an indexed publication
 *   screenshot:01-dashboard.png    canonical screenshot of this article
 *   https://…                      external URL (recorded, not fetched)
 */
export type ParsedRef =
  | { type: 'file'; path: string; lines?: [number, number] }
  | { type: 'commit'; rev: string }
  | { type: 'tag'; name: string }
  | { type: 'publication'; id: string }
  | { type: 'screenshot'; file: string }
  | { type: 'url'; url: string };

export function parseRef(ref: string): ParsedRef | undefined {
  const r = ref.trim();
  if (!r) return undefined;
  if (/^https?:\/\//i.test(r)) return { type: 'url', url: r };
  const prefixed = r.match(/^(commit|tag|publication|screenshot):(.+)$/);
  if (prefixed) {
    const value = prefixed[2]!.trim();
    switch (prefixed[1]) {
      case 'commit':
        return { type: 'commit', rev: value };
      case 'tag':
        return { type: 'tag', name: value };
      case 'publication':
        return { type: 'publication', id: value };
      default:
        return { type: 'screenshot', file: value };
    }
  }
  if (r.includes('..') || r.startsWith('/')) return undefined; // never escape the project root
  const lines = r.match(/^(.+?)#L(\d+)(?:-L?(\d+))?$/);
  if (lines) {
    const start = Number(lines[2]);
    const end = Number(lines[3] ?? lines[2]);
    return { type: 'file', path: lines[1]!, lines: [start, Math.max(start, end)] };
  }
  return { type: 'file', path: r };
}
