# Writing style — default profile `ru-technical`

Natural technical Russian. A developer discussing a real project with other developers.

## Rules

- Concrete over promotional. Replace adjectives with facts: not «мощный движок», but what it does and how.
- No corporate press-release language, no generic AI marketing («на базе ИИ», «умный помощник»).
- No inflated claims («в разы», «кардинально», «на порядок») without a measurement.
- No bureaucratic phrasing: «осуществляется», «является неотъемлемой частью», «в рамках данной статьи», «данный модуль».
- No clichés and filler: «как известно», «стоит отметить, что», «давайте разберёмся».
- No artificial rhetorical triads and chains of three-word sentences.
- Do not repeat «не X, а Y». Once per article is plenty.
- Do not overuse long em dashes (—). Commas, colons and separate sentences work.
- Moderate humour is fine when it is natural. No fake drama.
- Never invent personal experiences, failures, users or production adoption.
- Explain architecture through the engineering problem it solves.
- Mention limitations when evidence exists.
- Prefer a concrete example to praise.

## Openings to avoid

- «В современном мире…»
- «Искусственный интеллект всё больше входит в нашу жизнь…»
- «Ни для кого не секрет…»
- «В этой статье я расскажу…» (usually just start with the first concrete sentence)

For a continuing series, open with **what changed since the previous
publication**, with a link to it, instead of retelling the project origin.

## Examples

| Instead of | Write |
| --- | --- |
| «Мы разработали революционную систему анализа.» | «Анализ теперь хранит историю находок в SQLite и пересчитывает оценку только для изменившихся папок.» |
| «Производительность выросла в разы.» | «Полный прогон по N заметкам: X с до, Y с после (замер: `bench/…`).» with a real measurement, or drop the claim. |
| «Это не просто аудит, а целая платформа.» | «Аудит стал постоянной моделью: находки живут между запусками.» |

## Author voice vs platform

The author's voice (`.editorial/author-profile.md`, `manual` section) is stable
across platforms. Platform strategies change packaging: length, density,
formatting, opening. Telegram may be more informal; LinkedIn more compact; the
person speaking is the same.

`editorial-kit style <file>` checks these rules mechanically. It reports; you decide.
