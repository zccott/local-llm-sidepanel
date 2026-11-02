/**
 * LocalMind - Side Panel Extension Engine
 * Communicates with local Ollama / LM Studio, mines facts into session memory, streams tokens, exports full context.
 */

// Storage Keys
const STORAGE_KEYS = {
  SESSIONS: "localmind_sessions",
  CURRENT_SESSION_ID: "localmind_current_session_id",
  SETTINGS: "localmind_settings"
};

// Default Settings
const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost:11434",
  systemPrompt: "You are a concise, helpful local AI assistant. Keep responses clear and structured.",
  temperature: 0.8,
  profile: "",
  theme: "light",
  contextMiner: true,
  maxHistory: 20
};

// ~4k tokens: half of the 8192 num_ctx, leaving room for history and the reply
const PAGE_CHAR_LIMIT = 16000;

// Right-click menu actions from background.js
const ASK_PROMPTS = {
  explain: "Explain this:",
  translate: "Translate this to English:",
  fix: "Fix the grammar and spelling. Reply with only the corrected text:",
  summarize: "Summarize this:"
};

// Global Extension State
let state = {
  page: null, // tab text attached to the next message: { title, url, text, total }
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  currentSessionId: null,
  availableModels: [],
  selectedModel: "",
  isStreaming: false,
  abortController: null
};

// DOM Elements
const el = {
  statusBadge: document.getElementById("statusBadge"),
  modelSelect: document.getElementById("modelSelect"),
  refreshModelsBtn: document.getElementById("refreshModelsBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  sidebar: document.getElementById("sidebar"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  sessionList: document.getElementById("sessionList"),
  sessionSearch: document.getElementById("sessionSearch"),
  clearAllHistoryBtn: document.getElementById("clearAllHistoryBtn"),
  messagesArea: document.getElementById("messagesArea"),
  welcomeCard: document.getElementById("welcomeCard"),
  minedFactsBar: document.getElementById("minedFactsBar"),
  factsPreview: document.getElementById("factsPreview"),
  editMemoryBtn: document.getElementById("editMemoryBtn"),
  chatForm: document.getElementById("chatForm"),
  promptInput: document.getElementById("promptInput"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  tokenCounter: document.getElementById("tokenCounter"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  settingBaseUrl: document.getElementById("settingBaseUrl"),
  settingSystemPrompt: document.getElementById("settingSystemPrompt"),
  settingTemperature: document.getElementById("settingTemperature"),
  temperatureValue: document.getElementById("temperatureValue"),
  settingProfile: document.getElementById("settingProfile"),
  settingTheme: document.getElementById("settingTheme"),
  modelList: document.getElementById("modelList"),
  pullModelInput: document.getElementById("pullModelInput"),
  pullModelBtn: document.getElementById("pullModelBtn"),
  pullStatus: document.getElementById("pullStatus"),
  settingContextMiner: document.getElementById("settingContextMiner"),
  settingMaxHistory: document.getElementById("settingMaxHistory"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  exportContextBtn: document.getElementById("exportContextBtn"),
  contextModal: document.getElementById("contextModal"),
  statMessageCount: document.getElementById("statMessageCount"),
  statEstTokens: document.getElementById("statEstTokens"),
  statModel: document.getElementById("statModel"),
  modalMemoryEditor: document.getElementById("modalMemoryEditor"),
  rawContextDisplay: document.getElementById("rawContextDisplay"),
  downloadJsonBtn: document.getElementById("downloadJsonBtn"),
  downloadMdBtn: document.getElementById("downloadMdBtn"),
  copyContextBtn: document.getElementById("copyContextBtn"),
  pageBtn: document.getElementById("pageBtn"),
  pageChip: document.getElementById("pageChip"),
  pageChipText: document.getElementById("pageChipText"),
  removePageBtn: document.getElementById("removePageBtn")
};

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadSessions();
  setupEventListeners();
  await refreshModels();
  renderCurrentSession();
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.pendingAsk?.newValue) takePendingAsk();
  });
  takePendingAsk(); // a right-click that opened this panel
});

