# Fact-check procedure

Run before calling any output done.

1. List every technical statement in the draft (names, behaviour, numbers, comparisons, "now it can…").
2. For each, find the claim in `story.json` it derives from. No claim → add it with evidence, or remove the statement.
3. Check its classification. Plans and hypotheses must read as plans and hypotheses.
4. Open the evidence (`evidence.md` excerpts, or the file itself) and confirm the statement matches it exactly: names, states, numbers, units.
5. Numbers: every number must come from a measurement with a method, or from code/tests (counts of states, config values). No rounding up.
6. Code snippets: copy from the repository at the evidenced revision; do not "clean up" into something that does not exist.
7. Screenshots: each must match the text next to it (same UI state, same data).
8. Comparisons with the previous state must match what the earlier publication actually said (`publication:<id>`).
9. Run `editorial-kit evidence verify -s <story>`; recheck anything that drifted.
10. Record anything you could not verify and tell the user.
