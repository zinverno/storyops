# Screenshot planning

The plan is written by the author (or with the author): which product states
the article they are writing needs to show, and why. StoryOps does not derive
plans from articles or stories. Purposes, for example:

```
1. Dashboard
Purpose: show the reader the primary user-facing entry point.
Supports: section describing the new health overview.

2. Finding details
Purpose: show evidence/explainability.
Supports: section explaining why the new lifecycle matters.
```

## Plan schema (v1)

```json
{
  "schemaVersion": 1,
  "target": { "kind": "web" },
  "baseUrl": "http://localhost:3000",
  "launch": { "command": "npm", "args": ["run", "dev"], "cwd": "../../app", "readyUrl": "http://localhost:3000/health" },
  "viewport": { "width": 1440, "height": 1000 },
  "privacy": { "blockOnSecrets": true, "allowEmails": false, "mask": ["[data-private]"], "hide": ["#debug-panel"] },
  "steps": [
    {
      "name": "dashboard",
      "path": "/",
      "actions": [{ "type": "click", "selector": "text=Health" }],
      "waitFor": "[data-ready=true]",
      "screenshot": "01-dashboard.png",
      "clip": "main",
      "purpose": "…",
      "supports": "…"
    }
  ]
}
```

Actions: `click`, `fill`, `press`, `hover`, `scroll`, `waitForSelector`, `wait` (last resort).
`launch` runs a local command from the plan: only run plans you trust.

## Platform variants

Originals are platform-neutral. Platform-specific derivatives (square crops for
LinkedIn, phone-friendly crops for Telegram, annotations, carousels) belong in
`images/outputs/<platform>/` and are produced from originals without modifying them.
