# Duplicate-topic detection

`storyops author overlap "<topic>"` compares a candidate with the author's
archive. It never outputs a bare similarity number. It returns:

- **Overlap level** from the coverage map: not covered → none, briefly
  mentioned → low, covered → medium, deeply covered → high;
- **Already covered**: the publications, their dates and coverage level;
- **Similar publications**: lexical (TF-IDF cosine) matches with shared terms,
  as supporting context only;
- **New material**: repository events on the topic after the last publication;
- **Interpretation**, e.g. *"The general subject has been discussed (covered),
  but 3 repository changes since then have not."*

`storyops topics compare "<a>" "<b>" …` shows the same dimensions side by side
for several candidates. There is no winner.

For platform saturation of the same theme, use `storyops saturation --topic`.
A crowded platform theme is context: the author decides whether a distinct
angle exists.