// Send text the user right-clicked in a page (queued by background.js) if it was meant for this window
async function takePendingAsk() {
  const { pendingAsk } = await chrome.storage.session.get("pendingAsk");
  if (!pendingAsk || pendingAsk.windowId !== (await chrome.windows.getCurrent()).id) return;
  await chrome.storage.session.remove("pendingAsk");
  el.promptInput.value = `${ASK_PROMPTS[pendingAsk.action] || ""}\n\n${pendingAsk.text}`.trim();
  handleSendMessage(); // no-op while a reply is streaming; the text stays in the box
}

// Read the active tab's visible text and attach it to the next message
async function attachPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.body?.innerText || "" });
    const text = result.replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("The page has no text.");
    state.page = { title: tab.title || tab.url, url: tab.url, text: text.slice(0, PAGE_CHAR_LIMIT), total: text.length };
  } catch (err) {
    alert(`Couldn't read this tab. Chrome pages, the Web Store and PDFs can't be read.\n\n${err.message}`);
  }
  renderPageChip();
}

function renderPageChip() {
  const p = state.page;
  el.pageChip.classList.toggle("hidden", !p);
  if (p) {
    const size = p.text.length < p.total
      ? `first ${Math.round(p.text.length / p.total * 100)}% (${p.text.length.toLocaleString()} of ${p.total.toLocaleString()} chars)`
      : `${p.total.toLocaleString()} chars`;
    el.pageChipText.textContent = `📄 ${p.title} · ${size}`;
    el.pageChipText.title = p.url;
  }
  updateContextStats();
}

// What the model sees for a user message that has a page attached
function withPage(m) {
  if (!m.page) return m.content;
  return `[Web page: ${m.page.title} (${m.page.url})]\n${m.page.text}\n[End of web page]\n\n${m.content}`;
}

// Load Settings
async function loadSettings() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
    state.settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  } else {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  }
  applyTheme();
  syncSettingsUI();
}

async function saveSettings() {
  state.settings.baseUrl = el.settingBaseUrl.value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  state.settings.systemPrompt = el.settingSystemPrompt.value.trim();
  state.settings.temperature = parseFloat(el.settingTemperature.value) || 0.8;
  state.settings.profile = el.settingProfile.value.trim();
  state.settings.theme = el.settingTheme.value;
  applyTheme();
  state.settings.contextMiner = el.settingContextMiner.checked;
  state.settings.maxHistory = parseInt(el.settingMaxHistory.value) || 20;

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state.settings });
  } else {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
  }
  el.settingsModal.classList.add("hidden");
  updateContextStats();
  await refreshModels();
}

function syncSettingsUI() {
  el.settingBaseUrl.value = state.settings.baseUrl;
  el.settingSystemPrompt.value = state.settings.systemPrompt;
  el.settingTemperature.value = state.settings.temperature;
  el.temperatureValue.textContent = state.settings.temperature;
  el.settingProfile.value = state.settings.profile;
  el.settingTheme.value = state.settings.theme;
  el.settingContextMiner.checked = state.settings.contextMiner;
  el.settingMaxHistory.value = state.settings.maxHistory;
}

// Session Persistence
async function loadSessions() {
  let stored = null;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get([STORAGE_KEYS.SESSIONS, STORAGE_KEYS.CURRENT_SESSION_ID]);
    stored = res[STORAGE_KEYS.SESSIONS];
    state.currentSessionId = res[STORAGE_KEYS.CURRENT_SESSION_ID];
  } else {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || "null");
    state.currentSessionId = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION_ID);
  }

  if (Array.isArray(stored) && stored.length > 0) {
    state.sessions = stored;
    if (!state.sessions.find(s => s.id === state.currentSessionId)) {
      state.currentSessionId = state.sessions[0].id;
    }
  } else {
    createNewSession(false);
  }
}

