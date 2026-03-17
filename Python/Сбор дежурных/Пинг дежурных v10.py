#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import base64
import datetime as dt
import json
import re
import time
from typing import Dict, List, Optional, Set, Tuple

try:
    import requests
except Exception:
    import subprocess, sys

    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--upgrade", "requests"]
    )
    import requests

from zoneinfo import ZoneInfo


# =============================================================================
# !!! СЕКРЕТЫ (ХАРДКОД) — ЗАПОЛНИ СВОИ ПЕРЕД ЗАПУСКОМ !!!
# =============================================================================
ALLURE_BASE = "https://allure-testops.wb.ru"
ALLURE_API_TOKEN = "c60f6235-440d-4657-983a-51dc71c53cf2"
ALLURE_PROJECT_ID = 7

ALLURE_COOKIES = (
    "wbx-validation-key=a76e621e-73ec-4b6b-9b9e-30990b4e513a; "
    "_ym_uid=1752585402912787992; _ym_d=1752585402; "
    "_ga=GA1.1.1440317972.1752585406; "
    "_ga_NM1B0HQXGM=GS2.1.s1753787654$o2$g1$t1753788555$j60$l0$h0; "
    "ALLURE_TESTOPS_SESSION=YzQyNGE3YzctZDlhNS00MzI4LWIyZjAtY2U3NTA3ZTVjZDcw; "
    "XSRF-TOKEN=c730361d-2cb6-4ccd-a2d9-af694e5520aa; "
    "ALLURE_TEST_OPS_USER_ID=6692"
)
ALLURE_XSRF = "c730361d-2cb6-4ccd-a2d9-af694e5520aa"

BAND_BASE = "https://band.wb.ru/api/v4"
BAND_COOKIES = (
    "wbx-validation-key=c71f4017-d14e-4ac8-81c1-c6aa63436d9c; "
    "MMAUTHTOKEN=bdxpamsi6p8etb879eo8eqf4fc; "
    "MMUSERID=nibrb4qs8ty4zp61x1pgyeziqe; "
    "MMCSRF=thho59busin1bpcjtsu5ubfpew"
)
SWAT_QA = "6sqki85urpbfbqdkcdfen33owh" 
RELEASE_CHANNEL = "tdj9ns46eprx8n5neupw8ejw9c"

# Allure Testplan (для получения списка стримов)
ALLURE_TESTPLAN_ID = 3918
ALLURE_TESTPLAN_TREE_ID = 987
ALLURE_TESTPLAN_PATH = 7904

# Стримы, которые нужно игнорировать
EXCLUDED_STREAMS = {
    "WBA Автоматизаторы аналитики",
    "Релизный стрим (мигра, вшитки)",
    "Релизный стрим (мигра, вшитки,сват)",
    "Релизный стрим (мигра, вшитки, сват)",
}

REQ_TIMEOUT = 30
POLL_SECONDS = 5  # опрос треда и Allure каждые N секунд

EMOJI_OK = ":green_verify:"
EMOJI_ETA = ":spiral_calendar_pad:"

# fromUpdateAt для чтения треда (фикс против 400)
THREAD_FROM_UPDATE_AT = 1565303257750

# Ретраи для Allure
ALLURE_HTTP_RETRIES = 200
ALLURE_HTTP_RETRY_SLEEP = 0.2
BAND_HTTP_RETRIES = 5
BAND_HTTP_RETRY_SLEEP = 2.0

MSK = ZoneInfo("Europe/Moscow")
UTC = dt.timezone.utc

ALLURE_SESSION = requests.Session()
BAND_SESSION = requests.Session()


