// End-to-end test: loads the built extension (dist/localmind) into Chromium and clicks through the side panel.
//
//   npm test                                           # against the built-in mock Ollama (no model needed; used in CI)
//   OLLAMA_URL=http://192.168.1.50:11434 npm test      # against a real Ollama server
//   OLLAMA_URL=... E2E_PULL=1 npm test                 # also download + remove all-minilm (~46 MB) on that server
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { startMockOllama } = require("./mock-ollama.cjs");

const EXT = path.resolve(__dirname, "../dist/localmind");
const OUT = path.resolve(__dirname, "../test-results");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  if (!fs.existsSync(path.join(EXT, "manifest.json"))) throw new Error("dist/localmind not found. Run `npm run build` first.");
  fs.mkdirSync(OUT, { recursive: true });

  const mock = process.env.OLLAMA_URL ? null : await startMockOllama();
  const BASE = (process.env.OLLAMA_URL || mock.url).replace(/\/+$/, "");
  const runPull = !!mock || process.env.E2E_PULL === "1";
  console.log(`Server: ${BASE}${mock ? " (mock)" : ""}\n`);

  const userDir = fs.mkdtempSync(path.join(OUT, "profile-"));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    viewport: { width: 360, height: 700 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  check("extension loads, service worker runs", !!id, id);

  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  check("Origin-strip rule registered", rules.length === 1 && rules[0].action.requestHeaders[0].header === "origin");
  await sw.evaluate((baseUrl) => chrome.storage.local.set({ localmind_settings: { baseUrl } }), BASE);

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(e.message));
  const chatRequests = [];
  page.on("request", r => { if (r.url().endsWith("/api/chat")) chatRequests.push(JSON.parse(r.postData())); });
  const chatResponses = [];
  page.on("response", r => { if (r.url().endsWith("/api/chat")) chatResponses.push(r.status()); });
  // The mock answers in under a second, so fail fast there; real models can take minutes
  const limit = (ms) => mock ? Math.min(ms, 10000) : ms;
  const waitForReply = () => page.waitForFunction(() => !document.getElementById("stopBtn").offsetParent, null, { timeout: limit(180000) });

  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.waitForFunction(() => document.getElementById("statusBadge").textContent !== "Connecting...", null, { timeout: 15000 });
  const status = await page.textContent("#statusBadge");
  check("connects to server", status === "Connected", status);
  const models = await page.$$eval("#modelSelect option", os => os.map(o => o.value));
  check("model list populated", models.length > 0, models.join(", "));

  // Layout at side-panel width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow at 360px", overflow <= 0, `overflow ${overflow}px`);
  check("stop button hidden when idle", !(await page.isVisible("#stopBtn")));
  check("send button visible when idle", await page.isVisible("#sendBtn"));
  check("default theme is light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  const iconSizes = await page.evaluate(async () => {
    const m = chrome.runtime.getManifest();
    const sizes = await Promise.all(Object.values(m.icons).map(p => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = chrome.runtime.getURL(p); })));
    return sizes.join(",");
  });
  check("extension icons load at 16/48/128", iconSizes === "16,48,128", iconSizes);

  // History drawer
  const sidebarX = () => page.$eval("#sidebar", e => e.getBoundingClientRect().left);
  await page.click("#toggleSidebarBtn");
  await page.waitForTimeout(400);
  check("history drawer opens", (await sidebarX()) >= 0, `left=${await sidebarX()}`);
  await page.click("#closeSidebarBtn");
  await page.waitForTimeout(400);
  check("history drawer closes", (await sidebarX()) < 0);

  // Settings: copy-prompt button, URL normalisation, About You
  await page.click("#openSettingsBtn");
  check("settings opens", await page.isVisible("#settingsModal"));
  // Headless can't read the real clipboard on extension pages, so record what the button writes
  await page.evaluate(() => { navigator.clipboard.writeText = async t => { window.__clip = t; }; });
  await page.click("#copyProfilePromptBtn");
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => window.__clip || "");
  check("Copy prompt copies the AI prompt", clip.startsWith("Summarise everything you know about me") && (await page.textContent("#copyProfilePromptBtn")) === "Copied!", clip.slice(0, 60));
  await page.fill("#settingBaseUrl", `${BASE}/api/`);
  // Worded without "favourite" so the search test below only matches the chat whose title has it
  await page.fill("#settingProfile", "- My preferred colour is teal.\n- I work as a frontend developer.");
  await page.click("#saveSettingsBtn");
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => chrome.storage.local.get("localmind_settings"));
  check("settings save strips /api", stored.localmind_settings.baseUrl === BASE, stored.localmind_settings.baseUrl);
  check("settings closes on save", !(await page.isVisible("#settingsModal")));
  await page.waitForFunction(() => document.getElementById("statusBadge").textContent === "Connected", null, { timeout: 15000 }).catch(() => {});

  // Chat round 1
  const model = await page.$eval("#modelSelect", s => s.value);
  await page.fill("#promptInput", "My name is Rahul. Reply with exactly one word: PONG");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(300);
  check("stop button shows while streaming", await page.isVisible("#stopBtn"));
  await waitForReply();
  check("chat request accepted (no 403)", chatResponses[0] === 200, `status ${chatResponses[0]}`);
  const reply1 = await page.$eval(".message.assistant:last-child .message-bubble", e => e.textContent.trim());
  const isErr1 = await page.$eval(".message.assistant:last-child", e => e.classList.contains("error"));
  check("got a non-empty reply", reply1.length > 0 && !isErr1, JSON.stringify(reply1.slice(0, 80)));
  const label1 = await page.$eval(".message.assistant:last-child .message-meta", e => e.textContent);
  check("reply labelled with model that answered", label1.includes(model), label1.trim().replace(/\s+/g, " "));
  const p1 = chatRequests[0].messages;
  check("first request: system + 1 user, prompt not duplicated", p1.length === 2 && p1[1].role === "user", p1.map(m => m.role).join(","));
  check("memory fact mined", (await page.isVisible("#minedFactsBar")) && (await page.textContent("#factsPreview")).includes("Rahul"), await page.textContent("#factsPreview"));
  check("counter counts sent msgs", (await page.textContent("#tokenCounter")).includes("2 msgs"), await page.textContent("#tokenCounter"));
  check("reply shows speed stats", /\d+(\.\d+)? tok\/s · \d+ms to first token/.test(label1), label1.trim().replace(/\s+/g, " "));

  // Chat round 2: history is sent once, in order
  await page.fill("#promptInput", "What is my name? One word.");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(300);
  await waitForReply();
  const p2 = chatRequests[1].messages;
  check("second request carries history once", p2.map(m => m.role).join(",") === "system,user,assistant,user", p2.map(m => m.role).join(","));
  check("system prompt includes memory fact", p2[0].content.includes("Rahul"));
  const reply2 = await page.$eval(".message.assistant:last-child .message-bubble", e => e.textContent.trim());
  check("model remembers context", /rahul/i.test(reply2), JSON.stringify(reply2.slice(0, 80)));

  // Stop mid-stream
  await page.fill("#promptInput", "Write a 400 word story about a lighthouse.");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(2500);
  await page.click("#stopBtn");
  await page.waitForTimeout(500);
  check("stop ends streaming", !(await page.isVisible("#stopBtn")) && (await page.isVisible("#sendBtn")));
  const emptyBubbles = await page.$$eval(".message.assistant .message-bubble", bs => bs.filter(b => !b.textContent.trim()).length);
  check("no empty reply bubbles after stop", emptyBubbles === 0, `${emptyBubbles} empty`);

  // Ask about this page: attach the active tab's text, trimmed to fit
  await ctx.route("http://article.test/**", r => r.fulfill({ contentType: "text/html", body: `<title>Pharos facts</title><p>The Pharos of Alexandria was 100 metres tall.</p><p>${"filler ".repeat(4000)}</p>` }));
  const article = await ctx.newPage();
  await article.goto("http://article.test/");
  await article.bringToFront();
  await page.click("#pageBtn");
  await page.waitForSelector("#pageChip:not(.hidden)", { timeout: 5000 }).catch(() => {});
  const chip = await page.textContent("#pageChipText");
  check("Page button attaches the active tab", chip.includes("Pharos facts"), chip);
  check("long page is trimmed and says how much is sent", /first \d+%/.test(chip), chip);
  await page.press("#promptInput", "Enter"); // empty prompt + page = summarize
  await page.waitForTimeout(300);
  await waitForReply();
  const pPage = chatRequests[chatRequests.length - 1].messages.at(-1).content;
  check("page text reaches the model with a summarize prompt", pPage.includes("Pharos of Alexandria") && pPage.endsWith("Summarize this page.") && pPage.length < 17000, `${pPage.length} chars`);
  check("sent message shows the page title", (await page.textContent(".message.user:nth-last-child(2) .message-page")).includes("Pharos facts"));
  check("page detaches after sending", !(await page.isVisible("#pageChip")));
  await article.close();

  // Right-click "Ask LocalMind": background.js queues the selection in session storage
  const winId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await sw.evaluate((windowId) => chrome.storage.session.set({ pendingAsk: { action: "explain", text: "photosynthesis", windowId } }), winId);
  await page.waitForTimeout(300);
  await waitForReply();
  const pAsk = chatRequests[chatRequests.length - 1].messages.at(-1).content;
  check("right-click Ask sends the selection with its action", pAsk === "Explain this:\n\nphotosynthesis", JSON.stringify(pAsk));
  check("right-click request is cleared after sending", !(await sw.evaluate(() => chrome.storage.session.get("pendingAsk"))).pendingAsk);

  // Temperature slider: live display updates, and the value reaches the next request
  await page.click("#openSettingsBtn");
  await page.$eval("#settingTemperature", (elm) => { elm.value = "0.2"; elm.dispatchEvent(new Event("input", { bubbles: true })); });
  check("temperature display updates live while dragging", (await page.textContent("#temperatureValue")) === "0.2");
  await page.click("#saveSettingsBtn");
  await page.waitForTimeout(200);
  await page.fill("#promptInput", "Say OK.");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(300);
  await waitForReply();
  const tempSent = chatRequests[chatRequests.length - 1].options?.temperature;
  check("temperature setting reaches the model request", tempSent === 0.2, `options.temperature=${tempSent}`);

  // New chat: About You carries over, per-chat facts don't
  await page.click("#newChatBtn");
  await page.waitForTimeout(200);
  check("new chat is empty", (await page.$$(".message")).length === 0);
  await page.fill("#promptInput", "What is my favourite colour? One word.");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(300);
  await waitForReply();
  const pNew = chatRequests[chatRequests.length - 1].messages;
  check("new chat's system prompt has About You", pNew[0].content.includes("teal") && !pNew[0].content.includes("Rahul"), "per-chat facts stay out");
  const replyNew = await page.$eval(".message.assistant:last-child .message-bubble", e => e.textContent.trim());
  check("model knows About You in a new chat", /teal/i.test(replyNew), JSON.stringify(replyNew.slice(0, 80)));
  await page.click("#openSettingsBtn");
  check("About You persists in settings", (await page.inputValue("#settingProfile")).includes("teal"));
  await page.click('#settingsModal [data-close="settingsModal"] >> nth=0');

  // History list + search
  await page.click("#toggleSidebarBtn");
  await page.waitForTimeout(400);
  const rows = () => page.$$eval(".session-title", ts => ts.map(t => t.textContent));
  check("history lists both chats", (await rows()).length === 2, (await rows()).join(" | "));
  await page.fill("#sessionSearch", "FAVOURITE");
  check("search matches title (case-insensitive)", (await rows()).length === 1 && (await rows())[0].startsWith("What is my favourite"), (await rows()).join(" | "));
  check("title match shows no snippet", (await page.$$(".session-snippet")).length === 0);
  await page.fill("#sessionSearch", "lighthouse");
  const snip = await page.textContent(".session-snippet").catch(() => "");
  check("search matches message text, shows snippet", (await rows()).length === 1 && /lighthouse/i.test(snip), snip);
  await page.fill("#sessionSearch", "zzzz-nothing");
  check("no results shows a message", (await rows()).length === 0 && (await page.textContent(".session-empty")).includes("No chats match"));
  await page.fill("#sessionSearch", "");
  check("clearing search shows all chats", (await rows()).length === 2);
  // Click the far right of the row, not the title text, the way a user would
  const box = await (await page.$(".session-open >> nth=1")).boundingBox();
  await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check("clicking anywhere on a row opens that chat", (await page.$$(".message")).length >= 4);
  check("drawer closes after picking a chat", (await sidebarX()) < 0);
  check("rows show date and message count", /msgs?$/.test(await page.textContent(".session-meta >> nth=0")), await page.textContent(".session-meta >> nth=0"));
  await page.click("#toggleSidebarBtn");
  await page.waitForTimeout(400);
  await page.mouse.click(340, 300);
  await page.waitForTimeout(400);
  check("clicking the chat behind closes the drawer", (await sidebarX()) < 0);

  // Persistence across reload
  await page.reload();
  await page.waitForTimeout(1500);
  check("chats persist after reload", (await page.$$(".message")).length >= 4);

  // Context inspector + export
  await page.click("#exportContextBtn");
  check("context inspector opens", await page.isVisible("#contextModal"));
  check("inspector shows payload", JSON.parse(await page.textContent("#rawContextDisplay")).length >= 3);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#downloadMdBtn")]);
  check("markdown export downloads", dl.suggestedFilename().endsWith(".md"), dl.suggestedFilename());
  await page.click('#contextModal [data-close="contextModal"] >> nth=0');
  check("inspector closes", !(await page.isVisible("#contextModal")));

  // Delete a chat
  await page.click("#toggleSidebarBtn");
  await page.waitForTimeout(400);
  await page.click(".session-delete >> nth=0");
  await page.waitForTimeout(300);
  check("delete removes a chat", (await page.$$(".session-title")).length === 1);
  await page.click("#closeSidebarBtn");
  await page.waitForTimeout(300);

  // Theme setting
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const setTheme = async (v) => { await page.click("#openSettingsBtn"); await page.selectOption("#settingTheme", v); await page.click("#saveSettingsBtn"); await page.waitForTimeout(300); };
  await setTheme("dark");
  check("Theme: Dark applies", (await theme()) === "dark" && (await bg()) === "rgb(15, 20, 17)", `${await theme()} ${await bg()}`);
  await setTheme("light");
  check("Theme: Light applies", (await theme()) === "light" && (await bg()) === "rgb(246, 246, 242)", `${await theme()} ${await bg()}`);
  await setTheme("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(200);
  const sysDark = await theme();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(200);
  check("Theme: Match system follows OS live", sysDark === "dark" && (await theme()) === "light");
  await setTheme("dark");
  await page.reload();
  await page.waitForTimeout(1500);
  check("Theme choice persists after reload", (await theme()) === "dark");

  // Model manager
  await page.click("#openSettingsBtn");
  await page.waitForTimeout(300);
  const listed = await page.$$eval("#modelList li span", s => s.map(x => x.textContent));
  check("Settings lists server models", models.every(m => listed.includes(m)), listed.join(", "));
  await page.fill("#pullModelInput", "no-such-model-xyz-123");
  await page.click("#pullModelBtn");
  await page.waitForFunction(() => !document.getElementById("pullModelBtn").disabled, null, { timeout: limit(60000) });
  check("bad model name shows an error", (await page.textContent("#pullStatus")).startsWith("Couldn't download"), await page.textContent("#pullStatus"));

  const TEST_MODEL = "all-minilm:latest";
  if (!runPull) {
    console.log("SKIP  download/remove (real server: set E2E_PULL=1 to run it)");
  } else if (listed.includes(TEST_MODEL)) {
    console.log(`SKIP  download/remove: ${TEST_MODEL} already on server, not touching it`);
  } else {
    await page.fill("#pullModelInput", TEST_MODEL);
    await page.click("#pullModelBtn");
    await page.waitForTimeout(50);
    check("download disables button while running", await page.isDisabled("#pullModelBtn"), await page.textContent("#pullStatus"));
    await page.waitForFunction(() => !document.getElementById("pullModelBtn").disabled, null, { timeout: limit(300000) });
    check("download finishes", (await page.textContent("#pullStatus")).startsWith("Downloaded"), await page.textContent("#pullStatus"));
    const after = await page.$$eval("#modelList li span", s => s.map(x => x.textContent));
    check("downloaded model appears in list", after.includes(TEST_MODEL), after.join(", "));
    check("downloaded model appears in dropdown", (await page.$$eval("#modelSelect option", os => os.map(o => o.value))).includes(TEST_MODEL));

    const removeBtn = `#modelList li:has(span:text-is("${TEST_MODEL}")) button`;
    page.once("dialog", d => d.dismiss());
    await page.click(removeBtn);
    await page.waitForTimeout(500);
    check("cancelling remove keeps the model", (await page.$$eval("#modelList li span", s => s.map(x => x.textContent))).includes(TEST_MODEL));
    page.once("dialog", d => d.accept());
    await page.click(removeBtn);
    await page.waitForFunction(m => ![...document.querySelectorAll("#modelList li span")].some(s => s.textContent === m), TEST_MODEL, { timeout: limit(30000) });
    const final = await page.$$eval("#modelList li span", s => s.map(x => x.textContent));
    check("remove deletes it from server", !final.includes(TEST_MODEL) && models.every(m => final.includes(m)), final.join(", "));
  }
  await page.click('#settingsModal [data-close="settingsModal"] >> nth=0');

  // Message actions: Copy, Edit, Regenerate (in a fresh chat so earlier session-count checks are unaffected)
  // The page reloads above drop the earlier clipboard shim, so it's reapplied here.
  await page.evaluate(() => { navigator.clipboard.writeText = async t => { window.__clip = t; }; });
  await page.click("#newChatBtn");
  await page.fill("#promptInput", "Say the word blue.");
  await page.press("#promptInput", "Enter");
  await page.waitForTimeout(300);
  await waitForReply();
  check("only user messages get an Edit button", (await page.$$(".message.user .msg-action[data-action='edit']")).length === 1 && (await page.$$(".message.assistant .msg-action[data-action='edit']")).length === 0);
  check("only assistant messages get a Regenerate button", (await page.$$(".message.assistant .msg-action[data-action='regenerate']")).length === 1 && (await page.$$(".message.user .msg-action[data-action='regenerate']")).length === 0);

  // Stored text, not the bubble's textContent: rendering turns newlines into <br>, which textContent drops
  const assistantReplyText = await page.evaluate(() => getCurrentSession().messages.at(-1).content);
  await page.click(".message.assistant:last-child .msg-action[data-action='copy']");
  await page.waitForTimeout(100);
  check("Copy puts the raw reply text on the clipboard", (await page.evaluate(() => window.__clip)) === assistantReplyText, assistantReplyText.slice(0, 60));
  check("Copy button shows a checkmark after copying", (await page.textContent(".message.assistant:last-child .msg-action[data-action='copy']")) === "✅");

  page.once("dialog", d => d.dismiss());
  await page.click(".message.user .msg-action[data-action='edit']");
  await page.waitForTimeout(200);
  check("cancelling Edit leaves the message alone", (await page.$$(".message")).length === 2 && (await page.textContent(".message.user .message-bubble")) === "Say the word blue.");

  page.once("dialog", d => d.accept("Say the word green."));
  await page.click(".message.user .msg-action[data-action='edit']");
  await page.waitForTimeout(300);
  await waitForReply();
  check("Edit replaces the message and regenerates the reply", (await page.$$(".message")).length === 2 && (await page.textContent(".message.user .message-bubble")) === "Say the word green.");
  check("Edit resends with the new wording", chatRequests.at(-1).messages.at(-1).content === "Say the word green.");
  const beforeRegenerate = await page.$eval(".message.assistant:last-child .message-bubble", e => e.textContent.trim());

  await page.click(".message.assistant:last-child .msg-action[data-action='regenerate']");
  await page.waitForTimeout(300);
  await waitForReply();
  check("Regenerate replaces the reply, not adds another", (await page.$$(".message")).length === 2);
  check("Regenerate resends the same preceding message", chatRequests.at(-1).messages.at(-1).content === "Say the word green.");
  check("Regenerate gets a fresh reply with fresh stats", (await page.textContent(".message.assistant:last-child .message-meta")).match(/\d+(\.\d+)? tok\/s/), beforeRegenerate.slice(0, 20));

  await page.screenshot({ path: path.join(OUT, "final.png") });
  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  if (mock) mock.server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH:", e.message); process.exit(1); });