async function persistSessions() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SESSIONS]: state.sessions,
      [STORAGE_KEYS.CURRENT_SESSION_ID]: state.currentSessionId
    });
  } else {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION_ID, state.currentSessionId);
  }
  renderSessionList();
  updateContextStats();
}

function createNewSession(save = true) {
  const newSession = {
    id: "session_" + Date.now(),
    title: "New Conversation",
    createdAt: new Date().toISOString(),
    messages: [],
    minedFacts: []
  };
  state.sessions.unshift(newSession);
  state.currentSessionId = newSession.id;
  if (save) persistSessions();
  renderCurrentSession();
}

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || state.sessions[0];
}

// Ollama streams one JSON object per line; calls onObject for each and throws on {"error": ...}
async function readNdjson(response, onObject) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Lines can be split across network chunks; keep the incomplete tail for the next read
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.error) throw new Error(parsed.error);
      onObject(parsed);
    }
  }
}

// Model manager (Settings): lists server models with remove buttons, and downloads new ones
function renderModelList() {
  el.modelList.innerHTML = "";
  if (state.availableModels.length === 0) {
    el.modelList.innerHTML = `<li class="model-empty">No models on the server yet.</li>`;
    return;
  }
  state.availableModels.forEach(name => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button type="button" class="session-delete" title="Remove from server" aria-label="Remove ${escapeHtml(name)}">&times;</button>
    `;
    li.querySelector("button").addEventListener("click", () => deleteModel(name));
    el.modelList.appendChild(li);
  });
}

async function deleteModel(name) {
  if (!confirm(`Remove "${name}" from the server?\n\nThis deletes it from the Ollama machine for everyone who uses it. You can download it again later.`)) return;
  try {
    const res = await fetch(`${state.settings.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    el.pullStatus.textContent = `Removed ${name}.`;
  } catch (err) {
    el.pullStatus.textContent = `Couldn't remove ${name}: ${err.message}`;
  }
  await refreshModels();
}

async function pullModel() {
  const name = el.pullModelInput.value.trim();
  if (!name) return;
  el.pullModelBtn.disabled = true;
  el.pullStatus.textContent = `Starting download of ${name}…`;
  try {
    const res = await fetch(`${state.settings.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, stream: true })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    await readNdjson(res, (p) => {
      const pct = p.total ? ` ${Math.floor((p.completed || 0) / p.total * 100)}%` : "";
      el.pullStatus.textContent = `${name}: ${p.status}${pct}`;
    });
    el.pullStatus.textContent = `Downloaded ${name}. It's now in the model list.`;
    el.pullModelInput.value = "";
  } catch (err) {
    el.pullStatus.textContent = `Couldn't download ${name}: ${err.message}`;
  } finally {
    await refreshModels();
    el.pullModelBtn.disabled = false;
  }
}

// Theme: "system" follows the OS live; "light"/"dark" override it
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme = t === "light" || t === "dark" ? t : (darkQuery.matches ? "dark" : "light");
}
darkQuery.addEventListener("change", applyTheme);
applyTheme(); // before settings load, so dark-mode users don't see a light flash

// Fetch local Ollama Models
async function refreshModels() {
  el.statusBadge.textContent = "Connecting...";
  el.statusBadge.className = "status-badge";
  el.modelSelect.innerHTML = `<option value="">Checking models...</option>`;

  try {
    const baseUrl = state.settings.baseUrl;
    const res = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.availableModels = (data.models || []).map(m => m.name);

    if (state.availableModels.length === 0) {
      el.modelSelect.innerHTML = `<option value="">No models on server</option>`;
      el.statusBadge.textContent = "No Models";
      el.statusBadge.className = "status-badge offline";
      return;
    }

    el.modelSelect.innerHTML = "";
    state.availableModels.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      el.modelSelect.appendChild(opt);
    });

    if (!state.selectedModel || !state.availableModels.includes(state.selectedModel)) {
      state.selectedModel = state.availableModels[0];
    }
    el.modelSelect.value = state.selectedModel;
    el.statusBadge.textContent = "Connected";
    el.statusBadge.className = "status-badge online";
  } catch (err) {
    console.warn("Failed to reach Ollama:", err);
    el.statusBadge.textContent = "Offline";
    el.statusBadge.className = "status-badge offline";
    el.modelSelect.innerHTML = `<option value="">Server offline (${err.message})</option>`;
    state.availableModels = [];
  } finally {
    renderModelList();
  }
}

