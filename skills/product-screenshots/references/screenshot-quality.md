# Screenshot quality checklist

- [ ] Consistent viewport and device scale factor across the article.
- [ ] No loading spinners, skeletons or half-rendered charts (use a ready selector).
- [ ] No debug panels, dev toolbars, error overlays (hide them explicitly in the plan).
- [ ] No secrets, tokens, private URLs, personal data (privacy.md) — checked **visually**, including images, canvas,
      video and backgrounds, which the automatic scan cannot read.
- [ ] No unrelated notifications, toasts or cookie banners covering the UI.
- [ ] No mouse cursor or hover state covering important UI (the capture moves the pointer away).
- [ ] Realistic demo data, not "test test asdf" and not real customer data.
- [ ] The UI state is exactly the one the text describes.
- [ ] The interesting area is not tiny inside a giant screenshot (use `clip`).
- [ ] Crops do not mislead (no hiding of errors or context that changes meaning).
- [ ] The manifest records purpose, location, viewport, masks and hidden regions.
- [ ] `visualReview` set to `passed` only after looking at the image.
