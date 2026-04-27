# Wiki Intelligence v4

Single-file MVP для поиска по внутренним знаниям:
- YouTrack articles и issues
- внешняя `wiki.wb.ru`
- GitLab
- локальный CoreLLM adapter для `GLM-4.7`

## Что лежит в репозитории

- `youtrack-wiki-v4.html` - основной интерфейс
- `proxy-standalone.js` - proxy для запросов к YouTrack, `wiki.wb.ru` и GitLab
- `glm-zai-local-adapter.mjs` - OpenAI-compatible adapter для CoreLLM `glm-4.7`
- `start-local.sh` - локальный запуск одной командой
- `start-hosting.sh` - запуск хостингового стека одной командой
- `docker-compose.yml` - готовый deployment stack
- `deploy/nginx.conf` - reverse proxy для `/proxy` и `/llm`
- `.env.example` - пример env для сервера

## Быстрый запуск на другом ноутбуке

Это основной сценарий, если нужно, чтобы `LLM` работал на другом ноутбуке.

### Что установить

- `git`
- `Node.js 18+`
- `Python 3`
- CoreLLM JWT для `GLM`

### 1. Клонировать репозиторий

```bash
git clone https://github.com/Nightlays/Releaseteamwb.git
cd Releaseteamwb
```

### 2. Запустить всё одной командой

```bash
chmod +x start-local.sh
GLM_API_KEY='ВАШ_CORELLM_JWT' ./start-local.sh
```

Что поднимется:
- web: `http://127.0.0.1:5500/youtrack-wiki-v4.html`
- proxy: `http://127.0.0.1:8787`
- LLM adapter: `http://127.0.0.1:8789`

### 3. Проверить, что сервисы живы

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8789/health
```

Оба запроса должны вернуть `ok`.

### 4. Открыть интерфейс

Рекомендуемый вариант:

```text
http://127.0.0.1:5500/youtrack-wiki-v4.html
```

Если нужен shell:

```text
http://127.0.0.1:5500/index.html?module=yt-wiki
```

### 5. Проверить настройки в UI

В `Настройки` должны быть такие значения:
- `Proxy base` -> `http://localhost:8787`
- `Base URL` -> `http://127.0.0.1:8789/v1`
- `Model` -> `glm-4.7`

Заполнить:
- `YouTrack token`
- `Wiki bearer token`
- `GitLab token`, если нужен

Поле `LLM API key` можно оставить пустым, если adapter уже запущен с `GLM_API_KEY`.

### 6. Если открываете не локальную страницу, а залитый сайт

Можно открыть:

```text
https://releaseteamwb.ru/youtrack-wiki-v4.html
```

или, если у пользователя роль `superadmin`:

```text
https://releaseteamwb.ru/index.html?module=yt-wiki
```

Важно:
- на ноутбуке всё равно должны быть запущены локальные `proxy` и `LLM adapter`
- страница умеет автоматически откатываться на локальные `localhost`, если на домене нет backend-роутов `/proxy` и `/llm`

## Ручной локальный запуск

Если не хочется использовать `start-local.sh`, можно поднять всё руками в трёх окнах терминала.

### Окно 1. Proxy

```bash
node proxy-standalone.js
```

### Окно 2. LLM adapter

```bash
GLM_API_KEY='ВАШ_CORELLM_JWT' node glm-zai-local-adapter.mjs
```

### Окно 3. Статический web server

```bash
python3 -m http.server 5500
```

После этого открыть:

```text
http://127.0.0.1:5500/youtrack-wiki-v4.html
```

## Запуск на сервере / хостинге

### 1. Подготовить `.env`

```bash
cp .env.example .env
```

Заполнить `GLM_API_KEY`.

Пример `.env`:

```env
APP_PORT=8080
GLM_UPSTREAM_BASE=https://corellm.wb.ru/glm-47/v1
GLM_MODEL=glm-4.7
GLM_API_KEY=put_your_corellm_jwt_here
```

### 2. Запустить стек

```bash
./start-hosting.sh
```

Или:

```bash
make up
```

### 3. Открыть сайт

```text
http://YOUR_HOST:8080/
```

По умолчанию hosting-версия работает через:
- `/proxy` для внешних API-запросов
- `/health` для проверки proxy
- `/llm/v1` для LLM-запросов

### Полезные команды

```bash
make logs
make ps
make down
```

## Важные замечания

- `GLM_API_KEY` лучше хранить только в env, не в HTML.
- Если вы хотите, чтобы сайт работал с любого ноутбука без локального запуска `proxy` и `LLM adapter`, нужно вынести backend на сервер по `https`.
- Если страница уже открывалась раньше и в `localStorage` остались старые адреса, после обновления лучше сделать `hard reload`.
- В shell модуль `Wiki Intelligence v4` показывается только для `superadmin`.
