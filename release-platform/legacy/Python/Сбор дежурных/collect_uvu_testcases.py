#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Collect UwU values for all test cases in Allure project and save JSON nearby.

Source endpoints:
  - /api/testcasetree/leaf?projectId=7&sort=name,asc&size=1000&page=...
  - /api/testcase/{id}/overview

Auth:
  - Api-Token from existing UWU build/scripts.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


BASE_URL = "https://allure-testops.wb.ru"
PROJECT_ID = 7
PAGE_SIZE = 1000
MAX_PAGES_GUARD = 200
MAX_WORKERS = 100
REQUEST_TIMEOUT = 30
RETRIES = 3
RETRY_SLEEP_SEC = 1.0

# Api token from current UWU build/scripts in this repository.
ALLURE_API_TOKEN = "c60f6235-440d-4657-983a-51dc71c53cf2"

OUTPUT_FILE_NAME = "uvu_testcases.json"
_THREAD_LOCAL = threading.local()
LOGGER = logging.getLogger("collect_uvu")


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )


class ProgressBar:
    def __init__(self, total: int, label: str, width: int = 36) -> None:
        self.total = max(0, int(total))
        self.label = label
        self.width = max(10, int(width))
        self._last_print_ts = 0.0
        self._last_done = -1

    def _render(self, done: int) -> str:
        if self.total <= 0:
            bar = "-" * self.width
            return f"{self.label} [{bar}] 0/0 (100.0%)"
        ratio = min(max(done / self.total, 0.0), 1.0)
        filled = int(ratio * self.width)
        bar = "#" * filled + "-" * (self.width - filled)
        return f"{self.label} [{bar}] {done}/{self.total} ({ratio * 100:5.1f}%)"

    def update(self, done: int, force: bool = False) -> None:
        done = min(max(0, int(done)), self.total)
        now = time.time()
        should_print = force or done == self.total or (now - self._last_print_ts) >= 0.08
        if not should_print or (done == self._last_done and not force):
            return
        print(f"\r{self._render(done)}", end="", flush=True)
        self._last_print_ts = now
        self._last_done = done
        if done == self.total:
            print("", flush=True)


def _auth_header(token: str) -> Dict[str, str]:
    token = (token or "").strip()
    if not token:
        raise ValueError("ALLURE_API_TOKEN is empty")
    if token.lower().startswith("api-token ") or token.lower().startswith("bearer "):
        auth_value = token
    else:
        auth_value = f"Api-Token {token}"
    return {
        "accept": "application/json",
        "authorization": auth_value,
    }


def _extract_field_value(cf: Dict[str, Any]) -> Optional[str]:
    direct = cf.get("name")
    if direct is not None and str(direct).strip():
        return str(direct).strip()

    values = cf.get("values")
    if isinstance(values, list) and values:
        first = values[0]
        if isinstance(first, dict):
            name = first.get("name")
            if name is not None and str(name).strip():
                return str(name).strip()
        elif first is not None and str(first).strip():
            return str(first).strip()
    return None


def _parse_uwu_number(raw: Optional[str]) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip()
    if not s or s == "0":
        return 0.0
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return 0.0


