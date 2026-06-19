#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const STATIC_DIR = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : "";

function setCors(req, res) {
  const defaults = [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "authorization-deploy-lab",
    "X-Authorization",
    "X-Proxy-Cookie",
    "X-Proxy-Token",
    "X-Proxy-Key",
    "PRIVATE-TOKEN",
    "X-Client-Request-Id"
  ];
  const requested = String(req?.headers?.["access-control-request-headers"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const merged = [];
  const seen = new Set();
  for (const value of [...defaults, ...requested]) {
    const key = String(value || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", merged.join(", "));
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
}

function json(req, res, status, payload) {
  const body = JSON.stringify(payload);
  setCors(req, res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function getTargetUrl(reqUrl, hostHeader) {
  const url = new URL(reqUrl || "/", `http://${hostHeader || `${HOST}:${PORT}`}`);
  return String(url.searchParams.get("url") || "").trim();
}

function isAllowedTarget(value) {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol);
  } catch {
    return false;
  }
}

function safeStaticPath(urlPathname) {
  if (!STATIC_DIR) return null;
  const decoded = decodeURIComponent(urlPathname || "/");
  const clean = decoded === "/" ? "/index.html" : decoded;
  const target = path.resolve(STATIC_DIR, `.${clean}`);
  if (target !== STATIC_DIR && !target.startsWith(`${STATIC_DIR}${path.sep}`)) return null;
  return target;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res, url) {
  if (!STATIC_DIR || !["GET", "HEAD"].includes(req.method)) return false;
  const filePath = safeStaticPath(url.pathname);
  if (!filePath) return false;

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) return false;
  } catch {
    return false;
  }

  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": stat.size,
    "Cache-Control": "no-cache"
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks);
}

function buildUpstreamHeaders(req) {
  const headers = {};
  const proxyCookie = req?.headers?.["x-proxy-cookie"];
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;
    const lower = String(name).toLowerCase();
    if ([
      "host",
      "connection",
      "content-length",
      "accept-encoding",
      "origin",
      "referer",
      "x-proxy-cookie"
    ].includes(lower)) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  if (proxyCookie && !headers.Cookie && !headers.cookie) {
    headers.Cookie = Array.isArray(proxyCookie) ? proxyCookie.join("; ") : String(proxyCookie);
  }
  return headers;
}

async function proxyRequest(req, res) {
  const targetUrl = getTargetUrl(req.url, req.headers.host);
  if (!targetUrl) {
    json(req, res, 400, {
      ok: false,
      error: "Missing ?url=<target> query parameter"
    });
    return;
  }
  if (!isAllowedTarget(targetUrl)) {
    json(req, res, 400, {
      ok: false,
      error: "Only http(s) upstream targets are allowed"
    });
    return;
  }

  const body = await readBody(req);
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: buildUpstreamHeaders(req),
    body,
    redirect: "follow"
  });

  setCors(req, res);
  res.statusCode = upstream.status;

  for (const [name, value] of upstream.headers.entries()) {
    const lower = String(name).toLowerCase();
    if (["content-length", "content-encoding", "transfer-encoding", "connection"].includes(lower)) {
      continue;
    }
    res.setHeader(name, value);
  }

  if (!upstream.body) {
    res.end(await upstream.text().catch(() => ""));
    return;
  }

  const upstreamStream = Readable.fromWeb(upstream.body);
  upstreamStream.on("error", (error) => {
    if (!res.destroyed) res.destroy(error);
  });
  res.on("close", () => {
    upstreamStream.destroy();
  });
  upstreamStream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
    json(req, res, 200, {
      ok: true,
      status: "ok",
      proxy: "standalone",
      host: HOST,
      port: PORT,
      static: Boolean(STATIC_DIR)
    });
    return;
  }

  if (url.pathname === "/proxy" || url.pathname === "/api/proxy") {
    try {
      await proxyRequest(req, res);
    } catch (error) {
      json(req, res, 502, {
        ok: false,
        error: String(error && error.message ? error.message : error)
      });
    }
    return;
  }

  if (serveStatic(req, res, url)) return;

  json(req, res, 404, {
    ok: false,
    error: `Not found: ${url.pathname}`
  });
});

server.listen(PORT, HOST, () => {
  const staticInfo = STATIC_DIR ? `, static ${STATIC_DIR}` : "";
  console.log(`[proxy] listening on http://${HOST}:${PORT}${staticInfo}`);
});
