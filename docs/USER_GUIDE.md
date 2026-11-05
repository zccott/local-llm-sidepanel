# LocalMind User Guide

LocalMind is a Chrome side panel for chatting with an Ollama model running on your computer or another machine on your network. Your chats are saved in your browser only. Nothing is sent to the cloud.

---

## 1. Set up the Ollama machine (one time)

If Ollama runs on another machine, it must accept connections from your network. On that machine, start it like this:

```sh
OLLAMA_HOST=0.0.0.0 ollama serve
```

If Ollama already runs as a background service (the Mac menu bar app, or systemd on Linux), set `OLLAMA_HOST` in that service's settings instead and restart it.

LocalMind removes the browser's Origin header from its own requests, so you don't need `OLLAMA_ORIGINS`. If you still get **HTTP 403**, add `OLLAMA_ORIGINS="chrome-extension://*"` as well.

Make sure the machine has at least one model installed, for example `ollama pull llama3.2`.

**Quick check:** open `http://<server-ip>:11434/api/tags` in your browser (for example `http://192.168.1.50:11434/api/tags`). If you see a list of models, the server is reachable.

---

## 2. Install the extension in Chrome

You install the extension from a **folder**. You don't upload anything to the Chrome Web Store.

1. Get the extension folder:
   - If you have the project folder, use it as it is.
   - If you were sent `localmind.zip`, unzip it first. Chrome can't load the zip directly.
2. Open `chrome://extensions` in Chrome (Brave and Edge work too).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** (top left) and select the folder that contains `manifest.json`.
5. Click the puzzle icon in the toolbar and pin **LocalMind**.

---

## 3. Connect to your model

1. Click the LocalMind icon. The panel opens on the right side of the browser.
2. Click **⚙️ Settings** and set **Ollama / Local LLM Base URL** to your server address, for example `http://192.168.1.50:11434`. The address works with or without `/api` at the end.
3. Click **Save Settings**.
4. The status in the top right should change to **Connected**. Pick a model from the dropdown. If the list is empty, click **↻** to reload it.

---

## 4. Chatting

- Type your message and press **Enter** to send. Use **Shift+Enter** for a new line.
- Click **Stop** to end a reply early. The part already written is kept.
- The model remembers the conversation: every new message is sent along with the earlier messages of the same chat, like ChatGPT.

### Ask about a web page

- Click **📄 Page** to attach the text of the tab you're viewing to your next message. A bar above the input box shows the page title and how much of it will be sent. Pages up to about 16,000 characters are sent whole. Longer pages work at any length: for a question, LocalMind sends only the parts whose words match it, and to summarize, it summarizes each part first and then combines them (this takes one model call per part). Use the page's own wording in questions for the best matches.
- Type a question and send, or send with the box empty to get a summary. Click **✕** on the bar to drop the page.
- The page stays part of that chat, so you can ask follow-up questions about it.
- Chrome's own pages (`chrome://`), the Chrome Web Store and PDFs can't be read.

### Right-click selected text

Select text on any page, right-click and choose **Ask LocalMind**, then **Explain**, **Translate to English**, **Fix grammar** or **Summarize**. The side panel opens and sends the request to your current chat.

### Chat sessions

- **+ New** starts a fresh chat with no history.
- The **Chat History** button opens your saved chats. Click one to go back to it, or click **×** to delete it.
- **Clear All History** deletes every chat.

Chats are saved automatically and are still there after you close the browser.

### About You (bring your ChatGPT memory)

**About You** in Settings is sent with every chat, so the model always knows who you are. To move what ChatGPT knows about you:

1. In **⚙️ Settings → About You**, click **📋 Copy prompt**.
2. Paste the prompt into ChatGPT, Claude, Gemini or any assistant that knows you, and send it.
3. Copy its answer into **About You** and click **Save Settings**.

You can combine answers from several assistants. Remove anything repeated.

Keep it short. It's sent with every message, and local models have limited room.

### Memory facts

When you write things like "my name is…", "I prefer…" or "I'm working on…", LocalMind saves them as facts and reminds the model of them on every message in that chat. They appear in the bar above the input box.

- Click **Edit** on that bar to change or remove facts (one per line).
- To switch this off, untick **Auto-Memory Context Miner** in Settings.

---

### Message actions

Under each message:

- **📋 Copy** copies the message text.
- **🔁 Regenerate** (replies) asks the model again. On a failed reply it works as **Retry**.
- **✏️ Edit** (your messages) changes your message, removes the reply after it, and gets a new one.

Each reply also shows its speed, for example `105 tok/s · 240ms to first token`.

## 5. Settings

| Setting | What it does |
|---|---|
| Base URL | Address of your Ollama server. |
| System Prompt | Standing instructions for the model, such as tone or role. |
| About You | Facts about you that every chat should know. |
| Temperature | How varied replies are: lower is focused and repeatable, higher is more creative (default 0.8). |
| Theme | **Light** (default), **Dark**, or **Match system** (follows your computer's light/dark mode). |
| Models on Server | See, download and remove models (below). |

### Managing models

The model dropdown lists the models installed on your Ollama server. To change them, open **⚙️ Settings → Models on Server**:

- **Download:** type a model name from [ollama.com/library](https://ollama.com/library) (for example `llama3.2` or `qwen2.5:7b`) and click **Download**. Progress shows below. Models can be several GB, and the download runs on the server.
- **Remove:** click **×** next to a model and confirm. This deletes it from the server for everyone who uses it.
| Auto-Memory Context Miner | Turns automatic fact saving on or off. |
| Max History Messages | How many earlier messages are sent with each new one (default 20). Lower it if replies get slow. |

---

## 6. Inspect and export a chat

Click **Inspect & Export Context** in the header to see:

- How many messages and roughly how many tokens the chat uses.
- The exact data sent to the model.

From there you can download the chat as **JSON** or **Markdown**, or copy the context to your clipboard.

---

## 7. Troubleshooting

| Problem | What to do |
|---|---|
| Status shows **Offline** | Check the server is on and the URL is right. Try the quick check from step 1. Both machines must be on the same network. |
| Error **HTTP 403** | Ollama is blocking the extension. Reload the extension first. If it continues, set `OLLAMA_ORIGINS` on the server as in step 1 and restart Ollama. |
| **No models on server** | Install one on the server: `ollama pull llama3.2`. |
| Replies are slow or the server runs out of memory | Lower **Max History Messages**, or use a smaller model. |
| Model forgets the start of a long chat | Start a **+ New** chat, or move important details into the memory facts. |

To see detailed errors, right-click inside the panel, choose **Inspect**, and open the **Console** tab.

---

## 8. Updating the extension

When the extension files change, open `chrome://extensions` and click the **reload** icon on LocalMind. Your chats and settings are kept.