def _http_get_json(session: requests.Session, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{BASE_URL}{path}"
    last_err: Optional[Exception] = None
    for attempt in range(1, RETRIES + 1):
        try:
            resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code >= 500:
                resp.raise_for_status()
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            last_err = exc
            if attempt < RETRIES:
                time.sleep(RETRY_SLEEP_SEC * attempt)
            else:
                raise
    raise RuntimeError(f"Unexpected HTTP failure: {last_err}")


def _extract_leaf_content(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, list):
            return [x for x in content if isinstance(x, dict)]
        leafs = data.get("leafs")
        if isinstance(leafs, list):
            return [x for x in leafs if isinstance(x, dict)]
        return []
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def list_testcases_leaf(session: requests.Session) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    page = 0
    pages_loaded = 0
    while page < MAX_PAGES_GUARD:
        data = _http_get_json(
            session,
            "/api/testcasetree/leaf",
            params={
                "projectId": PROJECT_ID,
                "sort": "name,asc",
                "size": PAGE_SIZE,
                "page": page,
            },
        )

        content = _extract_leaf_content(data)
        if not content:
            break
        out.extend(content)
        pages_loaded += 1
        LOGGER.info(
            "Stage 1: page %s loaded (+%s rows, total=%s)",
            page + 1,
            len(content),
            len(out),
        )

        total_pages = data.get("totalPages") if isinstance(data, dict) else None
        last = data.get("last") if isinstance(data, dict) else None
        if last is True:
            break
        if isinstance(total_pages, int) and page >= (total_pages - 1):
            break
        if len(content) < PAGE_SIZE and total_pages is None and last is None:
            break
        page += 1
    LOGGER.info("Stage 1 complete: pages=%s, leaf rows=%s", pages_loaded, len(out))
    return out


def _extract_testcase_id(leaf: Dict[str, Any]) -> Optional[int]:
    for key in ("testCaseId", "id"):
        v = leaf.get(key)
        if v is None:
            continue
        try:
            return int(v)
        except Exception:
            continue
    return None


def unique_testcases(leaf_items: Iterable[Dict[str, Any]]) -> List[Tuple[int, str]]:
    seen: Dict[int, str] = {}
    for it in leaf_items:
        tcid = _extract_testcase_id(it)
        if tcid is None:
            continue
        name = str(it.get("name") or it.get("title") or "").strip()
        if tcid not in seen:
            seen[tcid] = name
    return [(tcid, seen[tcid]) for tcid in sorted(seen.keys())]


def _worker_session() -> requests.Session:
    sess = getattr(_THREAD_LOCAL, "session", None)
    if sess is None:
        sess = requests.Session()
        sess.headers.update(_auth_header(ALLURE_API_TOKEN))
        _THREAD_LOCAL.session = sess
    return sess


def fetch_overview_uwu(tcid: int) -> Dict[str, Any]:
    session = _worker_session()
    data = _http_get_json(session, f"/api/testcase/{tcid}/overview", params={})
    custom_fields = data.get("customFields") if isinstance(data, dict) else []
    if not isinstance(custom_fields, list):
        custom_fields = []

    uwu_raw: Optional[str] = None
    platform: Optional[str] = None

    for cf in custom_fields:
        if not isinstance(cf, dict):
            continue
        cf_info = cf.get("customField")
        cf_name = ""
        if isinstance(cf_info, dict):
            cf_name = str(cf_info.get("name") or "").strip()

        if cf_name == "UwU":
            uwu_raw = _extract_field_value(cf)
        elif cf_name == "Platform":
            platform = _extract_field_value(cf)

    return {
        "uwuRaw": uwu_raw,
        "uwuNumber": _parse_uwu_number(uwu_raw),
        "platform": platform,
    }


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(_auth_header(ALLURE_API_TOKEN))
    return s


def main() -> None:
    setup_logging()
    started_at = time.perf_counter()

    session = make_session()

    LOGGER.info("Stage 1/4: loading test cases from /api/testcasetree/leaf ...")
    leaf_items = list_testcases_leaf(session)
    LOGGER.info("Leaf rows loaded: %s", len(leaf_items))

    LOGGER.info("Stage 2/4: preparing unique test cases ...")
    testcases = unique_testcases(leaf_items)
    LOGGER.info("Unique test cases prepared: %s", len(testcases))

    LOGGER.info(
        "Stage 3/4: loading /api/testcase/{id}/overview in %s threads and extracting UwU ...",
        MAX_WORKERS,
    )
    records: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    progress = ProgressBar(total=len(testcases), label="Overview fetch")
    progress.update(0, force=True)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_map = {
            pool.submit(fetch_overview_uwu, tcid): (tcid, name)
            for tcid, name in testcases
        }
        done_count = 0
        for fut in as_completed(future_map):
            tcid, name = future_map[fut]
            try:
                payload = fut.result()
                records.append(
                    {
                        "testCaseId": tcid,
                        "name": name,
                        "uwuRaw": payload["uwuRaw"],
                        "uwuNumber": payload["uwuNumber"],
                        "platform": payload["platform"],
                    }
                )
            except Exception as exc:
                errors.append({"testCaseId": tcid, "error": str(exc)})
            done_count += 1
            progress.update(done_count)

    progress.update(len(testcases), force=True)
    LOGGER.info(
        "Stage 3 complete: processed=%s, success=%s, errors=%s",
        len(testcases),
        len(records),
        len(errors),
    )

    records.sort(key=lambda x: x["testCaseId"])

    with_uwu = sum(1 for r in records if r.get("uwuRaw") not in (None, "", "0"))
    out_obj = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "baseUrl": BASE_URL,
        "projectId": PROJECT_ID,
        "totalTestCases": len(records),
        "withUwU": with_uwu,
        "items": records,
        "errors": errors,
    }

    LOGGER.info("Stage 4/4: writing output JSON ...")
    out_path = Path(__file__).resolve().with_name(OUTPUT_FILE_NAME)
    out_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    elapsed_sec = time.perf_counter() - started_at
    LOGGER.info("Done in %.1f sec", elapsed_sec)
    LOGGER.info("Saved: %s", out_path)
    LOGGER.info("UwU filled: %s/%s", with_uwu, len(records))
    if errors:
        LOGGER.warning("Errors: %s (see 'errors' in JSON)", len(errors))


if __name__ == "__main__":
    main()
