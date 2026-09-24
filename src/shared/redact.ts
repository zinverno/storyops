/**
 * Secret detection and redaction. Used by the logger, evidence collection,
 * project inspection and screenshot privacy checks.
 *
 * These patterns are conservative heuristics: they reduce the chance of
 * leaking a credential, they do not prove the absence of one.
 */

export interface SecretPattern {
  id: string;
  description: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: 'private-key', description: 'PEM private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { id: 'authorization-header', description: 'Authorization header value', pattern: /\b(authorization\s*[:=]\s*)(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { id: 'bearer-token', description: 'Bearer token', pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { id: 'github-token', description: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g },
  { id: 'openai-key', description: 'OpenAI-style API key', pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'aws-access-key', description: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'slack-token', description: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', description: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt', description: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    id: 'assignment',
    description: 'Credential-like assignment (password=, api_key: ...)',
    pattern: /\b((?:[a-z0-9_]*_)?(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*)(["']?)[^\s"'`,;]{6,}\2/gi,
  },
  { id: 'cookie-header', description: 'Cookie header', pattern: /\b((?:set-)?cookie\s*:\s*)[^\n]{8,}/gi },
  { id: 'url-credentials', description: 'Credentials embedded in URL', pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi },
];

export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export interface SecretFinding {
  patternId: string;
  description: string;
  /** Index in the scanned text. The matched value itself is intentionally not returned. */
  index: number;
}

export function findSecrets(text: string, options: { includeEmails?: boolean } = {}): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { id, description, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      findings.push({ patternId: id, description, index: match.index ?? 0 });
    }
  }
  if (options.includeEmails) {
    for (const match of text.matchAll(new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags))) {
      findings.push({ patternId: 'email', description: 'Email address', index: match.index ?? 0 });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

export function redactSecrets(text: string, options: { redactEmails?: boolean } = {}): string {
  let result = text;
  for (const { id, pattern } of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (id === 'assignment' || id === 'authorization-header' || id === 'cookie-header') {
      result = result.replace(regex, (_m, prefix: string) => `${prefix}[REDACTED]`);
    } else if (id === 'url-credentials') {
      result = result.replace(regex, (_m, scheme: string) => `${scheme}[REDACTED]@`);
    } else {
      result = result.replace(regex, '[REDACTED]');
    }
  }
  if (options.redactEmails) {
    result = result.replace(new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags), '[REDACTED_EMAIL]');
  }
  return result;
}

/**
 * Paths that evidence collection and project inspection never read.
 * Matching is done on POSIX-style relative paths.
 */
const SECRET_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env($|\.(?!example$|sample$|template$)[^/]*$)/i,
  /(^|\/)\.envrc$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn)$/i,
  /(^|\/)(credentials|secrets?)(\.[a-z]+)?$/i,
  /(^|\/)[^/]*secret[^/]*\.(json|ya?ml|toml|ini|txt)$/i,
  /(^|\/)service[-_]?account[^/]*\.json$/i,
  /(^|\/)\.editorial\/cache\//i,
];

export function isSecretPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Removes query strings and fragments that could carry tokens from URLs before logging/storing them. */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    const sensitive = /token|key|secret|auth|session|sig|password|code/i;
    for (const name of [...parsed.searchParams.keys()]) {
      if (sensitive.test(name)) parsed.searchParams.set(name, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return redactSecrets(url);
  }
}
