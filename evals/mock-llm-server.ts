// A local stand-in for a model provider, so the whole browser flow can be tested without a key.
//   npm run mock:llm            → http://127.0.0.1:4010/v1  (OpenAI-compatible chat completions)
// In the UI pick "OpenAI-compatible", base URL http://127.0.0.1:4010/v1, any model id, any 8+ character key,
// and paste the request printed below. The API only accepts an http://localhost base URL in development.
// Replies come from evals/mock-script.ts (the same script as `npm run test:engine`).
import { createServer } from "node:http";
import { calls, REQUEST, script } from "./mock-script";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4010);

interface ChatMessage { role: string; content: string | { type: string; text?: string }[] }
const textOf = (m: ChatMessage) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("\n"));

createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) return send(404, { error: { message: "Only POST /v1/chat/completions is served." } });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      const body = JSON.parse(raw) as { model?: string; messages: ChatMessage[] };
      const system = body.messages.filter((m) => m.role === "system").map(textOf).join("\n");
      const user = body.messages.filter((m) => m.role === "user").map(textOf).join("\n");
      // A new run starts with intake: reset the per-run counters the script uses.
      if (system.startsWith("[raman:intake]")) for (const k of Object.keys(calls)) delete calls[k];
      const content = JSON.stringify(script(system, user));
      const prompt_tokens = Math.ceil((system.length + user.length) / 4);
      const completion_tokens = Math.ceil(content.length / 4);
      console.log(`${new Date().toISOString().slice(11, 19)}  ${system.split("\n")[0].slice(0, 40)}`);
      send(200, {
        id: `mock-${prompt_tokens}-${completion_tokens}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model ?? "mock",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
      });
    } catch (e) {
      send(400, { error: { message: e instanceof Error ? e.message : "bad request" } });
    }
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Mock model at http://127.0.0.1:${PORT}/v1\n\nRequest to paste:\n${REQUEST}\n`);
});
