from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import automatic_experiment_name, slugify


VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v", ".avi", ".webm"}


class ExperimentStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.outputs = self.root / "outputs"
        self.checkpoints = self.root / "checkpoints"
        self.cache = self.root / ".cache" / "landmarks"
        self.outputs.mkdir(parents=True, exist_ok=True)
        self.checkpoints.mkdir(parents=True, exist_ok=True)
        self.cache.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def videos(self) -> list[dict[str, Any]]:
        videos: list[dict[str, Any]] = []
        for path in sorted(self.root.rglob("*"), key=lambda item: item.name.lower()):
            if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            if self.outputs in path.parents or self.checkpoints in path.parents:
                continue
            relative = path.relative_to(self.root).as_posix()
            stat = path.stat()
            videos.append(
                {
                    "name": relative,
                    "size_bytes": stat.st_size,
                    "modified_ns": stat.st_mtime_ns,
                }
            )
        return videos

    def resolve_video(self, relative: str) -> Path:
        candidate = (self.root / relative).resolve()
        if self.root not in candidate.parents or not candidate.is_file():
            raise ValueError(f"unknown source video: {relative}")
        if candidate.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError(f"unsupported source video: {relative}")
        if self.outputs in candidate.parents or self.checkpoints in candidate.parents:
            raise ValueError(f"source video is outside the sample area: {relative}")
        return candidate

    def checkpoint_catalog(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for directory in sorted(path for path in self.checkpoints.iterdir() if path.is_dir()):
            manifest_path = directory / "checkpoint.json"
            if manifest_path.is_file():
                try:
                    checkpoint = self._resolve_manifest_checkpoint(directory, manifest_path)
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                entries.append(
                    {
                        "id": directory.name,
                        "backend": checkpoint["backend"],
                        "detector": checkpoint["detector"].name,
                        "landmark": checkpoint["landmark"].name,
                        "keypoint_schema": checkpoint["keypoint_schema"],
                    }
                )
                continue
            detector = directory / "pose_detection.tflite"
            landmark = directory / "pose_landmark_lite.tflite"
            if detector.is_file() and landmark.is_file():
                entries.append(
                    {
                        "id": directory.name,
                        "backend": "mediapipe",
                        "detector": detector.name,
                        "landmark": landmark.name,
                        "keypoint_schema": "blazepose33",
                    }
                )
        return entries

    def _resolve_manifest_checkpoint(
        self, directory: Path, manifest_path: Path
    ) -> dict[str, Any]:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("backend") != "rtmpose":
            raise ValueError("unsupported checkpoint manifest")

        def resolve_file(field: str) -> Path:
            relative = manifest.get(field)
            if not isinstance(relative, str) or not relative:
                raise ValueError(f"checkpoint manifest requires {field}")
            candidate = (directory / relative).resolve()
            if directory not in candidate.parents or not candidate.is_file():
                raise ValueError(f"invalid checkpoint file: {field}")
            return candidate

        detector_size = manifest.get("detector_input_size")
        pose_size = manifest.get("pose_input_size")
        if (
            not isinstance(detector_size, list)
            or len(detector_size) != 2
            or not all(isinstance(value, int) and value > 0 for value in detector_size)
            or not isinstance(pose_size, list)
            or len(pose_size) != 2
            or not all(isinstance(value, int) and value > 0 for value in pose_size)
        ):
            raise ValueError("checkpoint input sizes must be positive [width,height] pairs")
        return {
            "backend": "rtmpose",
            "detector": resolve_file("detector"),
            "landmark": resolve_file("pose"),
            "detector_input_size": tuple(detector_size),
            "pose_input_size": tuple(pose_size),
            "keypoint_schema": manifest.get("keypoint_schema", "coco17"),
        }

    def resolve_checkpoint(self, checkpoint_id: str) -> dict[str, Any]:
        directory = (self.checkpoints / checkpoint_id).resolve()
        if self.checkpoints not in directory.parents or not directory.is_dir():
            raise ValueError(f"unknown checkpoint: {checkpoint_id}")
        manifest_path = directory / "checkpoint.json"
        if manifest_path.is_file():
            return self._resolve_manifest_checkpoint(directory, manifest_path)
        detector = directory / "pose_detection.tflite"
        landmark = directory / "pose_landmark_lite.tflite"
        if not detector.is_file() or not landmark.is_file():
            raise ValueError(
                "checkpoint folder must contain pose_detection.tflite and "
                "pose_landmark_lite.tflite"
            )
        return {
            "backend": "mediapipe",
            "detector": detector,
            "landmark": landmark,
            "keypoint_schema": "blazepose33",
        }

    def allocate(self, requested_name: str, settings: dict[str, Any]) -> tuple[str, Path]:
        with self._lock:
            largest = 0
            for directory in self.outputs.glob("exp-[0-9][0-9][0-9][0-9]--*"):
                try:
                    largest = max(largest, int(directory.name[4:8]))
                except ValueError:
                    continue
            experiment_id = f"exp-{largest + 1:04d}"
            label = requested_name.strip() or automatic_experiment_name(settings)
            directory = self.outputs / f"{experiment_id}--{slugify(label)}"
            directory.mkdir(parents=False, exist_ok=False)
            (directory / "overlays").mkdir()
            (directory / "landmarks").mkdir()
            (directory / "reports").mkdir()
        return experiment_id, directory

    @staticmethod
    def write_json(path: Path, value: object) -> None:
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)

    def experiments(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for directory in sorted(self.outputs.glob("exp-*--*"), reverse=True):
            manifest_path = directory / "manifest.json"
            if not manifest_path.is_file():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            manifest["directory"] = directory.name
            for result in manifest.get("results", []):
                overlay = result.get("overlay")
                if overlay:
                    result["overlay_url"] = f"/media/output/{directory.name}/{overlay}"
            items.append(manifest)
        return items

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()
