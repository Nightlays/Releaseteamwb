#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Сбор дежурных по стримам из Band
+ справочник стримов из Allure TestOps (TestPlan -> tree/leaf)
+ лиды QA берём из Google Drive JSON (handle -> [streams])
+ поддержка алиасов стримов (STREAM_ALIASES), чтобы один и тот же стрим понимался под разными названиями.

v9.2 — ДОРАБОТАНО ТОЛЬКО ПО ТРЕБОВАНИЮ.
"""

import sys
import json
import re
import subprocess
from typing import Dict, List, Tuple, Optional, Set, Iterable
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

# ---------- автоустановка зависимостей ----------
def _ensure(pkgs: List[str]) -> None:
    import importlib
    missing = []
    for p in pkgs:
        try:
            importlib.import_module(p.split("==")[0].split("[")[0])
        except Exception:
            missing.append(p)
    if missing:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", *missing])

_ensure(["requests", "python-dateutil"])
try:
    from zoneinfo import ZoneInfo
except Exception:
    _ensure(["backports.zoneinfo"])
    from backports.zoneinfo import ZoneInfo  # type: ignore

import requests

# ---------- Константы ----------

# Allure TestOps: список leaf-узлов из тест-плана (пример, как в твоём curl)
ALLURE_TESTPLAN_LEAF_URL = (
    "https://allure-testops.wb.ru/api/testplan/3918/tree/leaf"
    "?treeId=987&projectId=7&path=7904&sort=name%2Casc&size=100"
)

# ВНИМАНИЕ: endpoint авторизуется ТОЛЬКО по API токену (как было в предыдущем скрипте)
ALLURE_API_TOKEN = "c60f6235-440d-4657-983a-51dc71c53cf2"

# Лиды QA (Google Drive)
QA_LEADS_GDRIVE_VIEW_URL = "https://drive.google.com/file/d/1Arzm2ZEix5aVyp0lqAFeZxLnDnkfkkUb/view?usp=sharing"
QA_LEADS_LOCAL_FALLBACK = "Лиды QA.json"  # если скачать по ссылке не удалось (опционально)

# Чтение сообщений из канала
BAND_CHANNEL = "6sqki85urpbfbqdkcdfen33owh"
BAND_SINCE_URL_TMPL = ("https://band.wb.ru/api/v4/channels/{channel}/posts"
                       "?since={since_ms}&skipFetchThreads=false&collapsedThreads=true&collapsedThreadsExtended=false")

# Куки для чтения/поиска
BAND_COOKIES_FIXED = (
    "wbx-validation-key=851d9f8d-c840-487d-afda-5eb3ba9c4504; "
    "_ym_uid=1750866811332929169; "
    "_ym_d=1750866811; "
    "_ga=GA1.1.665364734.1752585353; "
    "_ga_NM1B0HQXGM=GS2.1.s1753849272$o2$g0$t1753849272$j60$l0$h0; "
    "MMAUTHTOKEN=q89hcm6h57fzbkwmxfmoeft1no; "
    "MMUSERID=zs6su5ntnbdw886tc4c1dnjd9c; "
    "MMCSRF=gqtynzaukpr3uf9twwkpacyrbh"
)
BAND_CSRF_SEARCH = "iio6zk18ebby5bfytwamfokwwh"

# Куки/токены для админ-операций (удаление/добавление)
BAND_COOKIES_ADMIN = (
    "wbx-validation-key=851d9f8d-c840-487d-afda-5eb3ba9c4504; "
    "_ym_uid=1750866811332929169; "
    "_ym_d=1750866811; "
    "_ga=GA1.1.665364734.1752585353; "
    "_ga_NM1B0HQXGM=GS2.1.s1753849272$o2$g0$t1753849272$j60$l0$h0; "
    "MMAUTHTOKEN=q89hcm6h57fzbkwmxfmoeft1no; "
    "MMUSERID=zs6su5ntnbdw886tc4c1dnjd9c; "
    "MMCSRF=gqtynzaukpr3uf9twwkpacyrbh"
)
BAND_CSRF_ADMIN = "gqtynzaukpr3uf9twwkpacyrbh"

# Идентификаторы групп
GROUP_ANDROID = "bbtekcuhfjykmm9awe56gebj9y"
GROUP_IOS     = "6skkxrr3ufrkmy1u3paepd35ar"

# ---------- НОВОЕ: публикация недостающих дежурных в чат ----------
BAND_CHANNEL_ID = "6sqki85urpbfbqdkcdfen33owh"
BAND_POST_COOKIES = (
    "wbx-validation-key=c71f4017-d14e-4ac8-81c1-c6aa63436d9c; "
    "MMAUTHTOKEN=bdxpamsi6p8etb879eo8eqf4fc; "
    "MMUSERID=nibrb4qs8ty4zp61x1pgyeziqe; "
    "MMCSRF=thho59busin1bpcjtsu5ubfpew"

)
BAND_POST_CSRF = "thho59busin1bpcjtsu5ubfpew"
BAND_POST_USER_ID = "nibrb4qs8ty4zp61x1pgyeziqe"

REQ_TIMEOUT = 30

# Исключаем из вывода (и из пингов)
EXCLUDE_STREAMS = {s.casefold() for s in [
    "WBA Автоматизаторы аналитики",
    "Релизный стрим (мигра, вшитки)",
    "Релизный стрим (мигра, вшитки,сват)",
    "Релизный стрим (мигра, вшитки, сват)",
]}

# ---------- НОВОЕ: алиасы стримов (заполняешь сам) ----------
# Формат: "КАНОНИЧЕСКОЕ_НАЗВАНИЕ_КАК_В_ALLURE": ["вариант 1", "вариант 2", ...]
# Это влияет на:
#  - сопоставление стримов при парсинге сообщений Band
#  - сопоставление стримов с лидами QA из JSON
#
# Пример: "ДБО Депозиты и накопления": ["Депозиты и накопления"]
STREAM_ALIASES: Dict[str, List[str]] = {
    # ВАЖНО: Core часто пишут как Core Android / Core iOS — сводим к одному каноническому "Core"
    "Core": ["Core Android", "Core iOS"],

    # Частые расхождения (можешь расширять/править):
    "C2C": ["С2С", "С2C", "C2С"],
    "Корзина (B2B)": ["B2B", "Корзина B2B", "Корзина (B2B)"],
    "Способы доставки": ["Способы доставок"],
    "ДБО Депозиты и накопления": ["Депозиты и накопления"],
}

# ---------- Utils ----------
def _norm(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()

def _dedup_keep_order(items: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for x in items:
        if x not in seen:
            out.append(x)
            seen.add(x)
    return out

# ---------- HTTP ----------
def http_get_json(url: str, headers: dict, params: dict = None) -> dict:
    r = requests.get(url, headers=headers, params=params, timeout=REQ_TIMEOUT)
    r.raise_for_status()
    return r.json()

def http_post_json(url: str, headers: dict, json_body: dict) -> dict:
    r = requests.post(url, headers=headers, json=json_body, timeout=REQ_TIMEOUT)
    r.raise_for_status()
    return r.json() if r.text.strip() else {}

def http_delete_json(url: str, headers: dict, json_body: dict) -> dict:
    r = requests.delete(url, headers=headers, json=json_body, timeout=REQ_TIMEOUT)
    if r.status_code not in (200, 204):
        r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return {}

# ---------- Band headers ----------
def band_headers_read() -> dict:
    return {
        "sec-ch-ua-platform": "\"Windows\"",
        "Referer": "",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "ru",
        "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "sec-ch-ua-mobile": "?0",
        "Cookie": BAND_COOKIES_FIXED,
    }

def band_headers_search_json() -> dict:
    return {
        "sec-ch-ua-platform": "\"Windows\"",
        "X-CSRF-Token": BAND_CSRF_SEARCH,
        "Referer": "",
        "Accept-Language": "ru",
        "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
        "sec-ch-ua-mobile": "?0",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
        "Cookie": BAND_COOKIES_FIXED,
    }

def band_headers_admin_json() -> dict:
    return {
        "accept": "*/*",
        "accept-language": "en",
        "content-type": "application/json",
        "origin": "https://band.wb.ru",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "x-csrf-token": BAND_CSRF_ADMIN,
        "x-requested-with": "XMLHttpRequest",
        "Cookie": BAND_COOKIES_ADMIN,
    }

def band_headers_admin_getlist() -> dict:
    return {
        "sec-ch-ua-platform": "\"Windows\"",
        "Referer": "",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "ru",
        "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "sec-ch-ua-mobile": "?0",
        "Cookie": BAND_COOKIES_ADMIN,
    }


def band_headers_post_json() -> dict:
    return {
        "accept": "*/*",
        "accept-language": "ru",
        "content-type": "application/json",
        "origin": "https://band.wb.ru",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Google Chrome\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        "x-csrf-token": BAND_POST_CSRF,
        "x-requested-with": "XMLHttpRequest",
        "Cookie": BAND_POST_COOKIES,
    }
# ---------- Allure TestOps: стримы из testplan ----------
def _allure_testplan_headers(api_token: str) -> dict:
    # Пробуем несколько вариантов заголовков (на разных инсталляциях Allure TestOps отличаются)
    return {
        "accept": "application/json",
        "accept-language": "ru,en;q=0.9",
        "referer": "https://allure-testops.wb.ru/testplan/3918",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0",
        "Authorization": f"Api-Token {api_token}",
        "X-ALLURE-API-TOKEN": api_token,
        "allure-api-token": api_token,
    }

def _set_url_query(url: str, **kwargs) -> str:
    """Аккуратно меняем/добавляем query-параметры к URL."""
    u = urlparse(url)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    for k, v in kwargs.items():
        q[str(k)] = str(v)
    new_q = urlencode(q, doseq=True)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_q, u.fragment))

def parse_streams_from_testplan_leaf_json(data: dict) -> List[str]:
    names: List[str] = []
    for item in (data or {}).get("content", []) or []:
        nm = (item or {}).get("name")
        if isinstance(nm, str):
            nm = nm.strip()
            if nm:
                names.append(nm)
    return _dedup_keep_order(names)

def fetch_stream_catalog_from_testplan_leaf(url: str, api_token: str) -> List[str]:
    headers = _allure_testplan_headers(api_token)

    # Стараемся корректно вычитать все страницы, если их больше 1.
    all_names: List[str] = []
    page = 0
    while True:
        page_url = _set_url_query(url, page=page)
        data = http_get_json(page_url, headers=headers)
        all_names.extend(parse_streams_from_testplan_leaf_json(data))

        last = (data or {}).get("last")
        total_pages = (data or {}).get("totalPages")
        if last is True:
            break
        if isinstance(total_pages, int) and page >= (total_pages - 1):
            break
        page += 1

        # safety: если API вдруг перестало отдавать пагинацию
        if page > 50:
            break

    return _dedup_keep_order([s.strip() for s in all_names if s and s.strip()])

# ---------- Алиасы: строим нормализованное сопоставление variant -> canonical ----------
def build_stream_norm2canonical(all_streams: List[str]) -> Dict[str, str]:
    """
    Собирает маппинг:
      norm(вариант/алиас/каноническое) -> каноническое_название_из_all_streams

    ВАЖНО:
    - каноническое значение стараемся брать строго из all_streams (как в Allure),
      чтобы не появлялись "лишние" названия, которых нет в каталоге.
    - если canonical из STREAM_ALIASES не найден в all_streams, но найден один из aliases,
      используем найденный вариант как "канонический" (из all_streams).
    """
    norm2orig = {_norm(s): s for s in all_streams}
    out: Dict[str, str] = dict(norm2orig)

    for canonical, aliases in STREAM_ALIASES.items():
        canonical_real: Optional[str] = None

        # 1) canonical явно есть в all_streams
        if _norm(canonical) in norm2orig:
            canonical_real = norm2orig[_norm(canonical)]
        else:
            # 2) или есть хотя бы один alias в all_streams — берём его как canonical_real
            for a in (aliases or []):
                if isinstance(a, str) and _norm(a) in norm2orig:
                    canonical_real = norm2orig[_norm(a)]
                    break

        # если ни canonical, ни aliases не найдены в all_streams — пропускаем (чтобы не создавать "левые" стримы)
        if not canonical_real:
            continue

        out[_norm(canonical_real)] = canonical_real
        for a in (aliases or []):
            if isinstance(a, str) and a.strip():
                out[_norm(a)] = canonical_real

    return out

# ---------- Google Drive: лиды QA ----------
_GDRIVE_ID_RE_1 = re.compile(r"/d/([^/]+)")
_GDRIVE_ID_RE_2 = re.compile(r"[?&]id=([^&]+)")

def _extract_gdrive_file_id(url: str) -> Optional[str]:
    url = (url or "").strip()
    m = _GDRIVE_ID_RE_1.search(url)
    if m:
        return m.group(1)
    m = _GDRIVE_ID_RE_2.search(url)
    if m:
        return m.group(1)
    return None

def _gdrive_download_url(view_url: str) -> Optional[str]:
    file_id = _extract_gdrive_file_id(view_url)
    if not file_id:
        return None
    # для небольших файлов чаще всего хватает этого URL без подтверждений
    return f"https://drive.google.com/uc?export=download&id={file_id}"

def fetch_qa_leads_json() -> Dict[str, List[str]]:
    """
    Ожидаемый формат файла:
      {
        "@handle": ["Stream A", "Stream B", ...],
        ...
      }
    """
    # 1) Пытаемся скачать по Google Drive ссылке
    dl = _gdrive_download_url(QA_LEADS_GDRIVE_VIEW_URL)
    if dl:
        try:
            r = requests.get(dl, timeout=REQ_TIMEOUT)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict):
                # приводим в Dict[str, List[str]]
                out: Dict[str, List[str]] = {}
                for k, v in data.items():
                    if not isinstance(k, str):
                        continue
                    if isinstance(v, list):
                        out[k.strip()] = [str(x).strip() for x in v if str(x).strip()]
                    else:
                        # если вдруг сделали строкой
                        s = str(v).strip()
                        out[k.strip()] = [s] if s else []
                return out
        except Exception as e:
            print(f"[WARN] Не удалось скачать лидов QA по ссылке Google Drive: {e}")

    # 2) Fallback: локальный файл рядом (опционально)
    try:
        with open(QA_LEADS_LOCAL_FALLBACK, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            out: Dict[str, List[str]] = {}
            for k, v in data.items():
                if not isinstance(k, str):
                    continue
                if isinstance(v, list):
                    out[k.strip()] = [str(x).strip() for x in v if str(x).strip()]
                else:
                    s = str(v).strip()
                    out[k.strip()] = [s] if s else []
            print(f"[INFO] Лиды QA загружены из локального файла: {QA_LEADS_LOCAL_FALLBACK}")
            return out
    except Exception:
        pass

    print("[WARN] Лиды QA не загружены (нет доступа к ссылке и нет локального fallback).")
    return {}

def build_lead_index(
    leads: Dict[str, List[str]],
    all_streams: List[str],
    stream_norm2canonical: Dict[str, str]
) -> Tuple[Dict[str, Set[str]], Set[str], Set[str]]:
    """
    Возвращает:
      - lead_by_stream_norm: norm(canonical_stream) -> { @lead1, @lead2, ... }
      - core_android_leads: leads для Core Android
      - core_ios_leads: leads для Core iOS
    """
    lead_by_stream_norm: Dict[str, Set[str]] = {}
    core_android: Set[str] = set()
    core_ios: Set[str] = set()

    for handle, streams in (leads or {}).items():
        if not isinstance(handle, str):
            continue
        h = handle.strip()
        if not h:
            continue
        if not h.startswith("@"):
            h = "@" + h

        for st in streams or []:
            s = (st or "").strip()
            if not s:
                continue

            ns = _norm(s)

            # отдельная логика для Core по платформам (как в JSON)
            if ns == _norm("Core Android"):
                core_android.add(h)
                continue
            if ns == _norm("Core iOS"):
                core_ios.add(h)
                continue

            canonical = stream_norm2canonical.get(ns, s)
            lead_by_stream_norm.setdefault(_norm(canonical), set()).add(h)

    return lead_by_stream_norm, core_android, core_ios

def leads_for_stream(
    stream_canonical: str,
    platform: str,
    lead_by_stream_norm: Dict[str, Set[str]],
    core_android: Set[str],
    core_ios: Set[str],
) -> List[str]:
    if _norm(stream_canonical) == _norm("Core"):
        chosen = core_android if platform == "Android" else core_ios
        return sorted(chosen)
    return sorted(lead_by_stream_norm.get(_norm(stream_canonical), set()))

# ---------- Band: получение сообщений ----------
def fetch_band_messages_since(since_ms: int) -> List[str]:
    url = BAND_SINCE_URL_TMPL.format(channel=BAND_CHANNEL, since_ms=since_ms)
    data = http_get_json(url, headers=band_headers_read())
    posts = []
    raw_posts = (data or {}).get("posts")
    if isinstance(raw_posts, dict):
        posts = list(raw_posts.values())
    messages: List[str] = []
    for p in posts:
        # игнорировать посты, у которых create_at < since_ms
        created = (p or {}).get("create_at")
        if isinstance(created, int) and created < since_ms:
            continue
        msg = (p or {}).get("message") or ""
        if isinstance(msg, str) and msg.strip():
            messages.append(msg)
    return messages


def band_create_post(message: str) -> None:
    """Публикует сообщение в канал Band (один пост)."""
    url = "https://band.wb.ru/api/v4/posts"
    headers = band_headers_post_json()
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    payload = {
        "file_ids": [],
        "message": message,
        "channel_id": BAND_CHANNEL_ID,
        "root_id": "",
        "pending_post_id": f"{BAND_POST_USER_ID}:{now_ms}",
        "user_id": BAND_POST_USER_ID,
        "create_at": 0,
        "metadata": {},
        "props": {},
        "update_at": now_ms,
        "reply_count": 0,
    }
    try:
        http_post_json(url, headers=headers, json_body=payload)
        print(f"[POST] Опубликовано: {message.splitlines()[0] if message else '...'}")
    except Exception as e:
        print(f"[ERR] Не удалось опубликовать пост в Band: {e}")

# ---------- Парсинг дежурных ----------
RE_BLOCK_QUOTED  = re.compile(r'Дежурн\w*\s*\"([^\"]+)\"([\s\S]*?)(?=Дежурн\w*\s*\"|$)', re.IGNORECASE)
# Разделители между платформой и @дежурным: ".", "-", "--", "- -", ":", "—", "–" и их комбинации.
_PLATFORM_TO_HANDLE_SEP = r'(?:\s*[-—:–.]+\s*)*'
RE_ANDROID       = re.compile(rf'\b(?:Android|andr)\b{_PLATFORM_TO_HANDLE_SEP}@([^\n\r,; ]+)', re.IGNORECASE)
RE_IOS           = re.compile(rf'\bios\b{_PLATFORM_TO_HANDLE_SEP}@([^\n\r,; ]+)', re.IGNORECASE)
RE_INLINE_FREE   = re.compile(rf'Дежурн\w*\s+([^\n\r"@]+?){_PLATFORM_TO_HANDLE_SEP}@([^\n\r,; ]+)', re.IGNORECASE)
RE_BLOCK_OT      = re.compile(r'Дежурн\w*\s+от\s+([^\n\r"]+)\s*([\s\S]*?)(?=Дежурн\w*|$)', re.IGNORECASE)
RE_BLOCK_HEADER  = re.compile(r'Дежурн\w*\s+(?!от\b)([^\n\r"@]+?)\s*[\r\n]+([\s\S]*?)(?=Дежурн\w*|$)', re.IGNORECASE)

def _match_stream(raw: str, stream_norm2canonical: Dict[str, str]) -> Optional[str]:
    key_norm = _norm(raw)
    if key_norm in stream_norm2canonical:
        return stream_norm2canonical[key_norm]

    # fallback: пробуем contains-матч по всем вариантам/алиасам
    for nrm, canonical in stream_norm2canonical.items():
        if nrm and nrm in key_norm:
            return canonical
    return None

def parse_duties(messages: List[str], all_streams: List[str]) -> Dict[str, Dict[str, Optional[str]]]:
    duties: Dict[str, Dict[str, Optional[str]]] = {}
    stream_norm2canonical = build_stream_norm2canonical(all_streams)

    for msg in messages:
        for m in RE_BLOCK_QUOTED.finditer(msg):
            s_name_raw = (m.group(1) or "").strip()
            body = m.group(2) or ""
            stream_name = _match_stream(s_name_raw, stream_norm2canonical)
            if not stream_name:
                continue
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma: row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi: row["iOS"]     = "@" + mi.group(1).strip().lstrip("@")

    for msg in messages:
        for m in RE_BLOCK_OT.finditer(msg):
            s_name_raw = (m.group(1) or "").strip()
            body = m.group(2) or ""
            stream_name = _match_stream(s_name_raw, stream_norm2canonical)
            if not stream_name:
                continue
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"): row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi and not row.get("iOS"):     row["iOS"]     = "@" + mi.group(1).strip().lstrip("@")

    for msg in messages:
        for m in RE_BLOCK_HEADER.finditer(msg):
            header = (m.group(1) or "").strip()
            body   = (m.group(2) or "")
            stream_name = _match_stream(header, stream_norm2canonical)
            if not stream_name:
                continue
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"): row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi and not row.get("iOS"):     row["iOS"]     = "@" + mi.group(1).strip().lstrip("@")

    for msg in messages:
        for m in RE_INLINE_FREE.finditer(msg):
            raw_name = " ".join((m.group(1) or "").split())
            person = "@" + (m.group(2) or "").strip().lstrip("@")
            tokens = raw_name.split()
            platform = None
            base_stream = raw_name
            if tokens:
                last = tokens[-1].casefold()
                if last in ("android", "andr", "ios"):
                    platform = "Android" if last in ("android", "andr") else "iOS"
                    base_stream = " ".join(tokens[:-1]).strip()

            stream_name = _match_stream(base_stream, stream_norm2canonical) or base_stream
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})

            if platform:
                row[platform] = person

    return duties

# ---------- Утилита отображения имени ----------
_FINTECH_PREFIX_RE = re.compile(r'^\[Финтех\]\s*', re.IGNORECASE)
def display_stream_name(s: str) -> str:
    return _FINTECH_PREFIX_RE.sub("", s).strip()

# ---------- Печать результата ----------
def print_result(duties: Dict[str, Dict[str, Optional[str]]], all_streams: List[str]) -> None:
    streams_to_show = [s for s in all_streams if s.casefold() not in EXCLUDE_STREAMS]
    if not streams_to_show:
        print("\n[ИТОГ] Нет стримов для вывода после применения исключений.")
        return

    print("\nAndroid")
    for s in streams_to_show:
        val = (duties.get(s, {}) or {}).get("Android") or "- ?"
        print(f"{display_stream_name(s)}: {val}")

    print("\niOS")
    for s in streams_to_show:
        val = (duties.get(s, {}) or {}).get("iOS") or "- ?"
        print(f"{display_stream_name(s)}: {val}")

# ---------- Управление тег-группами ----------
def extract_handles(duties: Dict[str, Dict[str, Optional[str]]]) -> Tuple[Set[str], Set[str]]:
    android: Set[str] = set()
    ios: Set[str] = set()
    for v in duties.values():
        a = v.get("Android")
        i = v.get("iOS")
        if isinstance(a, str) and a.startswith("@"): android.add(a)
        if isinstance(i, str) and i.startswith("@"): ios.add(i)
    return android, ios

def band_search_user_ids(handles: Set[str]) -> Dict[str, str]:
    """По @логинам ищем user_id в Band через /api/v4/users/search."""
    if not handles:
        return {}
    url = "https://band.wb.ru/api/v4/users/search"
    headers = band_headers_search_json()
    result: Dict[str, str] = {}
    for handle in handles:
        body = {"term": handle, "team_id": ""}
        try:
            data = http_post_json(url, headers, body)
            if isinstance(data, list):
                wanted = handle.lstrip("@")
                uid = None
                for u in data:
                    if (u or {}).get("username") == wanted:
                        uid = (u or {}).get("id")
                        break
                if not uid and data:
                    uid = (data[0] or {}).get("id")
                if uid:
                    result[handle] = uid
                else:
                    print(f"[WARN] Не найден id для {handle}")
            else:
                print(f"[WARN] Неожиданный ответ поиска для {handle}: {str(data)[:200]}")
        except Exception as e:
            print(f"[ERR] Поиск id для {handle} провалился: {e}")
    return result

def band_get_group_user_ids(group_id: str) -> List[str]:
    """Возвращает список user_id, состоящих в группе."""
    # per_page=200 — потолок (важно)
    url = f"https://band.wb.ru/api/v4/users?in_group={group_id}&page=0&per_page=200&sort="
    headers = band_headers_admin_getlist()
    try:
        data = http_get_json(url, headers=headers)
        ids: List[str] = []
        if isinstance(data, list):
            for u in data:
                uid = (u or {}).get("id")
                if isinstance(uid, str):
                    ids.append(uid)
        return ids
    except Exception as e:
        print(f"[ERR] Получение текущих участников группы {group_id} провалилось: {e}")
        return []

def band_delete_group_members_bulk(group_id: str, user_ids: List[str]) -> None:
    """Удаляет список пользователей одним DELETE на /groups/{group_id}/members с JSON {"user_ids":[...] }."""
    if not user_ids:
        print(f"[DEL] В группе {group_id} некого удалять.")
        return
    url = f"https://band.wb.ru/api/v4/groups/{group_id}/members"
    headers = band_headers_admin_json()
    body = {"user_ids": user_ids}
    try:
        http_delete_json(url, headers, body)
        print(f"[DEL] Удалено {len(user_ids)} пользователей из {group_id}")
    except Exception as e:
        print(f"[ERR] Массовое удаление из {group_id} провалилось: {e}")

def band_add_group_members(group_id: str, user_ids: List[str]) -> None:
    """Добавляет список пользователей одним POST."""
    if not user_ids:
        print(f"[ADD] Нет новых пользователей для добавления в {group_id}")
        return
    url = f"https://band.wb.ru/api/v4/groups/{group_id}/members"
    headers = band_headers_admin_json()
    body = {"user_ids": user_ids}
    try:
        http_post_json(url, headers, body)
        print(f"[ADD] Добавлено {len(user_ids)} пользователей в {group_id}")
    except Exception as e:
        print(f"[ERR] Добавление пользователей в {group_id} провалилось: {e}")

# ---------- ИЗМЕНЕНО: пинг лидов (лиды берём из JSON по ссылке) ----------
def build_ping_request_message_for_missing(
    duties: Dict[str, Dict[str, Optional[str]]],
    all_streams: List[str],
    lead_by_stream_norm: Dict[str, Set[str]],
    core_android_leads: Set[str],
    core_ios_leads: Set[str],
) -> str:
    streams_to_show = [s for s in all_streams if s.casefold() not in EXCLUDE_STREAMS]

    missing_lines: List[str] = []
    for s in streams_to_show:
        a = (duties.get(s, {}) or {}).get("Android")
        i = (duties.get(s, {}) or {}).get("iOS")
        if a and i:
            continue  # дежурные найдены по обеим платформам

        disp = display_stream_name(s)

        leads_ordered: List[str] = []
        if not i:
            leads_ordered.extend(leads_for_stream(s, "iOS", lead_by_stream_norm, core_android_leads, core_ios_leads))
        if not a:
            for h in leads_for_stream(s, "Android", lead_by_stream_norm, core_android_leads, core_ios_leads):
                if h not in leads_ordered:
                    leads_ordered.append(h)

        lead_str = " ".join(leads_ordered)
        missing_lines.append(f"{disp} - {lead_str}".rstrip())

    if not missing_lines:
        return ""

    header = (
        "Привет, просьба указать дежурных на ближайший релиз отдельным тредом по шаблону\n"
        "Дежурный \"Название_стрима\"\n"
        "iOS - @дежурный\n"
        "Android - @дежурный\n"
    )
    footer = "\n\nЕсли дежурных будет лид, тред создадим сами, можно самостоятельно его не присылать"
    return header + "\n" + "\n".join(missing_lines) + footer

def print_ping_requests_for_missing(
    duties: Dict[str, Dict[str, Optional[str]]],
    all_streams: List[str],
    lead_by_stream_norm: Dict[str, Set[str]],
    core_android_leads: Set[str],
    core_ios_leads: Set[str],
) -> None:
    ping_message = build_ping_request_message_for_missing(
        duties,
        all_streams,
        lead_by_stream_norm,
        core_android_leads,
        core_ios_leads,
    )
    if ping_message:
        print("\n[ТЕКСТ ДЛЯ КОПИРОВАНИЯ — пинг лидов по стримам, где не найден дежурный]")
        print("\n" + ping_message)
    else:
        print("\n[ПИНГ ЛИДОВ] Все стримы заполнены, пингов не требуется.")

# ---------- main ----------
def main():
    # 0) API токен Allure TestOps (ничего не спрашиваем)
    api_token = ALLURE_API_TOKEN.strip()

    # 1) База времени
    msk = ZoneInfo("Europe/Moscow")
    now_msk = datetime.now(msk)
    days_back = (now_msk.weekday() - 2) % 7
    base_msk = (now_msk - timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)
    base_utc = base_msk.astimezone(timezone.utc)
    since_ms = int(base_utc.timestamp() * 1000)
    print("[ЛОГ] База выборки сообщений:")
    print(f"  MSK: {base_msk.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"  UTC: {base_utc.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"  since (ms): {since_ms}")
    print("  script: v9.2")

    # 2) Справочник стримов из TestPlan
    print("\n[Шаг 1/4] Загружаю список стримов из Allure TestPlan...")
    try:
        streams = fetch_stream_catalog_from_testplan_leaf(ALLURE_TESTPLAN_LEAF_URL, api_token)
        streams = [s.strip() for s in streams if s and s.strip()]
        print(f"[OK] Получено стримов: {len(streams)}")
    except Exception as e:
        print(f"[ERR] Не удалось получить список стримов из TestPlan: {e}")
        print("[HINT] Пробую fallback: прочитать ответ из pasted.txt (если файл лежит рядом со скриптом).")
        try:
            with open("pasted.txt", "r", encoding="utf-8") as f:
                data = json.load(f)
            streams = parse_streams_from_testplan_leaf_json(data)
            streams = [s.strip() for s in streams if s and s.strip()]
            if not streams:
                raise RuntimeError("pasted.txt прочитан, но список стримов пуст")
            print(f"[OK] Fallback из pasted.txt: стримов={len(streams)}")
        except Exception as e2:
            print(f"[ERR] Fallback из pasted.txt тоже не сработал: {e2}")
            return

    # 3) Лиды QA
    print("\n[Шаг 2/4] Загружаю лидов QA из JSON по ссылке Google Drive...")
    leads_raw = fetch_qa_leads_json()
    stream_norm2canonical = build_stream_norm2canonical(streams)
    lead_by_stream_norm, core_android_leads, core_ios_leads = build_lead_index(leads_raw, streams, stream_norm2canonical)
    print(f"[OK] Лиды QA: всего ключей={len(leads_raw)}, привязок к стримам={sum(len(v) for v in lead_by_stream_norm.values())}")

    # 4) Сообщения из Band
    print("\n[Шаг 3/4] Загружаю сообщения из Band...")
    msgs = fetch_band_messages_since(since_ms)
    print(f"[OK] Получено сообщений: {len(msgs)}")

    # 5) Парсинг дежурных
    print("\n[Шаг 4/4] Парсю дежурных...")
    duties = parse_duties(msgs, streams)
    print_result(duties, streams)

    # ---- Форматированный пинг лидов по пустым стримам ----
    print_ping_requests_for_missing(duties, streams, lead_by_stream_norm, core_android_leads, core_ios_leads)

    # ---- Шаг 1: опубликовать в чат просьбу указать дежурных (одним сообщением) ----
    ping_message = build_ping_request_message_for_missing(
        duties,
        streams,
        lead_by_stream_norm,
        core_android_leads,
        core_ios_leads,
    )
    if ping_message:
        did_publish_ping = False
        ans1 = input("\n[Шаг 1] Опубликовать в чат просьбу указать дежурных? 1 - Да, 2 - Нет: ").strip()
        if ans1 == "1":
            band_create_post(ping_message)
            did_publish_ping = True
        else:
            print("[Шаг 1] Пропущено по запросу пользователя.")
    else:
        did_publish_ping = False
        print("\n[Шаг 1] Публикация запроса не требуется: все дежурные найдены.")

    # ---- Шаг 2: опубликовать недостающих дежурных в чат (только если есть пропуски) ----
    streams_to_show = [s for s in streams if s.casefold() not in EXCLUDE_STREAMS]
    missing_streams: List[str] = []
    for s in streams_to_show:
        row = (duties.get(s, {}) or {})
        if not row.get("Android") or not row.get("iOS"):
            missing_streams.append(s)
    did_publish_missing = False
    if missing_streams:
        ans2 = input("\n[Шаг 2] Опубликовать в чат недостающих дежурных? 1 - Да, 2 - Нет: ").strip()
        if ans2 == "1":
            for s in missing_streams:
                row = (duties.get(s, {}) or {})
                ios_val = row.get("iOS")
                android_val = row.get("Android")

                if not ios_val:
                    ios_leads = leads_for_stream(s, "iOS", lead_by_stream_norm, core_android_leads, core_ios_leads)
                    ios_val = " ".join(ios_leads) if ios_leads else "- ?"
                if not android_val:
                    android_leads = leads_for_stream(s, "Android", lead_by_stream_norm, core_android_leads, core_ios_leads)
                    android_val = " ".join(android_leads) if android_leads else "- ?"

                msg = f'Дежурный "{display_stream_name(s)}" \niOS - {ios_val}\nAndroid - {android_val}'
                band_create_post(msg)
            did_publish_missing = True
        else:
            print("[Шаг 2] Пропущено по запросу пользователя.")

    # После публикации в чат перечитываем сообщения, чтобы продолжить скрипт на актуальном списке.
    if did_publish_ping or did_publish_missing:
        try:
            input("\n[Шаг 2] После ответов в чате нажмите Enter — обновлю список дежурных: ")
        except Exception:
            pass
        print("[Шаг 2] Обновляю сообщения из Band...")
        msgs = fetch_band_messages_since(since_ms)
        print(f"[OK] Получено сообщений: {len(msgs)}")
        duties = parse_duties(msgs, streams)
        print_result(duties, streams)
        print_ping_requests_for_missing(duties, streams, lead_by_stream_norm, core_android_leads, core_ios_leads)

    # === Управление тег-группами ===
    android_handles, ios_handles = extract_handles(duties)
    print("\n[ИНФО] Кандидаты в группы:")
    print("  Android:", ", ".join(sorted(android_handles)) if android_handles else "-")
    print("  iOS    :", ", ".join(sorted(ios_handles)) if ios_handles else "-")

    # Шаг A — запросить id новых дежурных?
    ans = input("\nЗапросить id новых дежурных? 1 - да, 2 - нет: ").strip()
    android_new_ids: Dict[str, str] = {}
    ios_new_ids: Dict[str, str] = {}
    if ans == "1":
        if android_handles:
            print("[ID] Ищу user_id для Android-кандидатов...")
            android_new_ids = band_search_user_ids(android_handles)
            print(f"[ID] Найдено для Android: {len(android_new_ids)}")
        if ios_handles:
            print("[ID] Ищу user_id для iOS-кандидатов...")
            ios_new_ids = band_search_user_ids(ios_handles)
            print(f"[ID] Найдено для iOS: {len(ios_new_ids)}")
    else:
        print("[ID] Пропущено по запросу пользователя.")

    # Шаг B — удалить старых дежурных?
    ans = input("\nУдалить старых дежурных? 1 - да, 2 - нет: ").strip()
    if ans == "1":
        print("[DEL] Получаю текущих участников Android-группы...")
        cur_android = band_get_group_user_ids(GROUP_ANDROID)
        print(f"[DEL] В Android-группе сейчас: {len(cur_android)}")
        band_delete_group_members_bulk(GROUP_ANDROID, cur_android)

        print("[DEL] Получаю текущих участников iOS-группы...")
        cur_ios = band_get_group_user_ids(GROUP_IOS)
        print(f"[DEL] В iOS-группе сейчас: {len(cur_ios)}")
        band_delete_group_members_bulk(GROUP_IOS, cur_ios)
    else:
        print("[DEL] Пропущено по запросу пользователя.")

    # Шаг C — добавить новых дежурных?
    ans = input("\nДобавить новых дежурных? 1 - да, 2 - нет: ").strip()
    if ans == "1":
        android_ids_list = list(android_new_ids.values())
        ios_ids_list = list(ios_new_ids.values())
        print(f"[ADD] К добавлению в Android: {len(android_ids_list)}")
        band_add_group_members(GROUP_ANDROID, android_ids_list)

        print(f"[ADD] К добавлению в iOS: {len(ios_ids_list)}")
        band_add_group_members(GROUP_IOS, ios_ids_list)
        print("\n[ГОТОВО] Обновление тег-групп завершено.")
    else:
        print("[ADD] Пропущено по запросу пользователя.")

    try:
        input("\n[ГОТОВО] Нажмите Enter для выхода...")
    except Exception:
        pass

if __name__ == "__main__":
    main()
