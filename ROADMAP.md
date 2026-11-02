# Roadmap

Planned features, in build order. Each batch ships with tests and doc updates.

## Batch 1: Rendering and message actions

- [ ] **Markdown rendering + copy-code button**: render lists, tables, headings, quotes and code blocks. Bundle a small Markdown library locally (no CDN) and keep escaping model HTML.
- [x] **Message actions**: Copy, Regenerate, Edit on each message.

## Batch 2: Side panel features

- [x] **Ask about this page / Summarize tab**: read the open tab's text and add it as context. Needs the `scripting` permission. Trim long pages to fit the context window and show how much of the page is sent.
- [x] **Right-click "Ask LocalMind" on selected text**: Explain, Translate, Fix, Summarize. Needs the `contextMenus` permission.
- [x] **SECURITY.md**: note the new permissions; page text only goes to the user's own server.

## Batch 3: Tuning

- [x] **Speed stats**: show tokens/sec and time to first token under each reply (from Ollama's response timings).
- [x] **Temperature slider** in Settings.

## Later

- [ ] **OpenAI-compatible backends** (LM Studio, vLLM, Jan, LocalAI): second client plus a backend picker in Settings; model manager stays Ollama-only.
- [ ] **Prompt presets / slash commands** (`/summarize`, `/fix`, `/explain`); `/summarize` should use the current page once Batch 2 exists.

## Deferred

- [ ] Semantic search across chats (needs an embedding model and index; current text search covers most needs)
- [ ] LaTeX math via KaTeX (heavy; add only if needed)
- [ ] Syntax highlighting in code blocks
- [ ] Memory per website

## Done

- [x] Search across past chats (history drawer searches titles and messages)