# ---------------------------------------------------------------------------
# Регексы парсинга дежурных (как в v4)
# ---------------------------------------------------------------------------
RE_BLOCK_QUOTED = re.compile(
    r'Дежурн\w*\s*\"([^\"]+)\"([\s\S]*?)(?=Дежурн\w*\s*\"|$)', re.IGNORECASE
)
RE_ANDROID = re.compile(
    r"\b(?:Android|andr)\b\s*[-—:–]*\s*@([^\n\r,; ]+)", re.IGNORECASE
)
RE_IOS = re.compile(
    r"\bios\b\s*[-—:–]*\s*@([^\n\r,; ]+)", re.IGNORECASE
)
RE_INLINE_FREE = re.compile(
    r"Дежурн\w*\s+([^\n\r\"@]+?)\s*[-—:–]?\s*@([^\n\r,; ]+)", re.IGNORECASE
)
RE_BLOCK_OT = re.compile(
    r"Дежурн\w*\s+от\s+([^\n\r\"]+)\s*([\s\S]*?)(?=Дежурн\w*|$)", re.IGNORECASE
)
RE_BLOCK_HEADER = re.compile(
    r"Дежурн\w*\s+(?!от\b)([^\n\r\"@]+?)\s*[\r\n]+([\s\S]*?)(?=Дежурн\w*|$)",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Регексы и вспомогалки для парсинга времени / ETA
# ---------------------------------------------------------------------------
_TIME_HHMM = re.compile(r"\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\b")
_TIME_TO = re.compile(
    r"(?i)\bдо\s*([01]?\d|2[0-3])(?:\s*[:.]\s*([0-5]\d))?\b"
)
_TIME_H_ONLY = re.compile(
    r"(?i)\b(?:в|к)\s*([01]?\d|2[0-3])\b(?!\s*[:.]\s*\d)"
)

_RANGE_MIN_SUFFIX = re.compile(
    r"(?i)\b(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:мин|минута|минуты|минут|минуток|минутак|m|м)\b"
)
_RANGE_MIN_PREFIX = re.compile(
    r"(?i)\b(?:минут(?:ок|ак)?|мин)\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\b"
)
_RANGE_NUMBERS_CONTEXT_MIN = re.compile(
    r"\b(\d{1,3})\s*[-–]\s*(\d{1,3})\b"
)

_MIN_PREFIX = re.compile(
    r"(?i)\b(?:минут(?:ок|ак)?|мин)\s*(\d{1,3})\b"
)
_MIN_SUFFIX = re.compile(
    r"(?i)\b(\d{1,3})\s*(?:мин|минута|минуты|минут|минуток|минутак|m|м)\b"
)

_H_SHORT = re.compile(r"(?i)(?!\w)(\d+(?:[.,]\d+)?)\s*ч(?!\w)")
_M_SHORT = re.compile(r"(?i)(?!\w)(\d{1,3})\s*м(?!\w)")

# «часик», «часок» и т.п. без цифр → 1 час
_ONE_HOUR_FUZZY = re.compile(
    r"(?i)\b(?:часик(?:а)?|часок)\b"
)

_RANGE_HOURS = re.compile(
    r"(?i)\b(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(?:ч\.?|час(?:а|ов)?|часик(?:а)?|часка)\b"
)

_HOURS = re.compile(
    r"(?i)\b(?:через\s*)?(?:около\s*)?(\d+(?:[.,]\d+)?)\s*(?:час(?:а|ов)?|часик(?:а)?|часка|ч\.?)\b"
)

_HOURS_REV = re.compile(
    r"(?i)\b(?:час(?:а|ов)?|часик(?:а)?|часка|ч\.?)\s*(\d+(?:[.,]\d+)?)\b"
)

_HALF_HOUR_WORD = re.compile(
    r"(?i)\b(полчаса|полчасика|пол-часа|пол часа|полчас)\b"
)
_ONE_AND_HALF_WORD = re.compile(
    r"(?i)\b(полтора\s*часа|часа\s*полтора|час-полтора)\b"
)
_HOUR_MAYBE_ONE_AND_HALF = re.compile(
    r"(?i)\bчас(?:а)?\b[^\n]{0,30}\bполтора\b"
)
_ONE_HOUR_APPROX = re.compile(
    r"(?i)\b(?:примерно|приблизительно)\s*(?:час|часик(?:а)?|часок)\b"
)
_THROUGH_HOUR = re.compile(
    r"(?i)\bчерез\s*(часок|часик|час)\b"
)

# plain «час» (e.g. «профиль - час») → 1 hour
_ONE_HOUR_PLAIN = re.compile(r"(?i)\bчас\b")

_BARE_NUMBERS = re.compile(r"\b\d{1,4}\b")

_NUM_WORDS: Dict[str, float] = {
    "ноль": 0,
    "один": 1,
    "одна": 1,
    "одну": 1,
    "раз": 1,
    "два": 2,
    "две": 2,
    "двух": 2,
    "пару": 2,
    "пара": 2,
    "три": 3,
    "трех": 3,
    "трёх": 3,
    "четыре": 4,
    "четырех": 4,
    "четырёх": 4,
    "пять": 5,
    "шесть": 6,
    "семь": 7,
    "восемь": 8,
    "восьми": 8,
    "девять": 9,
    "десять": 10,
    "пятнадцать": 15,
    "двадцать": 20,
    "тридцать": 30,
    "сорок": 40,
    "полтора": 1.5,
}

_WORD_HOURS = re.compile(
    r"(?i)\b(?:через\s*)?(?:около\s*)?(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|полтора)\s*"
    r"(?:час(?:а|ов)?|часик(?:а)?|часка|ч\.?)\b"
)
_WORD_HOURS_REV = re.compile(
    r"(?i)\b(?:час(?:а|ов)?|часик(?:а)?|часка|ч\.?)\s*(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|полтора)\b"
)
_WORD_MIN = re.compile(
    r"(?i)\b(?:через\s*)?(?:около\s*)?(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|пятнадцать|двадцать|тридцать|сорок)\s*"
    r"(?:минут(?:ок|ак)?|мин|m|м)\b"
)
_WORD_MIN_REV = re.compile(
    r"(?i)\b(?:минут(?:ок|ак)?|мин|m|м)\s*(один|одна|одну|раз|два|две|двух|пару|пара|три|трех|трёх|четыре|четырех|четырёх|пять|шесть|семь|восемь|девять|десять|пятнадцать|двадцать|тридцать|сорок)\b"
)


# ---------------------------------------------------------------------------
# Общие утилиты
# ---------------------------------------------------------------------------
def _pause_exit(msg: str) -> None:
    print(msg)
    try:
        input("\nНажмите Enter для выхода...")
    except KeyboardInterrupt:
        pass


def _norm(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()


def _b64_search(obj: object) -> str:
    raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _ms_now() -> int:
    return int(time.time() * 1000)


def _fmt_hhmm(d: dt.datetime) -> str:
    return d.strftime("%H:%M")


def _dt_from_ms_msk(ms: int) -> dt.datetime:
    return dt.datetime.fromtimestamp(ms / 1000.0, tz=UTC).astimezone(MSK)


def _cookie_get(cookie_str: str, key: str) -> str:
    parts = [p.strip() for p in (cookie_str or "").split(";") if "=" in p]
    for p in parts:
        k, v = p.split("=", 1)
        if k.strip() == key:
            return v.strip()
    return ""


def _check_secrets_or_die() -> None:
    bad = []
    if not ALLURE_API_TOKEN or "PASTE_" in ALLURE_API_TOKEN:
        bad.append("ALLURE_API_TOKEN")
    if not ALLURE_COOKIES or "PASTE_" in ALLURE_COOKIES:
        bad.append("ALLURE_COOKIES")
    if not ALLURE_XSRF or "PASTE_" in ALLURE_XSRF:
        bad.append("ALLURE_XSRF")
    if not BAND_COOKIES or "PASTE_" in BAND_COOKIES:
        bad.append("BAND_COOKIES")

    if bad:
        _pause_exit(
            "[ОШИБКА] Не заполнены секреты вверху файла: " + ", ".join(bad)
        )
        raise SystemExit(2)


def _http_session_for_url(url: str) -> requests.Session:
    return ALLURE_SESSION if url.startswith(ALLURE_BASE) else BAND_SESSION


def _http_retry_policy(url: str) -> Tuple[str, int, float]:
    if url.startswith(ALLURE_BASE):
        return "Allure", ALLURE_HTTP_RETRIES, ALLURE_HTTP_RETRY_SLEEP
    return "Band", BAND_HTTP_RETRIES, BAND_HTTP_RETRY_SLEEP


def _request_json(
    method: str,
    url: str,
    *,
    headers: dict,
    params: Optional[dict] = None,
    payload: Optional[dict] = None,
) -> dict:
    service_name, retries, retry_sleep = _http_retry_policy(url)
    session = _http_session_for_url(url)
    last_exc: Optional[Exception] = None

    for attempt in range(1, retries + 1):
        try:
            with session.request(
                method,
                url,
                headers=headers,
                params=params,
                json=payload,
                timeout=REQ_TIMEOUT,
            ) as r:
                r.raise_for_status()
                return r.json()
        except requests.RequestException as e:
            last_exc = e
            if attempt >= retries:
                raise
            print(
                f"[WARN][{service_name}] {method} {url} failed "
                f"(attempt {attempt}/{retries}): {e}. Retry in {retry_sleep}s..."
            )
            time.sleep(retry_sleep)

    if last_exc:
        raise last_exc
    raise RuntimeError(f"_request_json({service_name}): непредвиденная ошибка")


def http_get_json(url: str, headers: dict, params: Optional[dict] = None) -> dict:
    return _request_json("GET", url, headers=headers, params=params)


def http_post_json(url: str, headers: dict, payload: dict) -> dict:
    return _request_json("POST", url, headers=headers, payload=payload)


def http_put_json(url: str, headers: dict, payload: dict) -> dict:
    return _request_json("PUT", url, headers=headers, payload=payload)


def allure_headers() -> dict:
    return {
        "accept": "application/json",
        "accept-language": "ru,en;q=0.9",
        "user-agent": "Mozilla/5.0",
        "authorization": f"Api-Token {ALLURE_API_TOKEN}",
        "cookie": ALLURE_COOKIES,
        "x-xsrf-token": ALLURE_XSRF,
    }


def band_headers_read_v4() -> dict:
    return {
        "sec-ch-ua-platform": "Windows",
        "Referer": "",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "ru",
        "Accept": "*/*",
        "sec-ch-ua": "Chromium;v=140, Not=A?Brand;v=24, Google Chrome;v=140",
        "User-Agent": "Mozilla/5.0",
        "sec-ch-ua-mobile": "?0",
        "Cookie": BAND_COOKIES,
    }


def band_headers_write() -> dict:
    csrf = _cookie_get(BAND_COOKIES, "MMCSRF")
    return {
        "accept": "*/*",
        "accept-language": "ru",
        "content-type": "application/json",
        "cookie": BAND_COOKIES,
        "origin": "https://band.wb.ru",
        "user-agent": "Mozilla/5.0",
        "x-csrf-token": csrf,
        "x-requested-with": "XMLHttpRequest",
    }


# ---------------------------------------------------------------------------
# Дата начала поиска дежурных (как в v4)
# ---------------------------------------------------------------------------
def last_thursday_midnight_msk_v4() -> Tuple[dt.datetime, dt.datetime, int]:
    now_msk = dt.datetime.now(MSK)
    # хотим "с прошлой среды в 00:00"
    days_back = (now_msk.weekday() - 2) % 7
    base_msk = (
        now_msk - dt.timedelta(days=days_back)
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    base_utc = base_msk.astimezone(UTC)
    since_ms = int(base_utc.timestamp() * 1000)
    return base_msk, base_utc, since_ms


# ---------------------------------------------------------------------------
# Парсинг дежурных из SWAT_QA (формат как в v4)
# ---------------------------------------------------------------------------
def parse_duties_v4(
    messages: List[dict], catalog_streams: List[str], since_ms: int
) -> Dict[str, Dict[str, Optional[str]]]:
    duties: Dict[str, Dict[str, Optional[str]]] = {}
    norm2orig = {_norm(s): s for s in catalog_streams}

    for msg_obj in messages:
        ts = (msg_obj or {}).get("create_at") or 0
        if ts < since_ms:
            continue

        msg = (msg_obj or {}).get("message") or ""
        if not isinstance(msg, str):
            continue

        # --- блоки Дежурный "стрим" ---
        for m in RE_BLOCK_QUOTED.finditer(msg):
            s_name_raw = m.group(1).strip()
            body = m.group(2) or ""
            key_norm = _norm(s_name_raw)
            if key_norm not in norm2orig:
                continue
            stream_name = norm2orig[key_norm]
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})

            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma:
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi:
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")

        # --- блоки "Дежурный от <стрим>" ---
        for m in RE_BLOCK_OT.finditer(msg):
            s_name_raw = m.group(1).strip()
            body = m.group(2) or ""
            key_norm = _norm(s_name_raw)
            if key_norm not in norm2orig:
                continue
            stream_name = norm2orig[key_norm]
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})

            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"):
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi and not row.get("iOS"):
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")

        # --- заголовки без "от" ---
        for m in RE_BLOCK_HEADER.finditer(msg):
            header = (m.group(1) or "").strip()
            body = (m.group(2) or "")
            key_norm = _norm(header)
            if key_norm not in norm2orig:
                continue
            stream_name = norm2orig[key_norm]
            row = duties.setdefault(stream_name, {"Android": None, "iOS": None})

            ma = RE_ANDROID.search(body)
            mi = RE_IOS.search(body)
            if ma and not row.get("Android"):
                row["Android"] = "@" + ma.group(1).strip().lstrip("@")
            if mi and not row.get("iOS"):
                row["iOS"] = "@" + mi.group(1).strip().lstrip("@")

        # --- инлайновые "Дежурный <стрим> Android @..." ---
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

            if platform:
                stream_name = norm2orig.get(_norm(base_stream), base_stream)
                row = duties.setdefault(stream_name, {"Android": None, "iOS": None})
                row[platform] = person
            else:
                stream_name = norm2orig.get(_norm(raw_name), raw_name)
                duties.setdefault(stream_name, {"Android": None, "iOS": None})

    return duties


