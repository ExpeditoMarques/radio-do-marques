const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.BROADCAST_TOKEN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ICECAST_HOST = process.env.ICECAST_HOST || "127.0.0.1";
const ICECAST_PORT = Number(process.env.ICECAST_PORT || 8000);
const ICECAST_SOURCE_PASSWORD = process.env.ICECAST_SOURCE_PASSWORD || "change-me";
const MOUNT = "/live.mp3";
let broadcaster = null;
let ffmpeg = null;
let broadcastStartedAt = null;
let musicConfig = null;

app.use(express.json({ limit: "30kb" }));
function constantTimeEqual(a, b) {
  const crypto = require("crypto");
  const aa = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (!ADMIN_PASSWORD) {
    res.status(503).send("Painel administrativo desativado: configure ADMIN_PASSWORD nas variáveis do Render.");
    return;
  }
  if (scheme !== "Basic" || !encoded) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Radio do Marques - Administrador", charset="UTF-8"');
    res.status(401).send("Acesso restrito ao administrador.");
    return;
  }
  let decoded = "";
  try { decoded = Buffer.from(encoded, "base64").toString("utf8"); } catch (_) {}
  const colon = decoded.indexOf(":");
  const user = colon >= 0 ? decoded.slice(0, colon) : "";
  const pass = colon >= 0 ? decoded.slice(colon + 1) : "";
  if (user !== "admin" || !constantTimeEqual(pass, ADMIN_PASSWORD)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Radio do Marques - Administrador", charset="UTF-8"');
    res.status(401).send("Usuário ou senha incorretos.");
    return;
  }
  next();
}
app.get("/admin", requireAdmin, (_req, res) => res.sendFile(path.join(__dirname, "private", "admin.html")));
app.get("/admin.html", (_req, res) => res.status(404).send("Não encontrado."));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "Radio do Marques" }));
app.get("/api/status", (_req, res) => res.json({ live: Boolean(broadcaster && ffmpeg && !ffmpeg.killed), startedAt: broadcastStartedAt }));
app.get("/api/music", (_req, res) => res.json(musicConfig || { configured: false }));
app.post("/api/admin/music", requireAdmin, (req, res) => {
  const provider = String(req.body?.provider || "");
  const url = String(req.body?.url || "").trim();
  if (!["youtube", "spotify", "link"].includes(provider)) return res.status(400).json({ error: "Serviço não suportado." });
  let parsed;
  try { parsed = new URL(url); } catch (_) { return res.status(400).json({ error: "URL inválida." }); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return res.status(400).json({ error: "Use um link HTTP ou HTTPS." });
  const host = parsed.hostname.toLowerCase();
  if (provider === "youtube" && !["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"].includes(host)) return res.status(400).json({ error: "Use um link oficial do YouTube." });
  if (provider === "spotify" && !["open.spotify.com", "spotify.com", "www.spotify.com"].includes(host)) return res.status(400).json({ error: "Use um link oficial do Spotify." });
  musicConfig = { configured: true, provider, url, updatedAt: new Date().toISOString() };
  res.json({ ok: true, music: musicConfig });
});
app.delete("/api/admin/music", requireAdmin, (_req, res) => { musicConfig = null; res.json({ ok: true }); });

// O áudio MP3 é servido pelo Icecast através do servidor web.
app.get("/stream/live.mp3", (req, res) => {
  const upstream = http.get({ hostname: ICECAST_HOST, port: ICECAST_PORT, path: MOUNT, headers: { "User-Agent": "Radio-do-Marques/2.1" } }, audio => {
    res.status(audio.statusCode || 200);
    res.setHeader("Content-Type", audio.headers["content-type"] || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    audio.pipe(res);
    req.on("close", () => audio.destroy());
  });
  upstream.on("error", () => { if (!res.headersSent) res.status(503).json({ error: "A rádio está fora do ar no momento." }); else res.end(); });
  req.on("close", () => upstream.destroy());
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/broadcast") { socket.destroy(); return; }
  const token = url.searchParams.get("token") || "";
  if (!TOKEN || !constantTimeEqual(token, TOKEN)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  if (broadcaster) { socket.write("HTTP/1.1 409 Conflict\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
});

wss.on("connection", ws => {
  const target = `icecast://${encodeURIComponent("source")}:${encodeURIComponent(ICECAST_SOURCE_PASSWORD)}@${ICECAST_HOST}:${ICECAST_PORT}${MOUNT}`;
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-fflags", "+genpts", "-f", "webm", "-i", "pipe:0", "-vn", "-ac", "2", "-ar", "44100", "-b:a", "128k", "-content_type", "audio/mpeg", "-f", "mp3", target], { stdio: ["pipe", "ignore", "pipe"] });
  ffmpeg = child; broadcaster = ws; broadcastStartedAt = new Date().toISOString();
  child.stderr.on("data", data => console.log("[ffmpeg]", data.toString().trim()));
  child.on("error", err => { console.error("FFmpeg:", err.message); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "error", message: "Falha ao iniciar o codificador de áudio." })); ws.close(); });
  child.on("close", code => { console.log("FFmpeg encerrado:", code); if (broadcaster === ws) broadcaster = null; if (ffmpeg === child) ffmpeg = null; broadcastStartedAt = null; });
  ws.on("message", (data, isBinary) => { if (!isBinary || !child.stdin.writable) return; if (!child.stdin.write(data)) ws.pause(); });
  child.stdin.on("drain", () => { if (ws.readyState === WebSocket.OPEN) ws.resume(); });
  ws.on("close", () => stopBroadcast(ws, child));
  ws.on("error", () => stopBroadcast(ws, child));
  ws.send(JSON.stringify({ type: "ready", message: "Microfone conectado. Transmissão iniciada." }));
});
function stopBroadcast(ws, child) {
  if (broadcaster === ws) broadcaster = null;
  if (ffmpeg === child) ffmpeg = null;
  try { child.stdin.end(); } catch (_) {}
  setTimeout(() => { try { child.kill("SIGTERM"); } catch (_) {} }, 1200).unref();
  broadcastStartedAt = null;
}
server.listen(PORT, "0.0.0.0", () => console.log(`Rádio do Marquês ouvindo na porta ${PORT}`));
process.on("SIGTERM", () => { if (broadcaster) { try { broadcaster.close(); } catch (_) {} } server.close(() => process.exit(0)); });
