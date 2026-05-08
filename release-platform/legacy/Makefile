SHELL := /bin/bash

.PHONY: local up down restart logs ps health

local:
	./start-local.sh

up:
	./start-hosting.sh

down:
	docker compose down

restart:
	docker compose up -d --build

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

health:
	curl -fsS http://127.0.0.1:8787/health || true
	curl -fsS http://127.0.0.1:8789/health || true