# ---------------------------------------------------------------------------
# ETA / время
# ---------------------------------------------------------------------------
def _eta_from_minutes(base_msk_dt: dt.datetime, mins: int) -> str:
    return _fmt_hhmm(base_msk_dt + dt.timedelta(minutes=mins))


def _word_val(word: str) -> Optional[float]:
    w = (word or "").strip().casefold()
    return _NUM_WORDS.get(w)


def _parse_minutes_like_text(t: str) -> Optional[int]:
    if not t:
        return None
    t = t.strip().lower()

    # "через час", "через часок", "через часик"
    if _THROUGH_HOUR.search(t):
        return 60

    # "полчаса"
    if _HALF_HOUR_WORD.search(t):
        return 30

    # "полтора часа"
    if _ONE_AND_HALF_WORD.search(t):
        return 90

    # "час, может полтора" -> берём верхнюю оценку
    if _HOUR_MAYBE_ONE_AND_HALF.search(t):
        return 90

    # "примерно час"
    if _ONE_HOUR_APPROX.search(t):
        return 60

    # "часик примерно", "Около часика"
    if _ONE_HOUR_FUZZY.search(t):
        return 60


    # plain "час" like "профиль - час"
    if _ONE_HOUR_PLAIN.search(t):
        return 60
    # словесные часы "два часа", "часа два"
    m = _WORD_HOURS.search(t)
    if m:
        v = _word_val(m.group(1))
        if v is not None:
            return int(round(v * 60))

    m = _WORD_HOURS_REV.search(t)
    if m:
        v = _word_val(m.group(1))
        if v is not None:
            return int(round(v * 60))

    # словесные минуты "минут 30", "минуток двадцать"
    m = _WORD_MIN.search(t)
    if m:
        v = _word_val(m.group(1))
        if v is not None:
            return int(round(v))

    m = _WORD_MIN_REV.search(t)
    if m:
        v = _word_val(m.group(1))
        if v is not None:
            return int(round(v))

    # "5ч", "2,5ч"
    m = _H_SHORT.search(t)
    if m:
        val = float(m.group(1).replace(",", "."))
        return int(round(val * 60))

    # "7м"
    m = _M_SHORT.search(t)
    if m:
        return int(m.group(1))

    # "5 часов", "2 часика", "5,5ч"
    m = _HOURS.search(t)
    if m:
        val = float(m.group(1).replace(",", "."))
        return int(round(val * 60))

    m = _HOURS_REV.search(t)
    if m:
        val = float(m.group(1).replace(",", "."))
        return int(round(val * 60))

    # диапазоны в часах "2-3 часа"
    m = _RANGE_HOURS.search(t)
    if m:
        a = float(m.group(1).replace(",", "."))
        b = float(m.group(2).replace(",", "."))
        return int(round(max(a, b) * 60))

    # диапазоны минут "20-30 минут", "30-40 минутак"
    m = _RANGE_MIN_SUFFIX.search(t)
    if m:
        return max(int(m.group(1)), int(m.group(2)))

    m = _RANGE_MIN_PREFIX.search(t)
    if m:
        return max(int(m.group(1)), int(m.group(2)))

    m = _RANGE_NUMBERS_CONTEXT_MIN.search(t)
    if m and re.search(r"(?i)\b(минут(?:ок|ак)?|мин|m|м)\b", t):
        return max(int(m.group(1)), int(m.group(2)))

    # "минут 30"
    m = _MIN_PREFIX.search(t)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 24 * 60:
            return v

    # "30 мин"
    m = _MIN_SUFFIX.search(t)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 24 * 60:
            return v

    # голые числа типа "30" — трактуем как минуты,
    # но ТОЛЬКО когда весь ответ — это число (с опциональным знаком пунктуации).
    # Иначе можно словить ложняк на вроде "ещё 54 кейса осталось".
    m = re.fullmatch(r"\s*(\d{1,3})\s*[!?.,…]?\s*", t)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 24 * 60:
            return v

    return None


