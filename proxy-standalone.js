#!/usr/bin/env node

const http = require("node:http");
const { Readable } = require("node:stream");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Authorization, X-Proxy-Cookie, X-Proxy-Token, X-Proxy-Key, PRIVATE-TOKEN, X-Client-Request-Id"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  setCors(res);
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

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks);
}

function buildUpstreamHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;
    const lower = String(name).toLowerCase();
    if ([
      "host",
      "connection",
      "content-length",
      "accept-encoding",
      "origin",
      "referer"
    ].includes(lower)) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

async function proxyRequest(req, res) {
  const targetUrl = getTargetUrl(req.url, req.headers.host);
  if (!targetUrl) {
    json(res, 400, {
      ok: false,
      error: "Missing ?url=<target> query parameter"
    });
    return;
  }
  if (!isAllowedTarget(targetUrl)) {
    json(res, 400, {
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

  setCors(res);
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

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      status: "ok",
      proxy: "standalone",
      host: HOST,
      port: PORT
    });
    return;
  }

  if (url.pathname === "/proxy") {
    try {
      await proxyRequest(req, res);
    } catch (error) {
      json(res, 502, {
        ok: false,
        error: String(error && error.message ? error.message : error)
      });
    }
    return;
  }

  json(res, 404, {
    ok: false,
    error: `Not found: ${url.pathname}`
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy] listening on http://${HOST}:${PORT}`);
});
