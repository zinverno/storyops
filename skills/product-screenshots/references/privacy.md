# Screenshot privacy

Never expose: passwords, API keys, tokens, cookies, Authorization headers,
private URLs, email addresses (unless intentionally public), private user data,
environment variables.

## What the tool does

- Before each capture it scans **visible DOM text and form values** (outside
  `mask`/`hide` regions) for secret-like patterns (private keys, bearer tokens,
  GitHub/OpenAI/AWS/Slack/Google keys, JWTs, credential assignments, cookies,
  credentials in URLs) and for emails (unless `privacy.allowEmails`). Filled
  password fields also block the capture. Matched values are never logged.
- `mask` selectors are painted over in the image; `hide` selectors are made
  invisible. Both are recorded in `images/manifest.json`.
- Only the URL path is recorded in the manifest, not query strings.
- Launch commands are logged as executable name + argument count; argument and
  environment values are never logged.
- No cookies or storage state are persisted between runs; the tool never stores
  authentication sessions.

## What the scan does NOT cover

The scan reads the DOM, not pixels. There is **no OCR**. It cannot see text in:

- `<img>`, `<picture>`, SVG `<image>` (logos, avatars, uploaded screenshots, charts rendered as images)
- `<canvas>` (charts, editors, maps, terminals drawn on canvas)
- `<video>`
- CSS `background-image`
- `<iframe>`, `<embed>`, `<object>` content

The capture counts these visible elements, records them as
`privacyScan.unscannedElements` in the manifest, logs a warning, and marks every
image `"visualReview": "required"`. A passing scan therefore means "no secrets
found in DOM text and form values", not "no secrets in the image".

## What you must do

- Use a demo account and demo data.
- Never commit `.env`; keep secrets out of plans (`launch.env` values are passed
  to the app but not logged — still prefer non-secret demo configuration).
- **Look at every image** (human or agent visual review) before it is used anywhere, then set
  `"visualReview": "passed"` in the manifest. Pattern scanning reduces risk; it does not prove absence.
- Redaction hooks: add selectors to `privacy.mask` globally or `steps[].mask` per shot.
