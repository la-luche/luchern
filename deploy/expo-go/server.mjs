import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";

const HOST = process.env.GATEWAY_HOST || "127.0.0.1";
const PORT = Number(process.env.GATEWAY_PORT || 8089);
const UPSTREAM_HOST = process.env.EXPO_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.EXPO_PORT || 8081);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://go.luche.ai";
const EXPO_GO_URL = PUBLIC_ORIGIN.replace(/^https:/, "exps:").replace(/^http:/, "exp:");

const landingTemplate = await readFile(new URL("./landing.html", import.meta.url), "utf8");
const expoGoQr = await readFile(new URL("./expo-go-qr.svg", import.meta.url));
const landing = landingTemplate
  .replaceAll("{{PUBLIC_ORIGIN}}", PUBLIC_ORIGIN)
  .replaceAll("{{EXPO_GO_URL}}", EXPO_GO_URL);

function sendLanding(res) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  res.end(landing);
}

function isExpoManifestRequest(req) {
  const platform = req.headers["expo-platform"];
  return platform === "ios" || platform === "android";
}

function upstreamHeaders(req) {
  return {
    ...req.headers,
    host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    "x-forwarded-host": req.headers.host || new URL(PUBLIC_ORIGIN).host,
    "x-forwarded-proto": new URL(PUBLIC_ORIGIN).protocol.slice(0, -1),
  };
}

function proxyHttp(req, res) {
  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(req),
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    }
    res.end(`Expo server unavailable: ${error.message}\n`);
  });
  req.pipe(upstream);
}

function proxyWebSocket(req, clientSocket, head) {
  const upstreamSocket = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);

  upstreamSocket.on("connect", () => {
    upstreamSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index];
      const value = req.rawHeaders[index + 1];
      if (name.toLowerCase() !== "host") upstreamSocket.write(`${name}: ${value}\r\n`);
    }
    upstreamSocket.write(`Host: ${UPSTREAM_HOST}:${UPSTREAM_PORT}\r\n`);
    upstreamSocket.write(`X-Forwarded-Host: ${req.headers.host || new URL(PUBLIC_ORIGIN).host}\r\n`);
    upstreamSocket.write(`X-Forwarded-Proto: ${new URL(PUBLIC_ORIGIN).protocol.slice(0, -1)}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });

  upstreamSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstreamSocket.destroy());
}

async function health(res) {
  const request = http.get(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: "/status", timeout: 2000 },
    (upstreamRes) => {
      upstreamRes.resume();
      const ok = upstreamRes.statusCode === 200;
      res.writeHead(ok ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
    },
  );
  request.on("timeout", () => request.destroy());
  request.on("error", () => {
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "unavailable" }));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", PUBLIC_ORIGIN);
  if (url.pathname === "/_luche/health") return void health(res);
  if (url.pathname === "/_luche/expo-go-qr.svg") {
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    });
    return void res.end(expoGoQr);
  }
  if (url.pathname.startsWith("/_luche/")) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return void res.end("Not found\n");
  }
  if (url.pathname === "/" && !isExpoManifestRequest(req)) return void sendLanding(res);
  proxyHttp(req, res);
});

server.on("upgrade", proxyWebSocket);
server.listen(PORT, HOST, () => {
  console.log(`Luche Expo Go gateway on http://${HOST}:${PORT} -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
