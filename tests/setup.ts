/**
 * Tests must never touch the live network. Any fetch to a non-local host
 * fails loudly; tests inject their own fetch implementations or use fixtures.
 */
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') return realFetch(input, init);
  throw new Error(`Live network access is not allowed in tests (attempted ${url.origin})`);
}) as typeof fetch;
