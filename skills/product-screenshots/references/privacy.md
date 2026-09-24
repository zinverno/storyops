# Screenshot privacy

Never expose: passwords, API keys, tokens, cookies, Authorization headers,
private URLs, email addresses (unless intentionally public), private user data,
environment variables.

## What the tool does

- Before each capture it scans visible page text and form values (outside
  `mask`/`hide` regions) for secret-like patterns (private keys, bearer tokens,
  GitHub/OpenAI/AWS/Slack/Google keys, JWTs, credential assignments, cookies,
  credentials in URLs) and for emails (unless `privacy.allowEmails`). Filled
  password fields also block the capture. Matched values are never logged.
- `mask` selectors are painted over in the image; `hide` selectors are made
  invisible. Both are recorded in `images/manifest.json`.
- Only the URL path is recorded in the manifest, not query strings.
- No cookies or storage state are persisted between runs; the tool never stores
  authentication sessions.

## What you must do

- Use a demo account and demo data.
- Never commit `.env`; keep secrets out of plans (`launch.env` values are passed
  to the app but not logged — still prefer non-secret demo configuration).
- Review every image manually; pattern scanning reduces risk, it does not prove absence.
- Redaction hooks: add selectors to `privacy.mask` globally or `steps[].mask` per shot.
