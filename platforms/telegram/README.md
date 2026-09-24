# Telegram

| Capability | Status |
| --- | --- |
| Strategy | implemented: short project update, technical mini-post, channel longread |
| Live trend research | **unsupported** |
| Author history | manual import (`editorial-kit author import <file> -p telegram`) |
| Renderer | custom (`renderer.ts`): no headings, message/caption budget notes |

Hard constraints encoded from the Telegram Bot API documentation: text messages
up to 4096 characters, media captions up to 1024 characters. Hashtags and emojis
are optional, never required.
