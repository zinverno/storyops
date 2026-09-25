# Medium

| Capability | Status |
| --- | --- |
| Strategy (analysis + review fit) | implemented |
| Live trend research | **unsupported** |
| Author history | manual import (`storyops author import <file> -p medium`) |
| Dataset import | yes (`storyops research import`) |

Why no live research: public tag feeds exist but do not expose engagement
metrics, so activity cannot be estimated honestly. Import a dataset you
collected yourself instead; StoryOps records that it did not collect it.

Assumptions (verify): the editor does not render Markdown tables; the number of
topics/tags per story is limited (historically five).
