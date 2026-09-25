# Telegram

| Capability | Status |
| --- | --- |
| Strategy (analysis + review fit) | implemented: short update, technical mini-post, channel longread (typical lengths) |
| Live trend research | **unsupported** |
| Author history | manual import (`storyops author import <file> -p telegram`) |
| Dataset import | yes (`storyops research import`) |

Hard constraints used by platform-fit review, from the Telegram Bot API
documentation: text messages up to 4096 characters, media captions up to 1024
characters. Headings and tables do not render.