// Context Miner Engine: Discovers facts and user intentions across previous turns
function mineSessionContext(session) {
  if (!state.settings.contextMiner || !session.messages.length) return;

  const facts = session.minedFacts || [];
  const recentUserMsgs = session.messages.filter(m => m.role === "user");
  const lastUserMsg = recentUserMsgs[recentUserMsgs.length - 1]?.content || "";

  const patterns = [
    /(?:my name is|call me)\s+([a-zA-Z0-9_\-\s]+)/i,
    /(?:i prefer|prefer using|always use)\s+([^\.\n]+)/i,
    /(?:working on|building|creating|developing)\s+([^\.\n]+)/i,
    /(?:in python|in javascript|in go|in rust|in typescript|using\s+[a-zA-Z0-9_\-]+)/i
  ];

  patterns.forEach(p => {
    const match = lastUserMsg.match(p);
    if (match) {
      const fact = match[0].trim();
      if (!facts.includes(fact) && fact.length < 120) {
        facts.push(fact);
      }
    }
  });

  session.minedFacts = facts.slice(-10);
  updateMinedFactsBar();
}

function updateMinedFactsBar() {
  const session = getCurrentSession();
  if (session && session.minedFacts && session.minedFacts.length > 0) {
    el.minedFactsBar.classList.remove("hidden");
    el.factsPreview.textContent = session.minedFacts.join(" • ");
  } else {
    el.minedFactsBar.classList.add("hidden");
  }
}

// Build Payload for local LLM
function buildChatPayload(session) {
  const messagesToSend = [];

  let fullSystemPrompt = state.settings.systemPrompt || "";
  if (state.settings.profile) {
    fullSystemPrompt += `\n\n[About the user — applies to every conversation]:\n${state.settings.profile}`;
  }
  if (session.minedFacts && session.minedFacts.length > 0) {
    fullSystemPrompt += `\n[Known context & preferences from previous exchanges]:\n- ` + session.minedFacts.join("\n- ");
  }

  if (fullSystemPrompt.trim()) {
    messagesToSend.push({ role: "system", content: fullSystemPrompt.trim() });
  }

  const maxHistory = state.settings.maxHistory || 20;
  const recentHistory = session.messages.slice(-maxHistory);
  for (const m of recentHistory) {
    // Skip the in-flight assistant placeholder and failed replies
    if (!m.content || m.error) continue;
    messagesToSend.push({ role: m.role, content: withPage(m) });
  }

  return messagesToSend;
}

function titleFromPrompt(text) {
  return text.slice(0, 30) + (text.length > 30 ? "..." : "");
}

// Chat Send & Live Streaming
async function handleSendMessage(e) {
  if (e) e.preventDefault();
  const prompt = el.promptInput.value.trim() || (state.page ? "Summarize this page." : "");
  if (!prompt || state.isStreaming) return;

  const session = getCurrentSession();
  const userMessage = { role: "user", content: prompt, timestamp: new Date().toISOString() };
  if (state.page) {
    userMessage.page = state.page; // stays in history, so follow-up questions still see it
    state.page = null;
    renderPageChip();
  }
  session.messages.push(userMessage);

  if (session.messages.length === 1) {
    session.title = titleFromPrompt(prompt);
  }

  mineSessionContext(session);

  el.promptInput.value = "";
  el.promptInput.style.height = "auto";
  renderMessages();

  await generateReply(session);
}