def parse_reply_to_eta(text: str, base_msk_dt: dt.datetime) -> Optional[str]:
    t = (text or "").strip().lower()
    if not t:
        return None

    mins = _parse_minutes_like_text(t)
    if mins is not None:
        mins = max(0, min(mins, 24 * 60))
        return _eta_from_minutes(base_msk_dt, mins)

    # конкретное время 18:30
    m = _TIME_HHMM.search(t)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2))
        eta = base_msk_dt.replace(
            hour=hh, minute=mm, second=0, microsecond=0
        )
        if eta < base_msk_dt - dt.timedelta(minutes=10):
            eta += dt.timedelta(days=1)
        return _fmt_hhmm(eta)

    # "до 18"
    m = _TIME_TO.search(t)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2)) if m.group(2) else 0
        eta = base_msk_dt.replace(
            hour=hh, minute=mm, second=0, microsecond=0
        )
        if eta < base_msk_dt - dt.timedelta(minutes=10):
            eta += dt.timedelta(days=1)
        return _fmt_hhmm(eta)

    # "в 19"
    m = _TIME_H_ONLY.search(t)
    if m:
        hh = int(m.group(1))
        eta = base_msk_dt.replace(
            hour=hh, minute=0, second=0, microsecond=0
        )
        if eta < base_msk_dt - dt.timedelta(minutes=10):
            eta += dt.timedelta(days=1)
        return _fmt_hhmm(eta)

    return None


# ---------------------------------------------------------------------------
# Обновление строк сообщений
# ---------------------------------------------------------------------------
def _line_with_status(base_line: str, status: str) -> str:
    line = (base_line or "").rstrip()

    # вычищаем старые статусы
    line = re.sub(r"\s*:green_verify:\s*", " ", line, flags=re.I)
    line = re.sub(r"\s*:verified:\s*", " ", line, flags=re.I)
    line = re.sub(r"\s*:multi-search:\s*", " ", line, flags=re.I)
    line = re.sub(
        r"\s*:spiral_calendar_pad:\s*\d{1,2}\s*[:.]\s*\d{2}\s*",
        " ",
        line,
        flags=re.I,
    )
    line = re.sub(r"\s*:spiral_calendar_pad:\s*", " ", line, flags=re.I)

    line = " ".join(line.split())

    if status:
        return f"{line}   {status}".rstrip()
    return line


def _match_stream_from_line(
    line: str, streams_sorted: List[str]
) -> Optional[str]:
    sline = (line or "").lstrip()
    sline = re.sub(r"^[\-\–\—•*✅☑️🟩🟢]+\s*", "", sline)

    for s in streams_sorted:
        if not sline.startswith(s):
            continue
        rest = sline[len(s) :]
        if rest == "":
            return s
        if rest[0].isspace() or rest[0] in "-–—:":
            return s
    return None


def _resolve_user_streams(
    username: str,
    stream_order: List[str],
    username_to_streams: Dict[str, List[str]],
    stream_to_handle: Dict[str, str],
) -> List[str]:
    """
    Возвращает все стримы пользователя среди текущих pending-стримов.
    Сначала используем прямой индекс username_to_streams, затем fallback по handle.
    """
    user_key = (username or "").strip().lower()
    if not user_key:
        return []

    resolved: List[str] = []
    seen: Set[str] = set()

    for s in username_to_streams.get(user_key, []):
        if s in stream_order and s not in seen:
            seen.add(s)
            resolved.append(s)

    if resolved:
        return resolved

    for s in stream_order:
        h = (stream_to_handle.get(s) or "").lstrip("@").strip().lower()
        if h and h != "?" and h == user_key and s not in seen:
            seen.add(s)
            resolved.append(s)

    return resolved


def build_ping_message(
    platform: str,
    stream_order: List[str],
    stream_to_handle: Dict[str, str],
    stream_to_status: Dict[str, Optional[str]],
) -> str:
    lines = [
        f"Коллеги, просьба написать сроки проставления оков по платформе {platform}",
        "",
    ]
    for s in stream_order:
        h = stream_to_handle.get(s, "?")
        st = stream_to_status.get(s, None)
        line = f"{s} {h}".rstrip()
        if st:
            line = f"{line}   {st}"
        lines.append(line)
    return "\n".join(lines).rstrip() + "\n"


def update_message_preserving_base(
    base_message: str,
    stream_order: List[str],
    stream_to_handle: Dict[str, str],
    stream_to_status: Dict[str, Optional[str]],
) -> str:
    """
    - Оставляет руками отредактированные строки, если по стриму нет нашего статуса (OK/ETA).
    - Обновляет только те строки, где у нас явно есть статус.
    - Для новых стримов добавляет строки в конец.
    """
    lines = (base_message or "").splitlines()
    updated: Set[str] = set()
    streams_sorted = sorted(stream_order, key=len, reverse=True)

    for i, line in enumerate(lines):
        matched_stream = _match_stream_from_line(line, streams_sorted)
        if not matched_stream:
            continue

        status = stream_to_status.get(matched_stream, None)
        if status is None:
            # скрипт не контролирует этот стрим — не трогаем строку
            updated.add(matched_stream)
            continue

        lines[i] = _line_with_status(line, status)
        updated.add(matched_stream)

    missing = [s for s in stream_order if s not in updated]
    if missing:
        if lines and lines[-1].strip() != "":
            lines.append("")
        for s in missing:
            h = stream_to_handle.get(s, "?")
            st = stream_to_status.get(s, None)
            new_line = f"{s} {h}".rstrip()
            if st:
                new_line = f"{new_line}   {st}"
            lines.append(new_line)

    return "\n".join(lines).rstrip() + "\n"


