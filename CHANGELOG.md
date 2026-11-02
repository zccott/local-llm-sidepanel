# Changelog

All notable changes to LocalMind are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- **📄 Page** button: attach the active tab's text to the next message (cut to ~16,000 characters, with a bar showing how much is sent). Sending with an empty box summarizes the page.
- Right-click **Ask LocalMind** on selected text: Explain, Translate to English, Fix grammar, Summarize.
- New permissions: `scripting` (read the tab's text when asked) and `contextMenus` (right-click menu).
- Message actions: **Copy** any message, **Regenerate** a reply (also retries a failed one), **Edit** your message and get a new reply.
- Speed stats under each reply: tokens per second and time to first token.
- **Temperature** slider in Settings (default 0.8), sent with every request.

## [1.0.0] - 2026-11-02

First public release.

### Added

- Chrome side panel chat with Ollama, with streamed replies and a Stop button that keeps the partial reply.
- Conversation memory: recent history is sent with each message (Max History, default 20), and failed messages are left out.
- About You: profile text sent with every chat, with a copyable prompt for importing what other assistants know about you.
- Session memory facts mined from phrases like "my name is…" and "I prefer…", editable in the Context Inspector.
- Chat history with search across titles and message text, showing dates, message counts and matching snippets.
- Model manager in Settings: list, download (with progress) and remove server models.
- Light, dark and match-system themes (light by default), using the toolstack palette.
- Context Inspector showing the exact payload and a token estimate, with JSON and Markdown export.
- Origin-header rule so Ollama accepts requests without setting `OLLAMA_ORIGINS` on the server.
- Clear error cards with next steps, for example after a 403 from the server.
- Toolbar icons.
- `build.sh` packaging into `dist/localmind` and `dist/localmind.zip`.
- Playwright end-to-end test with a mock Ollama server, and CI.
- User guide, architecture docs with diagrams, contributing and security policies.

[Unreleased]: https://github.com/zccott/local-llm-sidepanel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zccott/local-llm-sidepanel/releases/tag/v1.0.0
