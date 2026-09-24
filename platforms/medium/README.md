# Medium

| Capability | Status |
| --- | --- |
| Strategy | implemented |
| Live trend research | **unsupported** |
| Author history | manual import (`editorial-kit author import <file> -p medium`) |
| Renderer | default scaffold renderer |

Why no live research: public tag feeds exist but do not expose engagement
metrics, so a momentum signal cannot be computed honestly. A future adapter may
add structural-only observations; it must report that limitation.

Assumptions (verify): the editor does not render Markdown tables; the number of
topics/tags per story is limited (historically five).
