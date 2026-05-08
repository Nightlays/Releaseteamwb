#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
TRAIN_SCRIPT = ROOT_DIR / "tools" / "train_catboost_onnx.py"
BUNDLE_PATH = ROOT_DIR / "ml" / "catboost_release_risk.bundle.js"
META_PATH = ROOT_DIR / "ml" / "catboost_release_risk.meta.json"
HOST = "127.0.0.1"
PORT = 8788
LOCK = threading.Lock()


def read_bundle_payload():
    if not BUNDLE_PATH.exists():
        return None
    raw = BUNDLE_PATH.read_text(encoding="utf-8").strip()
    prefix = "window.WB_CATBOOST_ONNX_MODEL = "
    if not raw.startswith(prefix):
        raise ValueError("Unexpected bundle format")
    payload = raw[len(prefix):].rstrip("; \n\t")
    return json.loads(payload)


def read_meta_payload():
    if not META_PATH.exists():
        return None
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def parse_publish_state(stdout):
    published = None
    publish_error = ""
    match = re.search(r"Published to Drive:\s*(yes|no)", stdout or "", re.IGNORECASE)
    if match:
        published = match.group(1).lower() == "yes"
    error_match = re.search(r"Publish error:\s*(.+)", stdout or "")
    if error_match:
        publish_error = error_match.group(1).strip()
    return published, publish_error


def build_status():
    meta = read_meta_payload()
    return {
        "ok": True,
        "service": "wb-ml-retrain-helper",
        "busy": LOCK.locked(),
        "rootDir": str(ROOT_DIR),
        "python": sys.executable,
        "trainScript": str(TRAIN_SCRIPT),
        "bundleExists": BUNDLE_PATH.exists(),
        "meta": meta,
        "commandHints": {
            "helper": "./tools/run_ml_retrain_helper.sh",
            "retrain": "./tools/retrain_catboost.sh",
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "WBMlRetrainHelper/1.0"

    def log_message(self, fmt, *args):
        return

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/health", "/api/ml/health", "/api/ml/status"):
            self._send_json(200, build_status())
            return
        self._send_json(404, {"ok": False, "error": f"Unknown path: {path}"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/ml/retrain":
            self._send_json(404, {"ok": False, "error": f"Unknown path: {path}"})
            return
        if LOCK.locked():
            self._send_json(409, {
                "ok": False,
                "error": "Retrain уже выполняется",
                "commandHints": build_status()["commandHints"],
            })
            return

        started = time.time()
        with LOCK:
            try:
                proc = subprocess.run(
                    [sys.executable, str(TRAIN_SCRIPT), "--publish-drive"],
                    cwd=str(ROOT_DIR),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                duration_ms = int((time.time() - started) * 1000)
                if proc.returncode != 0:
                    self._send_json(500, {
                        "ok": False,
                        "error": "Retrain завершился с ошибкой",
                        "exitCode": proc.returncode,
                        "stdout": proc.stdout,
                        "stderr": proc.stderr,
                        "durationMs": duration_ms,
                        "commandHints": build_status()["commandHints"],
                    })
                    return

                bundle = read_bundle_payload()
                meta = read_meta_payload()
                published_to_drive, publish_error = parse_publish_state(proc.stdout)
                self._send_json(200, {
                    "ok": True,
                    "message": "CatBoost переобучен",
                    "stdout": proc.stdout,
                    "stderr": proc.stderr,
                    "durationMs": duration_ms,
                    "bundle": bundle,
                    "meta": meta,
                    "publishedToDrive": published_to_drive,
                    "publishError": publish_error,
                    "commandHints": build_status()["commandHints"],
                })
            except Exception as exc:
                self._send_json(500, {
                    "ok": False,
                    "error": str(exc),
                    "commandHints": build_status()["commandHints"],
                })


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"WB ML retrain helper listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