// Streams a new assistant reply from the session's current history. Shared by a normal send and
// by Regenerate/Edit, which first truncate the history to the point they want to redo from.
async function generateReply(session) {
  const model = el.modelSelect.value || state.selectedModel;
  if (!model) {
    alert("Please ensure your local LLM server is reachable and a model is chosen.");
    return;
  }

  // The message this reply answers; marked .error on failure so it's excluded from future context
  const precedingMessage = session.messages[session.messages.length - 1];
  const assistantMsgObj = { role: "assistant", content: "", model, timestamp: new Date().toISOString() };
  session.messages.push(assistantMsgObj);

  const assistantBubble = appendStreamingBubble();
  setStreamingState(true);

  state.abortController = new AbortController();
  const payload = {
    model: model,
    messages: buildChatPayload(session),
    stream: true,
    // Ollama defaults to a small context window and silently truncates long chats
    options: { num_ctx: 8192, temperature: state.settings.temperature }
  };
  let accumulatedText = "";
  let serverTps = 0;
  const startedAt = performance.now();
  let firstTokenAt = 0;

  try {
    const baseUrl = state.settings.baseUrl;
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: state.abortController.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      const hint = response.status === 403
        ? " The server refused the request. Reload the extension in chrome://extensions; if it continues, set OLLAMA_ORIGINS=\"chrome-extension://*\" on the server."
        : "";
      throw new Error(`HTTP ${response.status}${errText ? `: ${errText}` : "."}${hint}`);
    }

    await readNdjson(response, (parsed) => {
      const piece = parsed.message?.content || "";
      if (piece) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        accumulatedText += piece;
        assistantBubble.innerHTML = formatMarkdown(accumulatedText) + `<span class="cursor-blink"></span>`;
        el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
      }
      // Ollama reports its own generation speed on the final streamed object
      if (parsed.done && parsed.eval_count && parsed.eval_duration) {
        serverTps = parsed.eval_count / (parsed.eval_duration / 1e9);
      }
    });

    assistantMsgObj.content = accumulatedText;
  } catch (err) {
    if (err.name === "AbortError") {
      assistantMsgObj.content = accumulatedText;
      if (!accumulatedText) session.messages.pop(); // stopped before any text: drop the empty bubble
    } else {
      assistantMsgObj.content = err.message;
      assistantMsgObj.error = true;
      if (precedingMessage?.role === "user") precedingMessage.error = true; // don't resend a prompt that never got an answer
    }
  } finally {
    // Speed stats: Ollama's reported tok/s when available, else a rough estimate from elapsed time
    if (!assistantMsgObj.error && accumulatedText && firstTokenAt) {
      const seconds = (performance.now() - firstTokenAt) / 1000;
      const estTokens = Math.max(1, Math.round(accumulatedText.length / 4));
      const tps = serverTps || (seconds > 0 ? estTokens / seconds : 0);
      assistantMsgObj.stats = { tps: Math.round(tps * 10) / 10, ttftMs: Math.round(firstTokenAt - startedAt) };
    }
    setStreamingState(false);
    // Re-render so the finished reply gets its model/time label, stats and any error styling
    renderMessages();
    await persistSessions();
  }
}

// Message actions: Copy (any message), Regenerate (assistant), Edit (user)
function copyMessage(index, btn) {
  const session = getCurrentSession();
  const msg = session.messages[index];
  navigator.clipboard.writeText(msg.content).then(() => {
    const original = btn.textContent;
    btn.textContent = "✅";
    setTimeout(() => { btn.textContent = original; }, 1200);
  });
}

async function regenerateMessage(index) {
  if (state.isStreaming) return;
  const session = getCurrentSession();
  session.messages.splice(index); // drop this reply and anything after it
  const prev = session.messages[session.messages.length - 1];
  if (prev) delete prev.error; // retrying a failed reply: let its prompt back into context
  renderMessages();
  await generateReply(session);
}

