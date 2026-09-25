# LinkedIn

| Capability | Status |
| --- | --- |
| Strategy (analysis + review fit) | implemented |
| Live trend research | **unsupported** (feed content requires authentication; not scraped) |
| Author history | manual import (`storyops author import <file> -p linkedin`) |
| Dataset import | yes (`storyops research import`) |

Hard constraints used by platform-fit review: 3,000-character post limit
(verify against LinkedIn help), no Markdown rendering. Everything else is
context. StoryOps does not fabricate LinkedIn activity data.
