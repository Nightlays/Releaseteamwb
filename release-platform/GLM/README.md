# GLM Local Adapter

Локальный OpenAI-совместимый адаптер для [CoreLLM](https://corellm.wb.ru) (`glm-5.1`).  
Слушает на `http://127.0.0.1:8789` и проксирует запросы к upstream CoreLLM API.

## Зачем

Браузер не может напрямую обращаться к `corellm.wb.ru` из-за CORS и необходимости хранить JWT.  
Адаптер запускается локально, принимает запросы от фронта и подставляет нужный токен.

## Требования

- Node.js 18+
- CoreLLM JWT (получить у devops или в профиле corellm.wb.ru)

## Быстрый запуск

```bash
cd release-platform/legacy/GLM
GLM_API_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzb1BNdUZ1dm5UOE1QS01uV3ppSUlWZko0M25mTlE0ZiJ9.AgJJ9Kre6dQpPBANKcvZ4QwvBwAsj66ggNVVGyp8ga4' node glm-zai-local-adapter.mjs
```

Адаптер поднимется на `http://127.0.0.1:8789`.

### Проверка

```bash
curl http://127.0.0.1:8789/health
```

Ожидаемый ответ:
```json
{
  "ok": true,
  "adapter": "glm-zai-local-adapter",
  "upstreamBase": "https://corellm.wb.ru/glm-51/v1",
  "defaultModel": "glm-5.1",
  "hasEnvKey": true
}
```

## Переменные окружения

| Переменная          | По умолчанию                             | Описание                          |
|---------------------|------------------------------------------|-----------------------------------|
| `GLM_API_KEY`       | —                                        | CoreLLM JWT (обязателен)          |
| `GLM_UPSTREAM_BASE` | `https://corellm.wb.ru/glm-51/v1`        | Upstream API base URL             |
| `GLM_MODEL`         | `glm-5.1`                                | Модель по умолчанию               |
| `PORT`              | `8789`                                   | Порт адаптера                     |
| `HOST`              | `127.0.0.1`                              | Хост адаптера                     |

Скопируй `.env.example` → `.env` и заполни `GLM_API_KEY`:

```bash
cp .env.example .env
# отредактируй .env
```

Запуск с файлом `.env`:
```bash
export $(grep -v '^#' .env | xargs)
node glm-zai-local-adapter.mjs
```

## Запуск через Docker

Из директории `release-platform/legacy`:

```bash
GLM_API_KEY='ВАШ_JWT' docker compose up llm
```

## Смена upstream (при обновлении версии модели)

```bash
GLM_UPSTREAM_BASE=https://corellm.wb.ru/glm-52/v1 GLM_MODEL=glm-5.2 \
  GLM_API_KEY='ВАШ_JWT' node glm-zai-local-adapter.mjs
```

## Настройка в интерфейсе Release Platform

В настройках (шестерёнка) заполни:

- **LLM Base URL**: `http://localhost:8789/v1`
- **LLM API Key**: можно оставить пустым, если адаптер запущен с `GLM_API_KEY`
- **LLM Model**: `glm-5.1`