async function editMessage(index) {
  if (state.isStreaming) return;
  const session = getCurrentSession();
  const msg = session.messages[index];
  const next = prompt("Edit your message:", msg.content);
  if (next === null) return; // cancelled
  const trimmed = next.trim();
  if (!trimmed) return;
  msg.content = trimmed;
  delete msg.error;
  session.messages.splice(index + 1); // drop the old reply and anything after
  if (index === 0) session.title = titleFromPrompt(trimmed);
  renderMessages();
  await generateReply(session);
}

function setStreamingState(streaming) {
  state.isStreaming = streaming;
  if (streaming) {
    el.sendBtn.classList.add("hidden");
    el.stopBtn.classList.remove("hidden");
  } else {
    el.sendBtn.classList.remove("hidden");
    el.stopBtn.classList.add("hidden");
  }
}

function stopStreaming() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
}

// Markdown Formatter
function formatMarkdown(text) {
  if (!text) return "";
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  escaped = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="lang-${lang}">${code}</code></pre>`;
  });
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/\n/g, "<br>");
  return escaped;
}

// Render UI
function renderCurrentSession() {
  const session = getCurrentSession();
  if (!session) return;

  renderMessages();
  renderSessionList();
  updateMinedFactsBar();
  updateContextStats();
}

function renderMessages() {
  const session = getCurrentSession();
  el.messagesArea.innerHTML = "";

  if (!session || session.messages.length === 0) {
    el.messagesArea.appendChild(el.welcomeCard);
    return;
  }

  session.messages.forEach((msg, index) => {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${msg.role}${msg.error ? " error" : ""}`;
    msgDiv.dataset.index = index;
    const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let body, label;
    if (msg.role === "user") {
      body = (msg.page ? `<div class="message-page" title="${escapeHtml(msg.page.url)}">📄 ${escapeHtml(msg.page.title)}</div>` : "") + escapeHtml(msg.content);
      label = msg.error ? "Not sent" : "";
    } else if (msg.error) {
      body = `<strong>Couldn't get a reply.</strong> ${escapeHtml(msg.content)}`;
      label = msg.model || "";
    } else {
      body = formatMarkdown(msg.content);
      label = msg.model || "";
    }
    const stats = msg.stats ? `<span class="meta-stats">${msg.stats.tps} tok/s · ${msg.stats.ttftMs}ms to first token</span>` : "";
    const actions = [`<button type="button" class="msg-action" data-action="copy" title="Copy">📋</button>`];
    if (msg.role === "assistant") actions.push(`<button type="button" class="msg-action" data-action="regenerate" title="Regenerate">🔁</button>`);
    if (msg.role === "user") actions.push(`<button type="button" class="msg-action" data-action="edit" title="Edit">✏️</button>`);
    msgDiv.innerHTML = `
      <div class="message-bubble">${body}</div>
      <div class="message-meta">
        ${label ? `<span>${escapeHtml(label)}</span>` : ""}
        ${stats}
        <span class="meta-actions">${actions.join("")}</span>
        <span>${time}</span>
      </div>
    `;
    el.messagesArea.appendChild(msgDiv);
  });

  el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
}

function appendStreamingBubble() {
  const msgDiv = document.createElement("div");
  msgDiv.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = `<span class="cursor-blink"></span>`;
  msgDiv.appendChild(bubble);
  el.messagesArea.appendChild(msgDiv);
  el.messagesArea.scrollTop = el.messagesArea.scrollHeight;
  return bubble;
}

// Returns "…text around the first match…" from the chat's messages, or "" if only the title matches
function searchSnippet(session, q) {
  const msg = session.messages.find(m => !m.error && m.content && m.content.toLowerCase().includes(q));
  if (!msg) return "";
  const i = msg.content.toLowerCase().indexOf(q);
  const start = Math.max(0, i - 25);
  return (start > 0 ? "…" : "") + msg.content.slice(start, i + q.length + 35).replace(/\s+/g, " ") + "…";
}

