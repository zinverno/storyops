# Author input

`articles/<slug>/author-input.md` is the author's channel into the article:
phrases, anecdotes, jokes, half-thoughts, things to avoid. It is **editorial
source material, not evidence**. It never goes into `story.json`.

## Sections

| Section | Meaning | Audit |
| --- | --- | --- |
| `VERBATIM` | Exact phrase. Surrounding quotes are delimiters. | Checked literally; absent → error |
| `MUST USE` | The idea must appear; wording may change. | Needs an incorporation record; unmapped → error |
| `SHOULD USE` | Normally appears unless there is a strong reason. | Unmapped → warning |
| `MAY USE` | Optional ideas, examples, side notes. | No warning when unused |
| `BACKGROUND ONLY` | Context for you. Not published unless the author promotes it. | Publication not expected |
| `DO NOT USE` | Must not appear. Quoted fragments are checked literally. | Literal hit → error; paraphrases → your review |
| `RAW NOTES` | Unsorted thoughts. You triage them. | Like MAY |
| `PERSONAL CONTEXT` | Motives, experiences, reactions. The **only** legitimate source of first-person experiences. | Like MAY |
| `POSSIBLE HUMOR` | Optional jokes. | Like MAY |
| `QUESTIONS / UNCERTAINTIES` | What the author is unsure about. Never published as statements. | Answer them with the author |

Precedence: `DO NOT USE > VERBATIM / MUST USE > SHOULD USE > MAY USE > BACKGROUND ONLY`.

## Working with the author

- Any shape is fine: bullets, paragraphs, fragments with typos, Russian or English. One item per bullet or per paragraph.
- An empty file is valid. Do not make the author fill every section.
- Offer: "Если есть фразы, шутки или эпизоды, которые обязательно должны быть в статье, просто накидайте их сюда."
- Quick additions: `editorial-kit input add --story <story> --priority must --text "…"`.
- `editorial-kit input show --story <story>` prints items with their ids (ids change when the text changes; that is deliberate).

## Rules

- Author material outranks style presets, platform strategy and trends, but **not facts**. A MUST item that
  contradicts the evidence is not published as fact: tell the author and record the omission reason.
- A personal experience may appear only if the author supplied it (PERSONAL CONTEXT, RAW NOTES or chat).
- A joke from the author is theirs; do not "improve" a VERBATIM joke.
- Conflicts (a MUST item containing DO NOT USE wording, a joke vs a humorless style) are listed in
  `direction.json → conflicts`; resolve them with the author and write the resolution there.
- After the author edits the file, the plan becomes stale: `editorial validate` says
  "author input changed since voice plan was created". Run `editorial plan`, review, then clear `reviewRequired`.
