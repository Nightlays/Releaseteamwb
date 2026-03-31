# Wiki Intelligence v4

Single-file internal knowledge portal with:
- YouTrack article and issue search
- external `wiki.wb.ru` retrieval
- GitLab search
- local CoreLLM adapter for `GLM-4.7`

## What is in the repo

- `youtrack-wiki-v4.html` - main frontend
- `proxy-standalone.js` - local/server proxy for YouTrack, `wiki.wb.ru` and GitLab requests
- `glm-zai-local-adapter.mjs` - OpenAI-compatible adapter for CoreLLM `glm-4.7`
- `start-local.sh` - one-command local run
- `start-hosting.sh` - one-command hosting start
- `Makefile` - shortcuts for local and docker workflows
- `docker-compose.yml` - ready deployment stack
- `deploy/nginx.conf` - same-origin reverse proxy for `/proxy` and `/llm`

## Quick start locally

Requirements:
- Node.js 18+
- Python 3
- CoreLLM JWT for GLM

```bash
GLM_API_KEY='YOUR_CORELLM_JWT' make local
```

This starts:
- static web on `http://127.0.0.1:5500/youtrack-wiki-v4.html`
- proxy on `http://127.0.0.1:8787`
- LLM adapter on `http://127.0.0.1:8789`

If you want manual startup, you can still run in three terminals:

```bash
node proxy-standalone.js
```

```bash
GLM_API_KEY='YOUR_CORELLM_JWT' node glm-zai-local-adapter.mjs
```

```bash
python3 -m http.server 5500
```

Open:

```text
http://127.0.0.1:5500/youtrack-wiki-v4.html
```

Check health:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8789/health
```

## Quick start on hosting

1. Prepare `.env`

```bash
cp .env.example .env
```

2. Put your CoreLLM JWT into `GLM_API_KEY`

```bash
./start-hosting.sh
```

Or:

```bash
make up
```

3. Open

```text
http://YOUR_HOST:8080/
```

By default the hosted app works through:
- `/proxy` for external API calls
- `/health` for proxy health
- `/llm/v1` for LLM requests

Useful commands:

```bash
make logs
make ps
make down
```

## UI settings

Fill these in the app settings:
- `YouTrack token`
- `Wiki bearer token`
- `GitLab token`, if needed

LLM defaults for hosted mode:
- `Base URL` -> `https://YOUR_HOST/llm/v1` or same-origin `/llm/v1`
- `Model` -> `glm-4.7`

LLM defaults for local mode:
- `Base URL` -> `http://127.0.0.1:8789/v1`
- `Model` -> `glm-4.7`

## Notes

- `GLM_API_KEY` should stay only on the server, not inside HTML.
- If you put this behind a real domain, terminate TLS in your outer reverse proxy or load balancer.
- The frontend persists settings in `localStorage`, so after URL or model changes it is worth doing a hard reload.
- The hosting stack is self-contained now: proxy and adapter are part of this repo and are built into containers from the same checkout.