def _diff_lines(old: str, new: str) -> str:
    o = old.splitlines()
    n = new.splitlines()
    out = []
    mx = max(len(o), len(n))
    for i in range(mx):
        ol = o[i] if i < len(o) else ""
        nl = n[i] if i < len(n) else ""
        if ol != nl:
            if ol:
                out.append(f"- {ol}")
            if nl:
                out.append(f"+ {nl}")
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# Allure: leaf (pending) + тестплан (стримы)
# ---------------------------------------------------------------------------
def allure_leaf_pending_ids_all_pages(
    launch_id: int, prog_search: str, size: int = 200
) -> Dict[int, str]:
    """
    Возвращает словарь {testResultId: stream_name} для всех pending в launch.
    Название стрима берём из поля "name" в ответе leaf.
    """
    id_to_stream: Dict[int, str] = {}
    page = 0

    while True:
        leaf = http_get_json(
            f"{ALLURE_BASE}/api/testresulttree/leaf",
            headers=allure_headers(),
            params={
                "launchId": launch_id,
                "search": prog_search,
                "sort": "name,asc",
                "size": size,
                "page": page,
            },
        )
        content = (leaf or {}).get("content") or []
        if not isinstance(content, list):
            content = []

        for item in content:
            if not isinstance(item, dict):
                continue
            tid = item.get("id")
            name = (item.get("name") or "").strip()
            if not tid or not name:
                continue
            try:
                tid_int = int(tid)
            except Exception:
                continue
            id_to_stream[tid_int] = name

        total_pages = (leaf or {}).get("totalPages")
        if isinstance(total_pages, int):
            if page >= total_pages - 1:
                break
        else:
            if not content:
                break

        page += 1
        if page > 100:
            break

    return id_to_stream


def allure_testplan_streams() -> List[str]:
    """
    Возвращает список стримов из тестплана (имена в поле 'name'),
    фильтруя EXCLUDED_STREAMS.
    """
    resp = http_get_json(
        f"{ALLURE_BASE}/api/testplan/{ALLURE_TESTPLAN_ID}/tree/leaf",
        headers=allure_headers(),
        params={
            "treeId": ALLURE_TESTPLAN_TREE_ID,
            "projectId": ALLURE_PROJECT_ID,
            "path": ALLURE_TESTPLAN_PATH,
            "sort": "name,asc",
            "size": 500,
        },
    )
    content = (resp or {}).get("content") or []
    streams: List[str] = []
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip()
            if not name or name in EXCLUDED_STREAMS:
                continue
            streams.append(name)

    # дедуп по порядку
    seen: Set[str] = set()
    result: List[str] = []
    for s in streams:
        if s not in seen:
            seen.add(s)
            result.append(s)
    return result


def allure_testresult_stream_value(testresult_id: int) -> Optional[str]:
    """
    Резервный метод: вытаскивает параметр 'Стрим' из /api/testresult/{id}.
    Сейчас основная логика берёт стрим из поля 'name' в leaf.
    """
    tr = http_get_json(
        f"{ALLURE_BASE}/api/testresult/{testresult_id}", headers=allure_headers()
    )
    for p in (tr.get("parameters") or []):
        if (p.get("name") or "").strip() == "Стрим":
            v = (p.get("value") or "").strip()
            if v:
                return v
    return None


