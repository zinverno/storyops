---
name: product-screenshots
description: Optional StoryOps utility. Captures consistent, privacy-safe screenshots of a running web product with Playwright from a plan the author wrote (each shot has a purpose), masks private data, blocks captures whose DOM text or form values look like secrets (pixels are not scanned, so every image needs visual review) and stores originals that are never overwritten. Use when the author needs real product screenshots for an article they are writing. It does not plan or write the article.
license: MIT
compatibility: Needs the storyops CLI, Node.js 20.19+, Playwright and a Chromium build (npx playwright install chromium, or STORYOPS_CHROMIUM_PATH). Web targets are supported; Electron capture is experimental and untested.
metadata:
  version: "0.3.0"
  repository: "https://github.com/zinverno/storyops"
---

# product-screenshots

Screenshots are evidence and explanation for an article the **author** writes.
This utility captures them; it never plans the article, writes captions as
article text, or decides where images go in the text.

## Workflow

1. The author (or you, with the author) writes a plan: see
   `examples/screenshot-plan.example.json` and [references/screenshot-planning.md](references/screenshot-planning.md).
   Every step has a `purpose`, a real `path`, a ready-state selector (`waitFor`), optional actions,
   `mask`/`hide`, and an optional `launch` command with `readyUrl`. Use realistic demo data.
2. Capture: `storyops screenshots capture --plan screenshot-plan.json [--out images]`
   → `images/originals/` + `images/manifest.json`.
3. **Visually review every image** (open it and look) against [references/screenshot-quality.md](references/screenshot-quality.md)
   and [references/privacy.md](references/privacy.md). The automatic scan does not see pixels. Only then set
   `"visualReview": "passed"` for that image in `images/manifest.json`.

## Decision rules

- No screenshot without a narrative purpose; do not add screenshots to increase length.
- Capture the exact state the text describes; wait for a meaningful ready selector, not a fixed sleep.
- Consistent viewport per article (config `screenshots.viewport`, default 1440×1000).
- Prefer `clip` (element screenshot) when the interesting area is small; avoid misleading crops.
- Never alter application behaviour to make screenshots prettier. Hiding debug panels
  (`hide`) and masking private regions (`mask`) are explicit and recorded in the manifest.
- Privacy first: [references/privacy.md](references/privacy.md). Captures whose **DOM text or form values** contain
  secret-like strings or unmasked emails are blocked. Text inside images, canvas, video, CSS background images or
  iframes is **not** inspected (no OCR): never describe a screenshot as "scanned for secrets" without a visual review.
- Never publish an image whose manifest entry still says `"visualReview": "required"`.
- Canonical originals are never overwritten; `--replace` archives the previous file to `originals/.history/`.
  Platform-specific crops/resizes go to `images/outputs/<platform>/`.

## Failure behavior

- Browser missing → `storyops doctor --browser`; install Chromium or set `STORYOPS_CHROMIUM_PATH`.
- App does not start / ready URL times out → report it; do not fabricate or mock screenshots.
- Privacy check fails → mask/hide the region or switch to demo data, then recapture.
- Electron: experimental code path, not tested in this repository. Say so if used.
