#!/usr/bin/env node

import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 8789);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_UPSTREAM_BASE = process.env.GLM_UPSTREAM_BASE || "https://corellm.wb.ru/glm-51/v1";
const DEFAULT_MODEL = process.env.GLM_MODEL || "glm-5.1";
const ENV_API_KEY = String(process.env.GLM_API_KEY || "").trim();

function getIncomingBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(header)) {
    return header
      .replace(/^bearer\s+/i, "")
      .trim()
      .split(/\s+/)[0]
      .trim();
  }
  return "";
}

function looksLikeOpenAiKey(raw) {
  return /^sk-[a-z0-9]/i.test(String(raw || "").trim());
}

function isCoreLlmUpstream(value) {
  try {
    return new URL(String(value || "")).hostname === "corellm.wb.ru";
  } catch {
    return false;
  }
}

function normalizeUpstreamBase(raw) {
  const fallback = DEFAULT_UPSTREAM_BASE;
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return fallback;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    if (!/^https?:$/i.test(url.protocol)) return fallback;
    if (!/\/v1$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, "") || ""}/v1`.replace(/\/{2,}/g, "/");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Request-Id, X-Upstream-Base",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-Request-Id, X-Upstream-Base");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function resolveUpstreamBase(req) {
  return normalizeUpstreamBase(req.headers["x-upstream-base"]);
}

function buildUpstreamUrl(pathname, upstreamBase) {
  const base = new URL(upstreamBase.replace(/\/+$/, ""));
  const suffix = pathname.replace(/^\/v1/i, "") || "/chat/completions";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${suffix}`.replace(/\/{2,}/g, "/");
  return base.toString();
}

async function proxyChatCompletions(req, res, pathname) {
  const upstreamBase = resolveUpstreamBase(req);
  const incomingToken = getIncomingBearerToken(req);
  const token = isCoreLlmUpstream(upstreamBase) && looksLikeOpenAiKey(incomingToken)
    ? ENV_API_KEY
    : (incomingToken || ENV_API_KEY);

  if (isCoreLlmUpstream(upstreamBase) && looksLikeOpenAiKey(incomingToken) && !ENV_API_KEY) {
    json(res, 400, {
      error: {
        message: "Received an OpenAI API key for a CoreLLM upstream. Use a CoreLLM JWT in API key, or leave API key empty and start the adapter with GLM_API_KEY.",
        type: "invalid_request_error"
      }
    });
    return;
  }

  if (!token) {
    json(res, 401, {
      error: {
        message: "GLM API key is missing. Set GLM_API_KEY for the adapter or pass Authorization: Bearer <key> from the browser.",
        type: "invalid_request_error"
      }
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    json(res, 400, {
      error: {
        message: `Invalid JSON body: ${String(error?.message || error)}`,
        type: "invalid_request_error"
      }
    });
    return;
  }

  if (!Array.isArray(payload.messages) || !payload.messages.length) {
    json(res, 400, {
      error: {
        message: "messages[] is required",
        type: "invalid_request_error"
      }
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(pathname, upstreamBase);
  const upstreamPayload = {
    ...payload,
    model: String(payload.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  };

  const upstreamHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Accept-Language": "en-US,en"
  };

  if (req.headers["x-client-request-id"]) {
    upstreamHeaders["X-Client-Request-Id"] = String(req.headers["x-client-request-id"]);
  }

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: upstreamHeaders,
    body: JSON.stringify(upstreamPayload)
  });

  setCors(res);
  res.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
  res.setHeader("Content-Type", contentType);
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) res.setHeader("X-Upstream-Request-Id", requestId);

  if (!upstream.body) {
    const text = await upstream.text().catch(() => "");
    res.end(text);
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, {
      ok: true,
      status: "ok",
      adapter: "glm-zai-local-adapter",
      upstreamBase: normalizeUpstreamBase(DEFAULT_UPSTREAM_BASE),
      defaultModel: DEFAULT_MODEL,
      hasEnvKey: Boolean(ENV_API_KEY)
    });
    return;
  }

  if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
    try {
      await proxyChatCompletions(req, res, pathname);
    } catch (error) {
      json(res, 502, {
        error: {
          message: String(error?.message || error),
          type: "adapter_error"
        }
      });
    }
    return;
  }

  json(res, 404, {
    error: {
      message: `Not found: ${pathname}`,
      type: "invalid_request_error"
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[glm-adapter] listening on http://${HOST}:${PORT}`);
  console.log(`[glm-adapter] upstream: ${DEFAULT_UPSTREAM_BASE}`);
  console.log(`[glm-adapter] default model: ${DEFAULT_MODEL}`);
  console.log(`[glm-adapter] env key: ${ENV_API_KEY ? "present" : "missing"}`);
});
