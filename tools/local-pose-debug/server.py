#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import threading
import urllib.parse
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from pose_debug import DEFAULT_SETTINGS, ExperimentStore, PoseExperimentRunner, normalize_settings


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "static"
DEFAULT_EXPERIMENT_ROOT = ROOT.parents[1] / "test_local_pose_estimatino"


class Jobs:
    def __init__(self, store: ExperimentStore) -> None:
        self.store = store
        self.runner = PoseExperimentRunner(store)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pose-debug")
        self.lock = threading.RLock()
        self.values: dict[str, dict[str, Any]] = {}

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            value = self.values.get(job_id)
            return json.loads(json.dumps(value)) if value else None

    def _update(self, job_id: str, update: dict[str, Any]) -> None:
        with self.lock:
            self.values[job_id].update(update)

    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        videos = payload.get("videos")
        if not isinstance(videos, list) or not videos or not all(isinstance(item, str) for item in videos):
            raise ValueError("select at least one video")
        if len(videos) > 100:
            raise ValueError("a run may contain at most 100 videos")
        checkpoint_id = payload.get("checkpoint")
        if not isinstance(checkpoint_id, str) or not checkpoint_id:
            raise ValueError("select a checkpoint")
        self.store.resolve_checkpoint(checkpoint_id)
        for video in videos:
            self.store.resolve_video(video)
        requested_name = payload.get("name", "")
        if not isinstance(requested_name, str) or len(requested_name) > 120:
            raise ValueError("experiment name must be 120 characters or fewer")
        settings = normalize_settings(payload.get("settings"))
        experiment_id, directory = self.store.allocate(requested_name, settings)
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "status": "queued",
            "experiment_id": experiment_id,
            "directory": directory.name,
            "stage": "queued",
            "message": f"Queued {experiment_id}",
            "fraction": 0,
        }
        with self.lock:
            self.values[job_id] = job

        def work() -> None:
            self._update(job_id, {"status": "running"})

            def progress(update: dict[str, Any]) -> None:
                self._update(job_id, update)

            try:
                self.runner.run(
                    experiment_id,
                    directory,
                    requested_name,
                    videos,
                    checkpoint_id,
                    settings,
                    progress,
                )
                self._update(job_id, {"status": "completed", "fraction": 1.0})
            except Exception as error:
                self._update(
                    job_id,
                    {"status": "failed", "stage": "failed", "message": str(error), "error": str(error)},
                )

        self.executor.submit(work)
        return job


class Handler(SimpleHTTPRequestHandler):
    store: ExperimentStore
    jobs: Jobs

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def json_response(self, value: object, status: int = 200) -> None:
        payload = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("invalid content length") from error
        if length <= 0 or length > 1_000_000:
            raise ValueError("request body is empty or too large")
        try:
            value = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("request body is not valid JSON") from error
        if not isinstance(value, dict):
            raise ValueError("request body must be an object")
        return value

    def _state(self) -> dict[str, Any]:
        return {
            "root": str(self.store.root),
            "videos": self.store.videos(),
            "checkpoints": self.store.checkpoint_catalog(),
            "defaults": DEFAULT_SETTINGS,
            "experiments": self.store.experiments(),
        }

    def _resolve_output(self, relative: str) -> Path | None:
        candidate = (self.store.outputs / urllib.parse.unquote(relative)).resolve()
        if self.store.outputs not in candidate.parents or not candidate.is_file():
            return None
        return candidate

    def _resolve_source(self, relative: str) -> Path | None:
        try:
            return self.store.resolve_video(urllib.parse.unquote(relative))
        except ValueError:
            return None

    def send_file_range(self, path: Path, send_body: bool = True) -> None:
        size = path.stat().st_size
        start = 0
        end = size - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            raw = range_header[6:].split(",", 1)[0]
            left, _, right = raw.partition("-")
            try:
                if left:
                    start = int(left)
                    end = int(right) if right else end
                elif right:
                    start = max(0, size - int(right))
            except ValueError:
                self.send_error(416)
                return
            if start < 0 or start >= size or end < start:
                self.send_error(416)
                return
            end = min(end, size - 1)
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not send_body:
            return
        remaining = end - start + 1
        try:
            with path.open("rb") as handle:
                handle.seek(start)
                while remaining:
                    chunk = handle.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def route_get(self, send_body: bool = True) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/state":
            self.json_response(self._state())
            return
        if parsed.path.startswith("/api/jobs/"):
            job = self.jobs.get(parsed.path.rsplit("/", 1)[-1])
            self.json_response(job or {"error": "unknown job"}, 200 if job else 404)
            return
        if parsed.path.startswith("/media/source/"):
            path = self._resolve_source(parsed.path.removeprefix("/media/source/"))
            if path is None:
                self.send_error(404)
            else:
                self.send_file_range(path, send_body)
            return
        if parsed.path.startswith("/media/output/"):
            path = self._resolve_output(parsed.path.removeprefix("/media/output/"))
            if path is None:
                self.send_error(404)
            else:
                self.send_file_range(path, send_body)
            return
        if send_body:
            super().do_GET()
        else:
            super().do_HEAD()

    def do_GET(self) -> None:  # noqa: N802
        self.route_get(True)

    def do_HEAD(self) -> None:  # noqa: N802
        self.route_get(False)

    def do_POST(self) -> None:  # noqa: N802
        try:
            if self.path == "/api/runs":
                self.json_response(self.jobs.submit(self.read_json()), 202)
                return
            if self.path == "/api/reveal":
                payload = self.read_json()
                directory_name = payload.get("directory")
                if not isinstance(directory_name, str):
                    raise ValueError("directory is required")
                directory = (self.store.outputs / directory_name).resolve()
                if self.store.outputs not in directory.parents or not directory.is_dir():
                    raise ValueError("unknown experiment directory")
                subprocess.Popen(["open", str(directory)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.json_response({"status": "ok"})
                return
            self.json_response({"error": "not found"}, 404)
        except ValueError as error:
            self.json_response({"error": str(error)}, 400)
        except Exception as error:
            self.json_response({"error": str(error)}, 500)


def main() -> None:
    parser = argparse.ArgumentParser(description="Luche local pose-box experiment service")
    parser.add_argument("--root", type=Path, default=Path(os.getenv("LUCHE_POSE_EXPERIMENT_ROOT", DEFAULT_EXPERIMENT_ROOT)))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    store = ExperimentStore(args.root)
    jobs = Jobs(store)
    class BoundHandler(Handler):
        pass

    BoundHandler.store = store
    BoundHandler.jobs = jobs
    server = ThreadingHTTPServer((args.host, args.port), BoundHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"Luche pose debug service: {url}")
    print(f"Experiment root: {store.root}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
