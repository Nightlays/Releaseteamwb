---
tags:
  - service
  - ml
updated: 2026-05-04
---

# ML retrain helper

## Роль в проекте

Локальный Python helper для переобучения CatBoost/ONNX модели релизного риска и публикации bundle/meta.

## Код

- `legacy/ml_retrain_helper.py`
- shell helpers:
  - `tools/run_ml_retrain_helper.sh`
  - `tools/retrain_catboost.sh`
  - `tools/bootstrap_ml_env.sh`

## Endpoints

- `GET /health`
- `GET /api/ml/health`
- `GET /api/ml/status`
- `POST /api/ml/retrain`

## Используют

- [[Графики]]
- [[Дашборд]] косвенно через CatBoost ONNX assets и `releasePrediction.ts`

## Настройки UI

- `mlHelperBase`, default `http://127.0.0.1:8788`

## Артефакты

- `catboost_release_risk.onnx`
- `catboost_release_risk.meta.json`
- `catboost_release_risk.bundle.js`
- `catboost_release_risk.manifest.json`

## Риски

- Helper локальный и блокируется `LOCK`, параллельный retrain вернет `409`.
- Пути к train script и bundle должны соответствовать фактической структуре репозитория.
