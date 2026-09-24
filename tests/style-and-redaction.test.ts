import { describe, expect, it } from 'vitest';
import { checkStyle } from '../src/author/style-check.js';
import { findSecrets, isSecretPath, redactSecrets, sanitizeUrl } from '../src/shared/redact.js';
import { memoryLogger } from '../src/shared/logger.js';

describe('style review (ru-technical)', () => {
  it('flags generic openings, marketing and inflated claims', () => {
    const r = checkStyle('В современном мире технологии развиваются. Мы сделали революционный инструмент, который ускорил работу в разы.');
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['generic-opening', 'marketing', 'inflated-claim']));
    expect(r.findings.find((f) => f.rule === 'generic-opening')?.severity).toBe('error');
  });

  it('flags repetitive "не X, а Y" and heavy em-dash use, ignoring code and comments', () => {
    const body = Array.from({ length: 30 }, (_, i) => `Это не просто модуль ${i}, а подсистема — с историей — и состоянием.`).join(' ');
    const r = checkStyle(`<!-- В современном мире -->\n\`\`\`\nВ современном мире\n\`\`\`\n${body}`);
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toContain('not-x-but-y');
    expect(rules).toContain('em-dash-density');
    expect(rules).not.toContain('generic-opening');
  });

  it('accepts plain concrete technical text', () => {
    const r = checkStyle('В прошлой статье аудит запускался заново при каждом прогоне. Теперь находки хранятся в SQLite, а оценка пересчитывается только для изменившихся папок.');
    expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });
});

describe('secret handling', () => {
  it('finds and redacts common secret shapes without returning values', () => {
    const text = 'token ghp_abcdefghijklmnopqrstuvwxyz0123 and password=hunter2hunter and Authorization: Bearer abcdefghijklmnop1234 at https://user:pw@host/x';
    const found = findSecrets(text).map((f) => f.patternId);
    expect(found).toEqual(expect.arrayContaining(['github-token', 'assignment', 'authorization-header', 'url-credentials']));
    const red = redactSecrets(text);
    expect(red).not.toMatch(/ghp_|hunter2|abcdefghijklmnop1234|user:pw/);
    expect(JSON.stringify(findSecrets(text))).not.toContain('hunter2');
    expect(redactSecrets('mail me: a.b@example.com', { redactEmails: true })).toBe('mail me: [REDACTED_EMAIL]');
  });

  it('recognises secret paths', () => {
    for (const p of ['.env', 'app/.env.local', 'id_rsa', 'certs/server.pem', 'config/credentials.json', 'secrets.yaml', '.npmrc']) expect(isSecretPath(p)).toBe(true);
    for (const p of ['.env.example', 'src/env.ts', 'docs/secrets-management.md', 'README.md']) expect(isSecretPath(p)).toBe(false);
  });

  it('sanitises URLs and never logs secrets', () => {
    expect(sanitizeUrl('https://u:p@x.com/a?token=abc&q=1')).toBe('https://x.com/a?token=REDACTED&q=1');
    const log = memoryLogger();
    log.info('using key sk-proj-abcdefghijklmnopqrstuvwxyz', { header: 'Authorization: Bearer abcdefghijklmnopqrstu' });
    expect(JSON.stringify(log.records)).not.toMatch(/sk-proj-abc|abcdefghijklmnopqrstu/);
  });
});
