const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.BROADCAST_TOKEN || "";
const ICECAST_HOST = process.env.ICECAST_HOST || "127.0.0.1";
const ICECAST_PORT = Number(process.env.ICECAST_PORT || 8000);
const ICECAST_SOURCE_PASSWORD = process.env.ICECAST_SOURCE_PASSWORD || "change-me";
const MOUNT = "/live.mp3";
let broadcaster = null;
let ffmpeg = null;
let broadcastStartedAt = null;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "Radio do Marques" }));
app.get("/api/status", (_req, res) => res.json({
  live: Boolean(broadcaster && ffmpeg && !ffmpeg.killed),
  startedAt: broadcastStartedAt
}));

// Proxy público do áudio. O Icecast fica acessível apenas dentro do contêiner.
app.get("/stream/live.mp3", (req, res) => {
  const upstream = http.get({
    hostname: ICECAST_HOST,
    port: ICECAST_PORT,
    path: MOUNT,
    headers: { "User-Agent": "Radio-do-Marques/2.0" }
  }, (audio) => {
    res.status(audio.statusCode || 200);
    res.setHeader("Content-Type", audio.headers["content-type"] || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    audio.pipe(res);
    req.on("close", () => audio.destroy());
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.status(503).json({ error: "A rádio está fora do ar no momento." });
    else res.end();
  });
  req.on("close", () => upstream.destroy());
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/broadcast") {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get("token") || "";
  if (!TOKEN || token.length !== TOKEN.length || !constantTimeEqual(token, TOKEN)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (broadcaster) {
    socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
});

wss.on("connection", ws => {
  // MediaRecorder sends WebM/Opus chunks. FFmpeg converts them to MP3 for Icecast.
  const target = `icecast://${encodeURIComponent("source")}:${encodeURIComponent(ICECAST_SOURCE_PASSWORD)}@${ICECAST_HOST}:${ICECAST_PORT}${MOUNT}`;
  ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "warning", "-fflags", "+genpts",
    "-f", "webm", "-i", "pipe:0",
    "-vn", "-ac", "2", "-ar", "44100", "-b:a", "128k",
    "-content_type", "audio/mpeg", "-f", "mp3", target
  ], { stdio: ["pipe", "ignore", "pipe"] });
  broadcaster = ws;
  broadcastStartedAt = new Date().toISOString();

  ffmpeg.stderr.on("data", data => console.log("[ffmpeg]", data.toString().trim()));
  ffmpeg.on("error", err => {
    console.error("Não foi possível iniciar o FFmpeg:", err.message);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "error", message: "Falha ao iniciar o codificador de áudio." }));
    ws.close();
  });
  ffmpeg.on("close", code => {
    console.log("FFmpeg encerrado:", code);
    if (broadcaster === ws) broadcaster = null;
    broadcastStartedAt = null;
  });

  ws.on("message", (data, isBinary) => {
    if (!isBinary || !ffmpeg || !ffmpeg.stdin.writable) return;
    if (!ffmpeg.stdin.write(data)) ws.pause();
  });
  ffmpeg.stdin.on("drain", () => { if (ws.readyState === WebSocket.OPEN) ws.resume(); });

  ws.on("close", () => stopBroadcast(ws));
  ws.on("error", () => stopBroadcast(ws));
  ws.send(JSON.stringify({ type: "ready", message: "Microfone conectado. Transmissão iniciada." }));
});

function stopBroadcast(ws) {
  if (broadcaster === ws) broadcaster = null;
  if (ffmpeg) {
    const child = ffmpeg;
    ffmpeg = null;
    try { child.stdin.end(); } catch (_) {}
    setTimeout(() => { try { child.kill("SIGTERM"); } catch (_) {} }, 1500).unref();
  }
  broadcastStartedAt = null;
}
function constantTimeEqual(a, b) {
  const crypto = require("crypto");
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

server.listen(PORT, "0.0.0.0", () => console.log(`Rádio do Marquês ouvindo na porta ${PORT}`));
process.on("SIGTERM", () => {
  if (broadcaster) { try { broadcaster.close(); } catch (_) {} }
  server.close(() => process.exit(0));
});