def allure_testresult_exists_in_launch(
    testresult_id: int, launch_id: int
) -> bool:
    """
    Проверяет, существует ли testresult в указанном launch.
    Нужен, чтобы отличать "кейc прошёл" от "кейc удалён из рана".
    """
    url = f"{ALLURE_BASE}/api/testresult/{testresult_id}"
    headers = allure_headers()
    session = _http_session_for_url(url)

    for attempt in range(ALLURE_HTTP_RETRIES):
        try:
            with session.get(url, headers=headers, timeout=REQ_TIMEOUT) as r:
                if r.status_code == 404:
                    return False

                try:
                    r.raise_for_status()
                except requests.RequestException:
                    if attempt + 1 >= ALLURE_HTTP_RETRIES:
                        return True
                    time.sleep(ALLURE_HTTP_RETRY_SLEEP)
                    continue

                try:
                    data = r.json()
                except Exception:
                    return True
        except requests.RequestException:
            if attempt + 1 >= ALLURE_HTTP_RETRIES:
                # при сетевых ошибках считаем, что кейс существует, чтобы не удалить по ошибке
                return True
            time.sleep(ALLURE_HTTP_RETRY_SLEEP)
            continue

        lid = data.get("launchId") or data.get("launch_id")
        try:
            return int(lid) == int(launch_id) if lid is not None else True
        except Exception:
            return True

    return True


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> None:
    _check_secrets_or_die()

    release = input("Введите релиз (например 7.4.3000): ").strip()
    if not release:
        _pause_exit("Релиз не задан.")
        return

    plat_choice = input("Платформа (1/2): 1 - Android, 2 - iOS: ").strip()
    if plat_choice == "1":
        platform = "Android"
    elif plat_choice == "2":
        platform = "iOS"
    else:
        _pause_exit("Некорректный выбор платформы.")
        return

    # ------------------------------------------------------------------ #
    # 1. Ищу запуск Allure
    # ------------------------------------------------------------------ #
    print("\n[Шаг 1/5] Ищу запуск в Allure...")
    target_name = f"[ALL][{platform}] Готовность к релизу {release}"
    search = _b64_search(
        [{"id": "name", "type": "string", "value": target_name}]
    )
    launch_data = http_get_json(
        f"{ALLURE_BASE}/api/launch",
        headers=allure_headers(),
        params={
            "page": 0,
            "size": 25,
            "search": search,
            "projectId": ALLURE_PROJECT_ID,
            "preview": "true",
            "sort": "createdDate,desc",
        },
    )
    launches = (launch_data or {}).get("content") or []
    if not launches:
        _pause_exit("[ОШИБКА] Запуск не найден.")
        return
    launch_id = int(launches[0].get("id"))
    print("[OK] launchId:", launch_id)

    prog_search = _b64_search(
        [
            {
                "id": "progress",
                "type": "testProgressStatusArray",
                "value": ["pending"],
            }
        ]
    )

    # ------------------------------------------------------------------ #
    # 2. Берём pending из leaf (id + имя стрима в name)
    # ------------------------------------------------------------------ #
    print("\n[Шаг 2/5] Получаю pending кейсы (из leaf)...")
    pending_now = allure_leaf_pending_ids_all_pages(
        launch_id, prog_search, size=200
    )
    print("[OK] pending:", len(pending_now))
    if not pending_now:
        _pause_exit("[ИНФО] Pending кейсов нет.")
        return

    # ------------------------------------------------------------------ #
    # 3. Каталог стримов из тестплана
    # ------------------------------------------------------------------ #
    print("\n[Шаг 3/5] Беру каталог стримов из Allure testplan...")
    catalog_streams = allure_testplan_streams()

    # ------------------------------------------------------------------ #
    # 4. Собираем маппинг стрим -> testResultId из leaf
    # ------------------------------------------------------------------ #
    print("\n[Шаг 4/5] Собираю стримы из leaf...")
    stream_to_ids: Dict[str, List[int]] = {}
    id_to_stream: Dict[int, str] = {}

    for tid, stream_name in pending_now.items():
        stream_val = (stream_name or "").strip()
        if not stream_val or stream_val in EXCLUDED_STREAMS:
            continue
        stream_to_ids.setdefault(stream_val, []).append(tid)
        id_to_stream[tid] = stream_val

    if not stream_to_ids:
        _pause_exit(
            "[ИНФО] В pending нет кейсов с корректным названием стрима в поле 'name' (после фильтра EXCLUDED_STREAMS)."
        )
    stream_order = sorted(stream_to_ids.keys())
    print("[OK] Стримов:", len(stream_order))

    # ------------------------------------------------------------------ #
    # 5. Дежурные из канала SWAT_QA
    # ------------------------------------------------------------------ #
    print("\n[Шаг 5/5] Определяю дежурных из канала SWAT_QA...")
    base_msk, _, since_ms = last_thursday_midnight_msk_v4()
    posts_data = http_get_json(
        f"{BAND_BASE}/channels/{SWAT_QA}/posts",
        headers=band_headers_read_v4(),
        params={
            "since": since_ms,
            "skipFetchThreads": "false",
            "collapsedThreads": "true",
            "collapsedThreadsExtended": "false",
            "per_page": 200,
        },
    )
    raw_posts = (posts_data or {}).get("posts") or {}
    msgs: List[dict] = []
    if isinstance(raw_posts, dict):
        for p in raw_posts.values():
            msg = (p or {}).get("message") or ""
            ts = (p or {}).get("create_at") or 0
            if isinstance(msg, str) and msg.strip():
                msgs.append(
                    {"message": msg, "create_at": ts, "raw": p}
                )

    duties = parse_duties_v4(msgs, catalog_streams, since_ms)
    print(
        f"[OK] Старт парсинга дежурных с {base_msk.strftime('%Y-%m-%d %H:%M')} (МСК)"
    )

    stream_to_handle: Dict[str, str] = {}
    found_cnt = 0
    for s in stream_order:
        h = (duties.get(s, {}) or {}).get(platform)
        if h:
            found_cnt += 1
            stream_to_handle[s] = h
        else:
            stream_to_handle[s] = "?"

    print(f"[OK] Найдено назначений: {found_cnt}")
    print("\nТекущие дежурные (как будет в сообщении):")
    for s in stream_order:
        print(f"{s} {stream_to_handle[s]}")

    # username -> список стримов (по выбранной платформе)
    username_to_streams: Dict[str, List[str]] = {}
    for s, handle in stream_to_handle.items():
        login = handle.lstrip("@").strip().lower()
        if not login or login == "?":
            continue
        username_to_streams.setdefault(login, []).append(s)

    # ------------------------------------------------------------------ #
    # Поиск root-треда в релизном канале
    # ------------------------------------------------------------------ #
    print("\n[INIT] Ищу тред в релизном канале по хэштегам...")
    since_30 = _ms_now() - 30 * 24 * 3600 * 1000
    ch_posts = http_get_json(
        f"{BAND_BASE}/channels/{RELEASE_CHANNEL}/posts",
        headers=band_headers_read_v4(),
        params={
            "since": since_30,
            "skipFetchThreads": "false",
            "collapsedThreads": "true",
            "collapsedThreadsExtended": "false",
            "per_page": 200,
        },
    )
    posts = (ch_posts or {}).get("posts") or {}
    order = (ch_posts or {}).get("order") or []

    tag_plat = f"#{platform.casefold()}"
    rel = release.casefold()

    root_id: Optional[str] = None
    root_msg = ""
    best_ts = -1
    if isinstance(posts, dict) and isinstance(order, list):
        for pid in order:
            p = posts.get(pid)
            if not isinstance(p, dict):
                continue
            if (p.get("root_id") or "") != "":
                continue
            msg = (p.get("message") or "")
            if not isinstance(msg, str):
                continue
            ml = msg.casefold()
            if tag_plat in ml and "#release" in ml and rel in ml:
                ts = int(p.get("create_at") or 0)
                if ts > best_ts:
                    best_ts = ts
                    root_id = p.get("id") or pid
                    root_msg = msg

    if not root_id:
        _pause_exit(
            f"[ОШИБКА] Не нашёл root-пост треда по '{tag_plat} #Release {release}'."
        )
        return

    root_id = str(root_id)
    print("[OK] root_id:", root_id, "сообщение:", (root_msg or "").strip())

    # ------------------------------------------------------------------ #
    # Грузим пользователей релизного канала (для user_id -> username)
    # ------------------------------------------------------------------ #
    print("\n[INIT] Гружу пользователей релизного канала (1 раз)...")
    user_id_to_username: Dict[str, str] = {}
    for page in range(0, 4):
        users = http_get_json(
            f"{BAND_BASE}/users",
            headers=band_headers_read_v4(),
            params={
                "in_channel": RELEASE_CHANNEL,
                "page": page,
                "per_page": 200,
                "sort": "admin",
            },
        )
        if not isinstance(users, list) or not users:
            break
        for u in users:
            uid = (u or {}).get("id")
            un = (u or {}).get("username")
            if uid and un:
                user_id_to_username[str(uid)] = str(un)
        if len(users) < 200:
            break

    # стрим -> ETA и OK-флаг
    stream_eta: Dict[str, str] = {}
    stream_verified: Dict[str, bool] = {s: False for s in stream_order}

    # Базовое сообщение
    ping_message = build_ping_message(
        platform, stream_order, stream_to_handle, {s: None for s in stream_order}
    )

    my_user_id = _cookie_get(BAND_COOKIES, "MMUSERID") or ""

    # ------------------------------------------------------------------ #
    # Проверяем, нет ли уже нашего сообщения-пинга в треде
    # ------------------------------------------------------------------ #
    print("\n[INIT] Проверяю, нет ли уже нашего сообщения-пинга в треде...")
    ping_post_id: Optional[str] = None
    ping_created_at: int = 0
    base_message_seed = ping_message

    try:
        thr_init = http_get_json(
            f"{BAND_BASE}/posts/{root_id}/thread",
            headers=band_headers_read_v4(),
            params={
                "skipFetchThreads": "false",
                "collapsedThreads": "true",
                "collapsedThreadsExtended": "false",
                "direction": "down",
                "perPage": 200,
                "updatesOnly": "true",
                "fromUpdateAt": THREAD_FROM_UPDATE_AT,
            },
        )
        thr_posts_init = (thr_init or {}).get("posts") or {}
    except Exception:
        thr_posts_init = {}

    if isinstance(thr_posts_init, dict):
        cand_existing: List[Tuple[int, str, dict]] = []
        for pid, p in thr_posts_init.items():
            if not isinstance(p, dict):
                continue
            if (p.get("root_id") or "") != root_id:
                continue
            if my_user_id and (p.get("user_id") or "") != my_user_id:
                continue
            msg = (p.get("message") or "")
            if not isinstance(msg, str):
                continue
            ml = msg.casefold()
            if "просьба написать сроки" in ml and platform.casefold() in ml:
                ca = int(p.get("create_at") or 0)
                cand_existing.append((ca, str(pid), p))
        if cand_existing:
            cand_existing.sort(reverse=True)
            ping_created_at, ping_post_id, base_post_init = cand_existing[0]
            print(
                "[OK] Найдено существующее сообщение-пинг, буду его редактировать:",
                ping_post_id,
            )
            base_message_seed = base_post_init.get("message") or ping_message

    # Если своего сообщения ещё нет — публикуем
    if not ping_post_id:
        print("\nСообщение для копирования (и для поста):\n")
        print(ping_message)
        print("Опубликовать сообщение-пинг в тред", root_id, "?")
        print("1 - Да")
        print("2 - Нет")
        if input("> ").strip() != "1":
            _pause_exit("Ок, публикацию отменил.")
            return

        created = http_post_json(
            f"{BAND_BASE}/posts",
            headers=band_headers_write(),
            payload={
                "file_ids": [],
                "message": ping_message,
                "channel_id": RELEASE_CHANNEL,
                "root_id": root_id,
                "metadata": {},
                "props": {},
            },
        )
        ping_post_id = str((created or {}).get("id") or "")
        if not ping_post_id:
            _pause_exit("[ОШИБКА] Не получил id опубликованного поста.")
            return
        ping_created_at = int((created or {}).get("create_at") or 0)
        base_message_seed = (created or {}).get("message") or ping_message
        print("[OK] post_id:", ping_post_id)
    else:
        print("[OK] Использую уже существующий post_id:", ping_post_id)

    print(
        f"\n[MONITOR] Опрос каждые {POLL_SECONDS} сек. Ctrl+C чтобы остановить.\n"
    )

    seen_thread_posts_uat: Dict[str, int] = {}
    warned_users_no_stream: Set[str] = set()
    eta_parse_warned_ids: Set[str] = set()
    eta_refresh_streams: Set[str] = set()

    try:
        while True:
            # --------------------------- 1) Allure pending ------------------
            cur_pending_map = allure_leaf_pending_ids_all_pages(
                launch_id, prog_search, size=200
            )
            cur_pending_ids = set(cur_pending_map.keys())

            # новые id, которых не было при старте
            unknown_pending = [
                tid for tid in cur_pending_ids if tid not in id_to_stream
            ]
            for tid in unknown_pending:
                stream_val = (cur_pending_map.get(tid) or "").strip()
                if not stream_val or stream_val in EXCLUDED_STREAMS:
                    continue

                id_to_stream[tid] = stream_val
                if stream_val not in stream_to_ids:
                    stream_to_ids[stream_val] = [tid]
                    if stream_val not in stream_order:
                        stream_order.append(stream_val)
                    if stream_val not in stream_to_handle:
                        h = (duties.get(stream_val, {}) or {}).get(
                            platform
                        ) or "?"
                        stream_to_handle[stream_val] = h
                        login = h.lstrip("@").strip().lower()
                        if login and login != "?":
                            username_to_streams.setdefault(
                                login, []
                            ).append(stream_val)
                    if stream_val not in stream_verified:
                        stream_verified[stream_val] = False
                else:
                    if tid not in stream_to_ids[stream_val]:
                        stream_to_ids[stream_val].append(tid)

            # --- удалённые из рана testresult'ы (не окать, а убрать) ---
            for s in list(stream_to_ids.keys()):
                ids = stream_to_ids.get(s) or []
                keep_ids: List[int] = []
                for tid in ids:
                    if tid in cur_pending_ids:
                        keep_ids.append(tid)
                        continue
                    # не в pending — может быть passed или удалён
                    exists = allure_testresult_exists_in_launch(tid, launch_id)
                    if not exists:
                        id_to_stream.pop(tid, None)
                        print(
                            f"[INFO][Allure] TestResult {tid} для '{s}' "
                            f"удалён из рана, убираю из трекинга."
                        )
                    else:
                        keep_ids.append(tid)

                if keep_ids:
                    stream_to_ids[s] = keep_ids
                else:
                    # у стрима не осталось кейсов в ране — убираем его
                    if s in stream_to_ids:
                        del stream_to_ids[s]
                    if s in stream_verified:
                        del stream_verified[s]
                    if s in stream_eta:
                        del stream_eta[s]
                    if s in stream_to_handle:
                        del stream_to_handle[s]
                    if s in stream_order:
                        stream_order.remove(s)
                    # подчистим username_to_streams
                    for login, arr in list(username_to_streams.items()):
                        if s in arr:
                            new_arr = [x for x in arr if x != s]
                            if new_arr:
                                username_to_streams[login] = new_arr
                            else:
                                username_to_streams.pop(login, None)
                    print(
                        f"[INFO][Allure] Стрим '{s}' удалён из рана, "
                        f"убираю его из сообщения."
                    )

            # ---------------------- 2) переключение OK по стримам ---------
            for s in list(stream_order):
                ids = stream_to_ids.get(s) or []
                pending_hits = [tid for tid in ids if tid in cur_pending_ids]
                all_done = bool(ids) and not pending_hits

                if all_done and not stream_verified.get(s, False):
                    stream_verified[s] = True
                    print(f"[OK][Allure] Проставлен OK: {s}")

                elif (not all_done) and stream_verified.get(s, False):
                    stream_verified[s] = False
                    eta_refresh_streams.add(s)
                    print(
                        f"[WARN][Allure] OK снят (pending снова есть): {s} "
                        f"(пример id: {pending_hits[:3]})"
                    )

            # ---------------------- 3) Читаем тред -------------------------
            thr = http_get_json(
                f"{BAND_BASE}/posts/{root_id}/thread",
                headers=band_headers_read_v4(),
                params={
                    "skipFetchThreads": "false",
                    "collapsedThreads": "true",
                    "collapsedThreadsExtended": "false",
                    "direction": "down",
                    "perPage": 200,
                    "updatesOnly": "true",
                    "fromUpdateAt": THREAD_FROM_UPDATE_AT,
                },
            )
            thr_posts = (thr or {}).get("posts") or {}
            if not isinstance(thr_posts, dict):
                time.sleep(POLL_SECONDS)
                continue

            base_post = thr_posts.get(ping_post_id)
            if not isinstance(base_post, dict):
                cand = []
                for pid, p in thr_posts.items():
                    if not isinstance(p, dict):
                        continue
                    if (p.get("root_id") or "") != root_id:
                        continue
                    if my_user_id and (p.get("user_id") or "") != my_user_id:
                        continue
                    msg = (p.get("message") or "")
                    if not isinstance(msg, str):
                        continue
                    ml = msg.casefold()
                    if "просьба написать сроки" in ml and platform.casefold() in ml:
                        ca = int(p.get("create_at") or 0)
                        cand.append((ca, str(pid), p))
                if cand:
                    cand.sort(reverse=True)
                    ping_created_at, ping_post_id, base_post = cand[0]
                    print("[WARN] Наш пост найден заново:", ping_post_id)

            if not isinstance(base_post, dict):
                time.sleep(POLL_SECONDS)
                continue

            base_message = base_post.get("message") or ""

            # какие стримы сейчас помечены OK в тексте (нужно, чтобы уметь снимать галку)
            ok_in_msg: Set[str] = set()
            _streams_sorted_local = sorted(stream_order, key=len, reverse=True)
            for _ln in (base_message or "").splitlines():
                _ms = _match_stream_from_line(_ln, _streams_sorted_local)
                if not _ms:
                    continue
                _ll = _ln.casefold()
                if (":green_verify:" in _ll) or (":verified:" in _ll):
                    ok_in_msg.add(_ms)

            # если OK сняли, но ETA был только в старых сообщениях — пересканим историю по стриму
            if eta_refresh_streams:
                for _need_s in list(eta_refresh_streams):
                    _best_eta = None
                    _best_created = -1
                    _best_user = ""
                    _best_snip = ""
                    for _pid, _p in thr_posts.items():
                        if not isinstance(_p, dict):
                            continue
                        _pid_s = str(_pid)
                        if _pid_s in (root_id, ping_post_id):
                            continue
                        if (_p.get("root_id") or "") != root_id:
                            continue
                        _created_ms = int(_p.get("create_at") or 0)
                        if ping_created_at and _created_ms < ping_created_at:
                            continue
                        _uid = str(_p.get("user_id") or "")
                        _username = user_id_to_username.get(_uid, "")
                        if not _username:
                            continue
                        _matched_streams = _resolve_user_streams(
                            _username,
                            stream_order,
                            username_to_streams,
                            stream_to_handle,
                        )
                        if _need_s not in _matched_streams:
                            continue
                        _msg = (_p.get("message") or "")
                        if not isinstance(_msg, str):
                            continue
                        _base_dt = _dt_from_ms_msk(_created_ms)
                        _eta = parse_reply_to_eta(_msg, _base_dt)
                        if not _eta:
                            continue
                        if _created_ms >= _best_created:
                            _best_created = _created_ms
                            _best_eta = _eta
                            _best_user = _username
                            _best_snip = " ".join(_msg.strip().split())
                    if _best_eta:
                        stream_eta[_need_s] = _best_eta
                        if len(_best_snip) > 120:
                            _best_snip = _best_snip[:120] + "…"
                        print(
                            f"[ETA][Restore] {_need_s} (@{_best_user}) "
                            f"'{_best_snip}' -> {_best_eta}"
                        )
                    eta_refresh_streams.discard(_need_s)

            # ---------------------- 4) Ответы дежурных -> ETA -------------
            for pid, p in thr_posts.items():
                if not isinstance(p, dict):
                    continue
                pid_s = str(pid)
                if pid_s in (root_id, ping_post_id):
                    continue
                if (p.get("root_id") or "") != root_id:
                    continue

                created_ms = int(p.get("create_at") or 0)
                # учитываем только сообщения, написанные ПОСЛЕ публикации пинга
                if ping_created_at and created_ms < ping_created_at:
                    continue

                uat = int(p.get("update_at") or created_ms)
                prev_uat = seen_thread_posts_uat.get(pid_s)
                if prev_uat is not None and uat <= prev_uat:
                    continue
                seen_thread_posts_uat[pid_s] = uat

                uid = str(p.get("user_id") or "")
                username = user_id_to_username.get(uid, "")
                if not username:
                    continue

                # находим все стримы пользователя среди активных pending-стримов
                user_key = username.lower()
                duty_streams = username_to_streams.get(user_key, [])
                streams = _resolve_user_streams(
                    username,
                    stream_order,
                    username_to_streams,
                    stream_to_handle,
                )

                if not streams:
                    if (
                        duty_streams
                        and user_key not in warned_users_no_stream
                    ):
                        warned_users_no_stream.add(user_key)
                        print(
                            f"[WARN][MAP] Есть дежурный @{username} по стримам "
                            f"{', '.join(duty_streams)}, но среди pending-стримов "
                            f"соответствия не найдено."
                        )
                    continue

                msg = (p.get("message") or "")
                if not isinstance(msg, str):
                    continue

                base_dt = _dt_from_ms_msk(created_ms)
                eta_hhmm = parse_reply_to_eta(msg, base_dt)

                if eta_hhmm:
                    changed_streams: List[str] = []
                    for stream in streams:
                        if stream_eta.get(stream) != eta_hhmm:
                            stream_eta[stream] = eta_hhmm
                            changed_streams.append(stream)

                    if not changed_streams:
                        continue

                    snippet = " ".join(msg.strip().split())
                    if len(snippet) > 120:
                        snippet = snippet[:120] + "…"
                    print(
                        f"[ETA][Band] {', '.join(changed_streams)} (@{username}) "
                        f"'{snippet}' -> {eta_hhmm} "
                        f"(база {base_dt.strftime('%H:%M')} МСК)"
                    )
                elif (
                    not eta_hhmm and pid_s not in eta_parse_warned_ids
                ):
                    eta_parse_warned_ids.add(pid_s)
                    snippet = " ".join(msg.strip().split())
                    if len(snippet) > 120:
                        snippet = snippet[:120] + "…"
                    print(
                        f"[INFO][ETA] Не смог разобрать время в ответе "
                        f"для стримов {', '.join(streams)} (@{username}): '{snippet}'"
                    )

            # ---------------------- 5) Формируем статусы -------------------
            stream_to_status: Dict[str, Optional[str]] = {}
            for s in stream_order:
                if stream_verified.get(s):
                    stream_to_status[s] = EMOJI_OK
                else:
                    eta = stream_eta.get(s)
                    if eta:
                        stream_to_status[s] = f"{EMOJI_ETA} {eta}"
                    else:
                        # если в тексте осталась старая галка, а OK уже сняли — чистим галку
                        stream_to_status[s] = "" if s in ok_in_msg else None

            # ---------------------- 6) Апдейт сообщения --------------------
            new_message = update_message_preserving_base(
                base_message,
                stream_order,
                stream_to_handle,
                stream_to_status,
            )
            if new_message.strip() != (base_message or "").strip():
                diff = _diff_lines(base_message, new_message)
                if diff:
                    print("\nИзменения в сообщении (diff):")
                    print(diff)
                    print()
                http_put_json(
                    f"{BAND_BASE}/posts/{ping_post_id}/patch",
                    headers=band_headers_write(),
                    payload={"message": new_message},
                )

            if stream_order and all(
                stream_verified.get(s) for s in stream_order
            ):
                _pause_exit("\n[FINISH] Все стримы отмечены как OK.")
                return

            time.sleep(POLL_SECONDS)

    except KeyboardInterrupt:
        _pause_exit("\nОстановлено пользователем.")


if __name__ == "__main__":
    main()
