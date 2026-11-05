// Minimal stand-in for the Ollama HTTP API, so the end-to-end test runs without a real model (e.g. in CI).
// Like real Ollama, it rejects requests that carry an unknown Origin header with 403,
// which proves the extension's Origin-stripping rule works.
const http = require("http");

function startMockOllama(port = 0) {
  const models = new Set(["mock-small:latest", "mock-large:7b"]);
  const LIBRARY = new Set(["all-minilm:latest"]); // names /api/pull accepts

  const readBody = (req) => new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => r(b ? JSON.parse(b) : {})); });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const ndjson = (res) => { res.writeHead(200, { "Content-Type": "application/x-ndjson" }); return (obj) => res.write(JSON.stringify(obj) + "\n"); };

  const server = http.createServer(async (req, res) => {
    if (req.headers.origin) { res.writeHead(403); return res.end(); }

    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [...models].map(name => ({ name })) }));
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const { model, messages, stream } = await readBody(req);
      if (stream === false) { // per-part page summaries
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ model, done: true, message: { role: "assistant", content: `- summary of ${messages.at(-1).content.length} chars` } }));
      }
      const send = ndjson(res);
      const last = messages[messages.length - 1].content;
      // Long prompts stream slowly so the test can press Stop mid-reply
      if (/story/i.test(last)) {
        for (let i = 0; i < 200 && !res.destroyed; i++) { send({ model, message: { role: "assistant", content: `word${i} ` } }); await sleep(50); }
      } else {
        // Echo everything the model was given, so tests can check what context reached it
        const reply = `PONG. I received: ${messages.map(m => m.content).join(" | ")}`;
        // ~20 pieces whatever the length, so echoing an attached page doesn't take a minute
        const size = Math.max(7, Math.ceil(reply.length / 20));
        for (const piece of reply.match(new RegExp(`.{1,${size}}`, "gs"))) { send({ model, message: { role: "assistant", content: piece } }); await sleep(20); }
      }
      // Fake but plausible generation timings, so the client's speed-stats code has real fields to read
      send({ model, done: true, eval_count: 42, eval_duration: 400_000_000 });
      return res.end();
    }

    if (req.method === "POST" && req.url === "/api/pull") {
      const { model } = await readBody(req);
      const send = ndjson(res);
      if (!LIBRARY.has(model)) { send({ error: "pull model manifest: file does not exist" }); return res.end(); }
      send({ status: "pulling manifest" });
      for (let done = 0; done <= 100; done += 25) { send({ status: "downloading", total: 100, completed: done }); await sleep(100); }
      models.add(model);
      send({ status: "success" });
      return res.end();
    }

    if (req.method === "DELETE" && req.url === "/api/delete") {
      const { model } = await readBody(req);
      if (!models.delete(model)) { res.writeHead(404); return res.end(JSON.stringify({ error: `model '${model}' not found` })); }
      res.writeHead(200);
      return res.end();
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise(r => server.listen(port, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { startMockOllama };
