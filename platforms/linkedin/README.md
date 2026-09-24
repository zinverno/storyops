# LinkedIn

| Capability | Status |
| --- | --- |
| Strategy | implemented |
| Live trend research | **unsupported** (feed content requires authentication; not scraped) |
| Author history | manual import (`editorial-kit author import <file> -p linkedin`) |
| Renderer | default scaffold renderer (no headings) |

Hard constraints encoded: 3,000-character post limit (verify against LinkedIn
help), no Markdown rendering. Everything else (first lines before "see more",
single visual, short paragraphs) is an editorial recommendation. The strategy
explicitly discourages motivational influencer copy and engagement bait.
