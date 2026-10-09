import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.PAPERCASE_HOST || "127.0.0.1";
const PORT = Number(process.env.PAPERCASE_PORT || 4317);
const STATIC_ROOT = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const MAX_BODY_BYTES = 6_000_000;

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validateModelConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Model settings are missing");
  const endpoint = new URL(String(config.endpoint || ""));
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Endpoint must use HTTP or HTTPS");
  const model = String(config.model || "").trim();
  if (!model || model.length > 160) throw new Error("Model ID is invalid");
  const apiKey = String(config.apiKey || "");
  if (apiKey.length > 4096) throw new Error("API key is too long");
  return { endpoint, model, apiKey };
}

async function proxyChat(request, response) {
  try {
    const body = await readJson(request);
    const { endpoint, model, apiKey } = validateModelConfig(body.config);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length || messages.length > 80) throw new Error("Messages are missing or invalid");
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 })
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) throw new Error(data?.error?.message || `Model endpoint returned HTTP ${upstream.status}`);
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("Model response did not contain message content");
    return sendJson(response, 200, { reply: reply.trim(), model });
  } catch (error) {
    return sendJson(response, 502, { error: error instanceof Error ? error.message : "Model request failed" });
  }
}

async function serveStatic(pathname, response, headOnly = false) {
  const requested = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = resolve(STATIC_ROOT, `.${requested}`);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${sep}`)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=300"
    });
    response.end(headOnly ? undefined : content);
  } catch (error) {
    sendJson(response, error?.code === "ENOENT" ? 404 : 500, { error: error?.code === "ENOENT" ? "Not found" : "Read failed" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true, service: "papercase" });
  if (request.method === "POST" && url.pathname === "/api/model/chat") return proxyChat(request, response);
  if (request.method === "GET" || request.method === "HEAD") return serveStatic(url.pathname, response, request.method === "HEAD");
  return sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`PaperCase: http://${HOST}:${PORT}/`);
  console.log("No model provider or credential is bundled.");
});