function renderSessionList() {
  el.sessionList.innerHTML = "";
  const q = el.sessionSearch.value.trim().toLowerCase();
  const shown = q
    ? state.sessions.filter(s => s.title.toLowerCase().includes(q) || searchSnippet(s, q))
    : state.sessions;
  if (shown.length === 0) {
    el.sessionList.innerHTML = `<div class="session-empty">No chats match "${escapeHtml(el.sessionSearch.value.trim())}".</div>`;
    return;
  }
  shown.forEach(s => {
    const item = document.createElement("div");
    item.className = `session-item ${s.id === state.currentSessionId ? 'active' : ''}`;
    // Date + message count tell apart chats that share a title (e.g. several "hy")
    const when = new Date(s.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const count = s.messages.filter(m => !m.error).length;
    const snippet = q && !s.title.toLowerCase().includes(q) ? searchSnippet(s, q) : "";
    item.innerHTML = `
      <button type="button" class="session-open" title="${escapeHtml(s.title)}">
        <span class="session-title">${escapeHtml(s.title)}</span>
        ${snippet ? `<span class="session-snippet">${escapeHtml(snippet)}</span>` : ""}
        <span class="session-meta">${when} · ${count} msg${count === 1 ? "" : "s"}</span>
      </button>
      <button type="button" class="session-delete" title="Delete chat" aria-label="Delete chat">&times;</button>
    `;

    item.querySelector(".session-open").addEventListener("click", () => {
      state.currentSessionId = s.id;
      persistSessions();
      renderCurrentSession();
      el.sidebar.classList.add("hidden");
    });

    item.querySelector(".session-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    el.sessionList.appendChild(item);
  });
}

function deleteSession(id) {
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.sessions.length === 0) {
    createNewSession(false);
  } else if (state.currentSessionId === id) {
    state.currentSessionId = state.sessions[0].id;
  }
  persistSessions();
  renderCurrentSession();
}

function updateContextStats() {
  const session = getCurrentSession();
  if (!session) return;
  // Count what the model will actually receive, not every bubble on screen
  const sent = buildChatPayload(session);
  const count = sent.filter(m => m.role !== "system").length;
  const charCount = sent.reduce((acc, m) => acc + m.content.length, 0) + (state.page ? state.page.text.length : 0);
  const approxTokens = Math.round(charCount / 4);
  el.tokenCounter.textContent = `~${approxTokens} tokens · ${count} msg${count === 1 ? "" : "s"} in context`;
  el.tokenCounter.title = "Messages and estimated tokens sent to the model with your next message (includes system prompt and memory facts)";
}

// Full Context Inspector & Exporter
function openContextModal() {
  const session = getCurrentSession();
  if (!session) return;

  const charCount = session.messages.reduce((acc, m) => acc + (m.content ? m.content.length : 0), 0);
  const approxTokens = Math.round(charCount / 4);

  el.statMessageCount.textContent = `${session.messages.length} Messages`;
  el.statEstTokens.textContent = `~${approxTokens} Tokens`;
  el.statModel.textContent = `Model: ${el.modelSelect.value || state.selectedModel || 'None'}`;

  el.modalMemoryEditor.value = (session.minedFacts || []).join("\n");

  const fullPayload = buildChatPayload(session);
  el.rawContextDisplay.textContent = JSON.stringify(fullPayload, null, 2);

  el.contextModal.classList.remove("hidden");
}

function downloadSession(format) {
  const session = getCurrentSession();
  if (!session) return;

  let content = "";
  let mimeType = "text/plain";
  let filename = `chat_${session.id}`;

  if (format === "json") {
    content = JSON.stringify(session, null, 2);
    mimeType = "application/json";
    filename += ".json";
  } else if (format === "md") {
    content = `# ${session.title}\n\n*Date: ${session.createdAt}*\n\n`;
    if (session.minedFacts && session.minedFacts.length > 0) {
      content += `### 🧠 Mined Session Facts\n${session.minedFacts.map(f => `- ${f}`).join("\n")}\n\n`;
    }
    content += `---\n\n`;
    session.messages.forEach(m => {
      content += `### ${m.role === 'user' ? 'User' : 'Assistant'}\n${m.content}\n\n`;
    });
    filename += ".md";
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Event Listeners
function setupEventListeners() {
  el.modelSelect.addEventListener("change", (e) => {
    state.selectedModel = e.target.value;
  });
  el.refreshModelsBtn.addEventListener("click", refreshModels);

  el.newChatBtn.addEventListener("click", () => createNewSession(true));

  el.toggleSidebarBtn.addEventListener("click", () => el.sidebar.classList.toggle("hidden"));
  el.sessionSearch.addEventListener("input", renderSessionList);
  el.closeSidebarBtn.addEventListener("click", () => el.sidebar.classList.add("hidden"));
  // Clicking the chat behind the open drawer closes it; clicking a message action runs it
  el.messagesArea.addEventListener("click", (e) => {
    el.sidebar.classList.add("hidden");
    const btn = e.target.closest(".msg-action");
    if (!btn) return;
    const index = Number(btn.closest(".message").dataset.index);
    if (btn.dataset.action === "copy") copyMessage(index, btn);
    else if (btn.dataset.action === "regenerate") regenerateMessage(index);
    else if (btn.dataset.action === "edit") editMessage(index);
  });
  el.clearAllHistoryBtn.addEventListener("click", () => {
    if (confirm("Delete all chat sessions?")) {
      state.sessions = [];
      createNewSession(true);
    }
  });

  el.promptInput.addEventListener("input", () => {
    el.promptInput.style.height = "auto";
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 140) + "px";
  });
  el.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  el.chatForm.addEventListener("submit", handleSendMessage);
  el.settingTemperature.addEventListener("input", () => {
    el.temperatureValue.textContent = el.settingTemperature.value;
  });
  el.pageBtn.addEventListener("click", attachPage);
  el.removePageBtn.addEventListener("click", () => {
    state.page = null;
    renderPageChip();
  });
  el.stopBtn.addEventListener("click", stopStreaming);

  el.openSettingsBtn.addEventListener("click", () => {
    syncSettingsUI();
    el.settingsModal.classList.remove("hidden");
  });
  el.saveSettingsBtn.addEventListener("click", saveSettings);
  el.pullModelBtn.addEventListener("click", pullModel);
  el.pullModelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pullModel();
  });

  el.exportContextBtn.addEventListener("click", openContextModal);
  el.editMemoryBtn.addEventListener("click", openContextModal);

  el.modalMemoryEditor.addEventListener("change", () => {
    const session = getCurrentSession();
    if (session) {
      session.minedFacts = el.modalMemoryEditor.value.split("\n").map(f => f.trim()).filter(Boolean);
      persistSessions();
      updateMinedFactsBar();
    }
  });

  el.downloadJsonBtn.addEventListener("click", () => downloadSession("json"));
  el.downloadMdBtn.addEventListener("click", () => downloadSession("md"));
  document.getElementById("copyProfilePromptBtn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    navigator.clipboard.writeText(document.getElementById("profilePromptText").textContent).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "📋 Copy prompt", 1500);
    });
  });
  el.copyContextBtn.addEventListener("click", () => {
    const text = el.rawContextDisplay.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = el.copyContextBtn.textContent;
      el.copyContextBtn.textContent = "Copied!";
      setTimeout(() => el.copyContextBtn.textContent = orig, 1500);
    });
  });

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-close");
      document.getElementById(targetId)?.classList.add("hidden");
    });
  });
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
