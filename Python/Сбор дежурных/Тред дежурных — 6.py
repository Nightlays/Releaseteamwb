#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Динамическое формирование текста-треда по дежурным:
- Список стримов берём из Allure (без хардкод-списков).
- Группировки/порядок вывода берём из Google Doc (JSON внутри документа).
- Ключ JSON = название группировки, значение-массив = стримы в этой группировке (порядок сохраняется).
- Спец-ключ "Excluded" (массив) = стримы, которые НЕ нужно показывать вообще.
- Всё, что не попало в значения из документа (и не в Excluded) — выводим без группировки в самом конце.
- Для ссылок на треды: сначала точное совпадение, затем "мягкое" (игнор пунктуации/пробелов) сопоставление.
"""

import re
import json
import subprocess
import sys
from typing import Dict, List, Optional
from datetime import datetime, timedelta, timezone

# --- автодоставка зависимостей ---
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

_ensure(["requests"])
try:
    from zoneinfo import ZoneInfo
except Exception:
    _ensure(["backports.zoneinfo"])
    from backports.zoneinfo import ZoneInfo  # type: ignore

import requests

# === КОНСТАНТЫ (из исходного файла) ===
ALLURE_TESTCASE_URL = "https://allure-testops.wb.ru/api/testcase/47356/overview"

ALLURE_TESTPLAN_LEAF_URL = "https://allure-testops.wb.ru/api/testplan/3918/tree/leaf?treeId=987&projectId=7&path=7904&sort=name%2Casc&size=100"
ALLURE_API_TOKEN = "c60f6235-440d-4657-983a-51dc71c53cf2"

BAND_CHANNEL = "6sqki85urpbfbqdkcdfen33owh"
BAND_SINCE_URL_TMPL = ("https://band.wb.ru/api/v4/channels/{channel}/posts"
                       "?since={since_ms}&skipFetchThreads=false&collapsedThreads=true&collapsedThreadsExtended=false")

# Куки/CSRF для чтения
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

REQ_TIMEOUT = 30
BAND_THREAD_URL_TMPL = "https://band.wb.ru/mobile-team/pl/{post_id}"

# === Google Doc с JSON-группировками ===
GROUPING_DOC_URL = "https://docs.google.com/document/d/1glaEFkdpAzGuRyQZYz1muBzVkFOnKyn85BW-CXLFSFU/edit?usp=sharing"

# === HTTP ===
def http_get_json(url: str, headers: dict, params: dict = None) -> dict:
    r = requests.get(url, headers=headers, params=params, timeout=REQ_TIMEOUT)
    r.raise_for_status()
    return r.json()

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

# === Время: прошлый четверг 00:00:00 МСК (поведение как было) ===
def last_thursday_midnight_msk() -> int:
    msk = ZoneInfo("Europe/Moscow")
    now_msk = datetime.now(msk)
    days_back = (now_msk.weekday() - 2) % 7
    base_msk = (now_msk - timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)
    base_utc = base_msk.astimezone(timezone.utc)
    return int(base_utc.timestamp() * 1000)

# === Нормализации ===
def _norm(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()

def _loose_norm(s: str) -> str:
    # убираем пунктуацию/пробелы/подчёркивания, оставляем "слова и цифры"
    return re.sub(r'[\W_]+', '', (s or "").casefold(), flags=re.UNICODE)

# === Google Doc: достаём JSON из документа ===
def _gdoc_id_from_url(url: str) -> str:
    m = re.search(r"/document/d/([a-zA-Z0-9\-_]+)", url)
    if not m:
        raise ValueError("Не смог извлечь documentId из ссылки Google Doc.")
    return m.group(1)

def _extract_first_json_object(text: str) -> str:
    starts = [m.start() for m in re.finditer(r"\{", text)]
    for start in starts:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            else:
                if ch == '"':
                    in_str = True
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start:i + 1]
    raise ValueError("Не смог найти JSON-объект в тексте Google Doc.")

def fetch_grouping_from_gdoc(doc_url: str) -> Dict[str, List[str]]:
    doc_id = _gdoc_id_from_url(doc_url)
    export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    r = requests.get(export_url, timeout=REQ_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    raw = r.text or ""
    json_str = _extract_first_json_object(raw)
    data = json.loads(json_str)

    if not isinstance(data, dict):
        raise ValueError("JSON в документе должен быть объектом (словарём).")

    out: Dict[str, List[str]] = {}
    for k, v in data.items():
        if not isinstance(k, str):
            continue
        if isinstance(v, list):
            items = []
            for x in v:
                if isinstance(x, str):
                    s = x.strip()
                    if s:
                        items.append(s)
            out[k.strip()] = items
    return out

# === Allure: список стримов ===
def fetch_streams_from_allure() -> List[str]:
    """
    Список стримов берём из TestPlan tree/leaf.
    Берём поле content[].name, как в примере ответа.
    Авторизация — только Api-Token.
    """
    headers = {
        "accept": "application/json",
        "authorization": f"Api-Token {ALLURE_API_TOKEN}",
        "user-agent": "Mozilla/5.0",
    }

    def with_page(url: str, page: int) -> str:
        if "page=" in url:
            return re.sub(r'([?&]page=)\d+', r'\g<1>' + str(page), url)
        join = "&" if "?" in url else "?"
        return f"{url}{join}page={page}"

    out: List[str] = []
    page = 0
    while True:
        url = with_page(ALLURE_TESTPLAN_LEAF_URL, page)
        data = http_get_json(url, headers=headers)

        for item in (data or {}).get("content", []) or []:
            nm = (item or {}).get("name")
            if isinstance(nm, str):
                nm = nm.strip()
                if nm:
                    out.append(nm)

        # Пагинация (если присутствует в ответе)
        if (data or {}).get("last") is True:
            break
        total_pages = (data or {}).get("totalPages")
        if isinstance(total_pages, int) and page >= (total_pages - 1):
            break

        # если пагинации нет — один проход и выходим
        if "last" not in (data or {}) and "totalPages" not in (data or {}):
            break

        page += 1
        if page > 50:
            break

    # уникализация
    seen = set()
    uniq: List[str] = []
    for s in out:
        if s not in seen:
            uniq.append(s)
            seen.add(s)
    return uniq


# === Band: посты (id + message) с прошлого четверга ===
def fetch_band_posts_since(since_ms: int) -> List[dict]:
    url = BAND_SINCE_URL_TMPL.format(channel=BAND_CHANNEL, since_ms=since_ms)
    data = http_get_json(url, headers=band_headers_read())
    posts = []
    raw_posts = (data or {}).get("posts")
    if isinstance(raw_posts, dict):
        posts = list(raw_posts.values())
    filtered = []
    for p in posts:
        created = (p or {}).get("create_at")
        msg = (p or {}).get("message") or ""
        if not isinstance(created, int) or created < since_ms:
            continue
        if isinstance(msg, str) and msg.strip():
            filtered.append(p)
    filtered.sort(key=lambda x: x.get("create_at", 0))
    return filtered

# === Парсинг дежурных ===
RE_BLOCK_QUOTED  = re.compile(r'Дежурн\w*\s*\"([^\"]+)\"([\s\S]*?)(?=Дежурн\w*\s*\"|$)', re.IGNORECASE)
RE_ANDROID       = re.compile(r'\b(?:Android|andr)\b\s*[-—:–]*\s*@([^\n\r,; ]+)', re.IGNORECASE)
RE_IOS           = re.compile(r'\bios\b\s*[-—:–]*\s*@([^\n\r,; ]+)', re.IGNORECASE)
RE_INLINE_FREE   = re.compile(r'Дежурн\w*\s+([^\n\r"@]+?)\s*[-—:–]?\s*@([^\n\r,; ]+)', re.IGNORECASE)
RE_BLOCK_OT      = re.compile(r'Дежурн\w*\s+от\s+([^\n\r"]+)\s*([\s\S]*?)(?=Дежурн\w*|$)', re.IGNORECASE)
RE_BLOCK_HEADER  = re.compile(r'Дежурн\w*\s+(?!от\b)([^\n\r"@]+?)\s*[\r\n]+([\s\S]*?)(?=Дежурн\w*|$)', re.IGNORECASE)

def parse_duties_from_posts(posts: List[dict], catalog_streams: List[str]) -> Dict[str, Dict[str, Optional[str]]]:
    duties: Dict[str, Dict[str, Optional[str]]] = {}
    norm2orig = {_norm(s): s for s in catalog_streams}

    def ensure_entry(stream_name: str) -> Dict[str, Optional[str]]:
        row = duties.get(stream_name)
        if not row:
            row = {
                "Android": None,
                "iOS": None,
                "_meta": {"post_id": None, "Android_post_id": None, "iOS_post_id": None, "create_at": -1}
            }
            duties[stream_name] = row
        return row

    def touch_post_meta(row: dict, post_id: str, created: int):
        meta = row["_meta"]
        if created >= (meta.get("create_at") or -1):
            meta["create_at"] = created
            meta["post_id"] = post_id

    for p in posts:
        pid = (p or {}).get("id")
        created = (p or {}).get("create_at") or 0
        msg = (p or {}).get("message") or ""
        if not isinstance(msg, str):
            continue

        # Дежурный "Стрим"
        for m in RE_BLOCK_QUOTED.finditer(msg):
            s_name_raw = m.group(1).strip()
            body = m.group(2) or ""
            key_norm = _norm(s_name_raw)
            if key_norm not in norm2orig:
                continue
            stream_name = norm2orig[key_norm]
            row = ensure_entry(stream_name)
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma:
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
                row["_meta"]["Android_post_id"] = pid
            if mi:
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")
                row["_meta"]["iOS_post_id"] = pid
            if pid:
                touch_post_meta(row, pid, created)

        # Дежурный от <стрим>
        for m in RE_BLOCK_OT.finditer(msg):
            s_name_raw = m.group(1).strip()
            body = m.group(2) or ""
            key_norm = _norm(s_name_raw)
            if key_norm not in norm2orig:
                continue
            stream_name = norm2orig[key_norm]
            row = ensure_entry(stream_name)
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"):
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
                row["_meta"]["Android_post_id"] = pid
            if mi and not row.get("iOS"):
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")
                row["_meta"]["iOS_post_id"] = pid
            if pid:
                touch_post_meta(row, pid, created)

        # Дежурный <заголовок>
        for m in RE_BLOCK_HEADER.finditer(msg):
            header = (m.group(1) or "").strip()
            body = (m.group(2) or "")
            key_norm = _norm(header)
            stream_name = None
            if key_norm in norm2orig:
                stream_name = norm2orig[key_norm]
            else:
                for nrm, orig in norm2orig.items():
                    if nrm and nrm in key_norm:
                        stream_name = orig
                        break
            if not stream_name:
                continue
            row = ensure_entry(stream_name)
            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"):
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
                row["_meta"]["Android_post_id"] = pid
            if mi and not row.get("iOS"):
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")
                row["_meta"]["iOS_post_id"] = pid
            if pid:
                touch_post_meta(row, pid, created)

        # Инлайн
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
            key_norm = _norm(base_stream)
            stream_name = norm2orig.get(key_norm)
            if not stream_name:
                continue
            row = ensure_entry(stream_name)
            if platform:
                row[platform] = person
                row["_meta"][f"{platform}_post_id"] = pid
            if pid:
                touch_post_meta(row, pid, created)

    return duties

# === Формирование текста (по Google Doc) ===
def _link(pid: Optional[str]) -> Optional[str]:
    return BAND_THREAD_URL_TMPL.format(post_id=pid) if pid else None

def _bullet(display: str, url: Optional[str], indent: int = 0) -> str:
    tail = f"[тред]({url})" if url else "тред"
    return f"{'    ' * indent}*   {display} - {tail}"

def build_copy_text(duties: Dict[str, Dict], streams: List[str], grouping: Dict[str, List[str]]) -> str:
    # Excluded (не показываем вообще)
    excluded_items = (grouping or {}).get("Excluded") or []
    excluded_norm = {_norm(x) for x in excluded_items if isinstance(x, str) and x.strip()}
    excluded_loose = {_loose_norm(x) for x in excluded_items if isinstance(x, str) and x.strip()}

    def is_excluded(name: str) -> bool:
        return (_norm(name) in excluded_norm) or (_loose_norm(name) in excluded_loose)

    # фильтруем входные стримы на всякий случай
    streams = [s for s in (streams or []) if not is_excluded(s)]

    # маппинги Allure-стримов
    by_norm = {_norm(s): s for s in streams}
    by_loose = {}
    for s in streams:
        ln = _loose_norm(s)
        if ln and ln not in by_loose:
            by_loose[ln] = s

    def resolve_stream_name(display_or_name: str) -> Optional[str]:
        # точное (по нормализованным пробелам/регистру)
        hit = by_norm.get(_norm(display_or_name))
        if hit:
            return hit
        # мягкое (игнор пунктуации/точек/пробелов)
        return by_loose.get(_loose_norm(display_or_name))

    def duty_url_by_stream(stream_name: str, platform: Optional[str] = None) -> Optional[str]:
        meta = (duties.get(stream_name, {}) or {}).get("_meta", {}) or {}
        pid = meta.get(f"{platform}_post_id") if platform else meta.get("post_id")
        if not pid and platform:
            pid = meta.get("post_id")
        return _link(pid)

    lines: List[str] = []
    covered_allure_norms = set()

    # группы как в документе (кроме Excluded)
    first_group = True
    for group_name, items in (grouping or {}).items():
        if not isinstance(group_name, str):
            continue
        if group_name == "Excluded":
            continue

        if not first_group:
            lines.append("")
        first_group = False

        lines.append(f"*   {group_name}:")
        for item in items or []:
            if not isinstance(item, str) or not item.strip():
                continue
            if is_excluded(item):
                continue

            disp = item
            item_n = _norm(item)

            # special: если в группе лежит Android/iOS — это платформы для стрима с именем группы (если такой стрим реально есть)
            if item_n in ("android", "ios"):
                base_stream = resolve_stream_name(group_name)
                if base_stream and not is_excluded(base_stream):
                    platform = "Android" if item_n == "android" else "iOS"
                    covered_allure_norms.add(_norm(base_stream))
                    lines.append(_bullet(disp, duty_url_by_stream(base_stream, platform=platform), indent=1))
                    continue

            stream_name = resolve_stream_name(item)
            if stream_name and not is_excluded(stream_name):
                covered_allure_norms.add(_norm(stream_name))
                lines.append(_bullet(disp, duty_url_by_stream(stream_name), indent=1))
            else:
                lines.append(_bullet(disp, None, indent=1))

    # все остальные стримы из Allure — в конце без группировки (и не Excluded)
    leftovers = [s for s in streams if _norm(s) not in covered_allure_norms and not is_excluded(s)]
    if leftovers:
        if lines:
            lines.append("")
        for s in leftovers:
            lines.append(_bullet(s, duty_url_by_stream(s)))

    if not lines:
        lines.append("Нет данных для формирования треда (не найдены стримы в Allure или посты с дежурными в Band).")

    return "\n".join(lines)

# === main ===
def main():
    since_ms = last_thursday_midnight_msk()
    print(f"[ЛОГ] since (UTC, ms): {since_ms}")

    print("[Шаг 0/4] Читаю группировки из Google Doc...")
    try:
        grouping = fetch_grouping_from_gdoc(GROUPING_DOC_URL)
        items_cnt = sum(len(v) for v in grouping.values())
        print(f"[OK] Групп: {len(grouping)}; элементов: {items_cnt}")
    except Exception as e:
        print(f"[WARN] Не смог прочитать/распарсить Google Doc JSON: {e}")
        grouping = {}

    print("[Шаг 1/4] Получаю стримы из Allure...")
    streams = fetch_streams_from_allure()
    print(f"[OK] Стримов: {len(streams)}")

    # применяем Excluded сразу (чтобы дальше не парсить дежурных по ним)
    excluded_items = (grouping or {}).get("Excluded") or []
    excluded_norm = {_norm(x) for x in excluded_items if isinstance(x, str) and x.strip()}
    excluded_loose = {_loose_norm(x) for x in excluded_items if isinstance(x, str) and x.strip()}
    if excluded_norm or excluded_loose:
        streams = [s for s in streams if (_norm(s) not in excluded_norm and _loose_norm(s) not in excluded_loose)]

    print("[Шаг 2/4] Читаю посты из Band...")
    posts = fetch_band_posts_since(since_ms)
    print(f"[OK] Постов: {len(posts)}")

    print("[Шаг 3/4] Парсю дежурных...")
    duties = parse_duties_from_posts(posts, streams)

    print("[Шаг 4/4] Формирую текст...")
    text = build_copy_text(duties, streams, grouping)

    print("\n[ТЕКСТ ДЛЯ КОПИРОВАНИЯ]")
    print(text)

    try:
        input("\nНажмите Enter для выхода...")
    except Exception:
        pass

if __name__ == "__main__":
    main()
