---
name: product-screenshots
description: Plans and captures consistent, privacy-safe product screenshots with Playwright for technical articles. Derives a screenshot plan from the canonical story (each shot has a narrative purpose), starts the local app, navigates to the exact UI state, masks private data, blocks captures whose DOM text or form values look like secrets (pixels are not scanned, so every image needs visual review), and stores canonical originals that are never overwritten. Use when an article or post needs real screenshots of a web product.
license: MIT
compatibility: Needs the editorial-kit CLI, Node.js 20.19+, Playwright and a Chromium build (npx playwright install chromium, or EDITORIAL_CHROMIUM_PATH). Web targets are supported; Electron capture is experimental and untested.
metadata:
  version: "0.1.0"
  repository: "https://github.com/zinverno/storyops"
---

# product-screenshots

Screenshots are evidence and explanation, not decoration. Every screenshot has
a purpose and supports a specific section.

## Workflow

1. Plan from the story: `editorial-kit screenshots plan -s articles/<slug>/story.json --base-url http://localhost:3000`
   → `screenshot-plan.json` + `screenshot-plan.md`. See [references/screenshot-planning.md](references/screenshot-planning.md).
2. Complete the plan: real `path`s, ready-state selectors (`waitFor`), actions, `mask`/`hide`,
   optional `launch` command with `readyUrl`. Use realistic demo data.
3. Capture: `editorial-kit screenshots capture --plan articles/<slug>/screenshot-plan.json`
   → `articles/<slug>/images/originals/` + `images/manifest.json`.
4. **Visually review every image** (open it and look) against [references/screenshot-quality.md](references/screenshot-quality.md)
   and [references/privacy.md](references/privacy.md). The automatic scan does not see pixels. Only then set
   `"visualReview": "passed"` for that image in `images/manifest.json`.
5. Reference useful images in the story as `screenshot:<file>` evidence.
6. When an editorial plan exists, record in `editorial/direction.json → visuals` which section and which story
   claim each image supports, and add the visual id to the voice-plan beat that uses it (`visualIds`).

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

- Browser missing → `editorial-kit doctor --browser`; install Chromium or set `EDITORIAL_CHROMIUM_PATH`.
- App does not start / ready URL times out → report it; do not fabricate or mock screenshots.
- Privacy check fails → mask/hide the region or switch to demo data, then recapture.
- Electron: experimental code path, not tested in this repository. Say so if used.
