from __future__ import annotations

import bisect
import hashlib
import json
import math
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

import cv2
import mediapipe as mp
import numpy as np

from .experiments import ExperimentStore


Progress = Callable[[dict[str, Any]], None]
FACE_INDICES = {
    "blazepose33": tuple(range(11)),
    "coco17": tuple(range(5)),
}
SHOULDER_INDICES = {
    "blazepose33": (11, 12),
    "coco17": (5, 6),
}
COCO17_CONNECTIONS = {
    (0, 1), (0, 2), (1, 3), (2, 4), (5, 6), (5, 7), (7, 9),
    (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (11, 13),
    (13, 15), (12, 14), (14, 16),
}
_RTMPOSE_MODELS: dict[tuple[Any, ...], tuple[Any, Any]] = {}


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return max(0.0, self.right - self.left)

    @property
    def height(self) -> float:
        return max(0.0, self.bottom - self.top)

    @property
    def area(self) -> float:
        return self.width * self.height

    def interpolate(self, other: "Rect", fraction: float) -> "Rect":
        t = min(1.0, max(0.0, fraction))
        return Rect(
            self.left + (other.left - self.left) * t,
            self.top + (other.top - self.top) * t,
            self.right + (other.right - self.right) * t,
            self.bottom + (other.bottom - self.bottom) * t,
        )


@dataclass(frozen=True)
class BoxSample:
    frame_index: int
    seconds: float
    body: Rect | None
    face: Rect | None
    landmarks: list[dict[str, float]] | None
    face_source: str | None


@dataclass(frozen=True)
class ReliabilityWindow:
    index: int
    start_seconds: float
    end_seconds: float
    median_visible_joints: float
    residual_jump_p90: float | None
    bad: bool


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _model_hashes(detector: Path, landmark: Path) -> dict[str, str]:
    return {
        "detector_sha256": sha256(detector),
        "landmark_sha256": sha256(landmark),
    }


def install_models(detector: Path, landmark: Path) -> dict[str, str]:
    hashes = _model_hashes(detector, landmark)
    package_root = Path(mp.__file__).resolve().parent
    targets = {
        detector: package_root / "modules/pose_detection/pose_detection.tflite",
        landmark: package_root / "modules/pose_landmark/pose_landmark_lite.tflite",
    }
    for source, target in targets.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file() or sha256(target) != sha256(source):
            shutil.copy2(source, target)
        if sha256(target) != sha256(source):
            raise RuntimeError(f"checkpoint verification failed for {source.name}")
    return hashes


def open_video(path: Path) -> tuple[cv2.VideoCapture, float]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"could not open {path.name}")
    rotation = float(capture.get(cv2.CAP_PROP_ORIENTATION_META))
    capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    return capture, rotation


def _serialise_landmark(landmark: object) -> dict[str, Any]:
    def confidence(field: str) -> tuple[float, bool]:
        try:
            if landmark.HasField(field):  # type: ignore[attr-defined]
                return float(getattr(landmark, field)), True
        except (AttributeError, ValueError):
            pass
        # Legacy MediaPipe pose landmarks often omit presence entirely. Proto
        # scalar access returns 0 for an unset field, which must not be treated
        # as a real zero-confidence observation.
        return 1.0, False

    visibility, visibility_set = confidence("visibility")
    presence, presence_set = confidence("presence")

    return {
        "x": float(getattr(landmark, "x", 0.0)),
        "y": float(getattr(landmark, "y", 0.0)),
        "z": float(getattr(landmark, "z", 0.0)),
        "visibility": visibility,
        "presence": presence,
        "visibility_set": visibility_set,
        "presence_set": presence_set,
    }


def _cache_key(
    video: Path,
    model_hashes: dict[str, str],
    inference: dict[str, Any],
    schema: int = 3,
) -> str:
    stat = video.stat()
    payload = {
        "video_sha256": sha256(video),
        "size": stat.st_size,
        "models": model_hashes,
        "inference": inference,
        "schema": schema,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def scan_landmarks(
    video: Path,
    checkpoint: dict[str, Any],
    inference: dict[str, Any],
    cache_root: Path,
    progress: Progress,
) -> tuple[dict[str, Any], bool, dict[str, str]]:
    detector = checkpoint["detector"]
    landmark = checkpoint["landmark"]
    backend = checkpoint["backend"]
    keypoint_schema = checkpoint["keypoint_schema"]
    if backend == "mediapipe":
        model_hashes = install_models(detector, landmark)
    elif backend == "rtmpose":
        model_hashes = _model_hashes(detector, landmark)
    else:
        raise ValueError(f"unsupported checkpoint backend: {backend}")
    cache_inference = {
        **inference,
        "backend": backend,
        "keypoint_schema": keypoint_schema,
    }
    key = _cache_key(video, model_hashes, cache_inference, schema=3)
    cache_path = cache_root / f"{key}.json"
    if cache_path.is_file():
        progress({"stage": "landmarks-cache-hit", "message": f"Reusing landmarks for {video.name}"})
        return json.loads(cache_path.read_text(encoding="utf-8")), True, model_hashes

    # Schema 2 already contains correct coordinates/confidences but predates
    # the explicit proto-field-presence flags used by confidence labels. Migrate
    # it without rerunning the model. Schema 1 is deliberately not migrated: it
    # contains the original unset-presence serialization bug.
    previous_path = cache_root / f"{_cache_key(video, model_hashes, cache_inference, schema=2)}.json"
    if previous_path.is_file():
        payload = json.loads(previous_path.read_text(encoding="utf-8"))
        for sample in payload.get("samples", []):
            for item in sample.get("landmarks") or []:
                item["visibility_set"] = True
                item["presence_set"] = float(item.get("presence", 1.0)) != 1.0
        payload["schema"] = 3
        ExperimentStore.write_json(cache_path, payload)
        progress(
            {
                "stage": "landmarks-cache-hit",
                "message": f"Migrated cached landmarks for {video.name}",
            }
        )
        return payload, True, model_hashes

    capture, rotation = open_video(video)
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if fps <= 0 or frame_count <= 0:
        capture.release()
        raise RuntimeError(f"invalid video metadata for {video.name}")

    stride = inference["sample_stride_frames"]
    pose = None
    rtm_detector = None
    rtm_pose = None
    if backend == "mediapipe":
        pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=0,
            smooth_landmarks=inference["smooth_landmarks"],
            enable_segmentation=False,
            min_detection_confidence=inference["min_detection_confidence"],
            min_tracking_confidence=inference["min_tracking_confidence"],
        )
    else:
        rtm_detector, rtm_pose = _rtmpose_models(checkpoint, inference, model_hashes)
    samples: list[dict[str, Any]] = []
    display_width = 0
    display_height = 0
    started = time.monotonic()
    frame_index = 0
    try:
        while True:
            if frame_index % stride == 0:
                ok, frame = capture.read()
                if not ok:
                    break
                display_height, display_width = frame.shape[:2]
                scale = min(1.0, inference["max_dimension"] / max(display_width, display_height))
                if scale < 1.0:
                    pose_frame = cv2.resize(
                        frame,
                        (round(display_width * scale), round(display_height * scale)),
                        interpolation=cv2.INTER_AREA,
                    )
                else:
                    pose_frame = frame
                if backend == "mediapipe":
                    assert pose is not None
                    result = pose.process(cv2.cvtColor(pose_frame, cv2.COLOR_BGR2RGB))
                    landmarks = None
                    if result.pose_landmarks is not None:
                        landmarks = [
                            _serialise_landmark(item) for item in result.pose_landmarks.landmark
                        ]
                else:
                    assert rtm_detector is not None and rtm_pose is not None
                    landmarks = _rtmpose_landmarks(
                        frame, rtm_detector, rtm_pose, display_width, display_height
                    )
                samples.append(
                    {
                        "frame_index": frame_index,
                        "seconds": frame_index / fps,
                        "landmarks": landmarks,
                    }
                )
                progress(
                    {
                        "stage": "scanning",
                        "message": f"Pose scan: {video.name}",
                        "fraction": min(0.95, frame_index / max(1, frame_count)),
                    }
                )
            else:
                if not capture.grab():
                    break
            frame_index += 1
    finally:
        if pose is not None:
            pose.close()
        capture.release()

    if display_width <= 0 or display_height <= 0 or not samples:
        raise RuntimeError(f"no frames could be decoded from {video.name}")
    payload = {
        "schema": 3,
        "source": {
            "name": video.name,
            "sha256": sha256(video),
            "fps": fps,
            "frame_count": frame_count,
            "display_width": display_width,
            "display_height": display_height,
            "rotation_degrees": rotation,
        },
        "models": model_hashes,
        "backend": backend,
        "keypoint_schema": keypoint_schema,
        "inference": inference,
        "sample_count": len(samples),
        "detected_samples": sum(item["landmarks"] is not None for item in samples),
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "samples": samples,
    }
    ExperimentStore.write_json(cache_path, payload)
    return payload, False, model_hashes


def _rtmpose_models(
    checkpoint: dict[str, Any],
    inference: dict[str, Any],
    model_hashes: dict[str, str],
) -> tuple[Any, Any]:
    key = (
        model_hashes["detector_sha256"],
        model_hashes["landmark_sha256"],
        checkpoint["detector_input_size"],
        checkpoint["pose_input_size"],
        inference["min_detection_confidence"],
    )
    cached = _RTMPOSE_MODELS.get(key)
    if cached is not None:
        return cached
    try:
        from rtmlib import RTMDet, RTMPose
    except ImportError as error:
        raise RuntimeError(
            "RTMPose checkpoints require the pinned rtmlib and onnxruntime dependencies"
        ) from error
    detector = RTMDet(
        str(checkpoint["detector"]),
        model_input_size=checkpoint["detector_input_size"],
        det_mode="human",
        backend="onnxruntime",
        device="cpu",
        score_thr=inference["min_detection_confidence"],
    )
    pose = RTMPose(
        str(checkpoint["landmark"]),
        model_input_size=checkpoint["pose_input_size"],
        backend="onnxruntime",
        device="cpu",
    )
    _RTMPOSE_MODELS[key] = (detector, pose)
    return detector, pose


def _rtmpose_landmarks(
    frame: np.ndarray,
    detector: Any,
    pose: Any,
    width: int,
    height: int,
) -> list[dict[str, Any]] | None:
    boxes = np.asarray(detector(frame), dtype=np.float32).reshape(-1, 4)
    if boxes.size == 0:
        return None
    boxes[:, (0, 2)] = boxes[:, (0, 2)].clip(0, width - 1)
    boxes[:, (1, 3)] = boxes[:, (1, 3)].clip(0, height - 1)
    areas = np.maximum(0, boxes[:, 2] - boxes[:, 0]) * np.maximum(
        0, boxes[:, 3] - boxes[:, 1]
    )
    if not np.any(areas > 0):
        return None
    patient_box = boxes[[int(np.argmax(areas))]]
    keypoints, scores = pose(frame, bboxes=patient_box)
    if len(keypoints) == 0:
        return None
    points = np.asarray(keypoints[0], dtype=np.float32)
    confidence = np.asarray(scores[0], dtype=np.float32)
    return [
        {
            "x": float(point[0] / max(1, width)),
            "y": float(point[1] / max(1, height)),
            "z": 0.0,
            "visibility": float(score),
            "presence": 1.0,
            "visibility_set": True,
            "presence_set": False,
        }
        for point, score in zip(points, confidence)
    ]


def _visible_points(
    landmarks: Iterable[dict[str, float]], confidence: float
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for landmark in landmarks:
        if landmark.get("visibility", 1.0) < confidence:
            continue
        if landmark.get("presence", 1.0) < confidence:
            continue
        x = float(landmark["x"])
        y = float(landmark["y"])
        if not math.isfinite(x) or not math.isfinite(y):
            continue
        if not (-0.1 <= x <= 1.1 and -0.1 <= y <= 1.1):
            continue
        points.append((clamp(x), clamp(y)))
    return points


def _bounds(points: list[tuple[float, float]]) -> Rect:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return Rect(min(xs), min(ys), max(xs), max(ys))


def body_rect(landmarks: list[dict[str, float]], settings: dict[str, Any]) -> Rect | None:
    body = settings["body"]
    points = _visible_points(landmarks, settings["landmark_confidence"])
    if len(points) < body["min_points"]:
        return None
    bounds = _bounds(points)
    if (
        bounds.width < body["min_width"]
        or bounds.height < body["min_height"]
        or bounds.area < body["min_area"]
    ):
        return None
    return Rect(
        clamp(bounds.left - max(body["min_pad_x"], bounds.width * body["pad_x"])),
        clamp(bounds.top - max(body["min_pad_top"], bounds.height * body["pad_top"])),
        clamp(bounds.right + max(body["min_pad_x"], bounds.width * body["pad_x"])),
        clamp(
            bounds.bottom
            + max(body["min_pad_bottom"], bounds.height * body["pad_bottom"])
        ),
    )


def _scaled_height(rect: Rect, scale: float) -> Rect:
    padding = rect.height * max(0.0, scale - 1.0) / 2.0
    return Rect(rect.left, clamp(rect.top - padding), rect.right, clamp(rect.bottom + padding))


def _extended_upward(rect: Rect, fraction: float) -> Rect:
    return Rect(
        rect.left,
        clamp(rect.top - rect.height * max(0.0, fraction)),
        rect.right,
        rect.bottom,
    )


def face_rect(
    landmarks: list[dict[str, float]],
    body: Rect,
    frame_aspect: float,
    settings: dict[str, Any],
    keypoint_schema: str = "blazepose33",
) -> tuple[Rect, str]:
    face = settings["face"]
    face_indices = FACE_INDICES.get(keypoint_schema, FACE_INDICES["blazepose33"])
    points = _visible_points(
        (landmarks[index] for index in face_indices if index < len(landmarks)),
        settings["landmark_confidence"],
    )
    if len(points) >= face["min_points"]:
        bounds = _bounds(points)
        width = max(face["min_width"], bounds.width)
        height = max(face["min_height"], bounds.height)
        rect = Rect(
            clamp(bounds.left - width * face["pad_left"]),
            clamp(bounds.top - height * face["pad_top"]),
            clamp(bounds.right + width * face["pad_right"]),
            clamp(bounds.bottom + height * face["pad_bottom"]),
        )
        return _extended_upward(_scaled_height(rect, face["height_scale"]), 0.20), "landmarks"

    if face["shoulder_fallback"]:
        shoulder_indices = SHOULDER_INDICES.get(
            keypoint_schema, SHOULDER_INDICES["blazepose33"]
        )
        shoulders = _visible_points(
            (landmarks[index] for index in shoulder_indices if index < len(landmarks)),
            face["shoulder_confidence"],
        )
        if len(shoulders) == 2:
            shoulder_width = max(0.04, abs(shoulders[1][0] - shoulders[0][0]))
            head_width = min(0.45, max(0.08, shoulder_width * 0.68))
            head_height = min(0.42, max(0.08, head_width * max(0.25, frame_aspect) * 1.35))
            center_x = (shoulders[0][0] + shoulders[1][0]) / 2
            shoulder_y = (shoulders[0][1] + shoulders[1][1]) / 2
            bottom = min(1.0, shoulder_y + head_height * 0.12)
            rect = Rect(
                clamp(center_x - head_width * 0.60),
                clamp(bottom - head_height * 1.25),
                clamp(center_x + head_width * 0.60),
                bottom,
            )
            return _scaled_height(rect, face["height_scale"]), "shoulders"

    if face["top_body_fallback"]:
        aspect = max(0.25, frame_aspect)
        head_height = min(body.height * 0.34, max(0.08, body.width * aspect * 0.55))
        head_width = min(body.width * 0.65, max(0.08, head_height / aspect))
        center_x = (body.left + body.right) / 2
        rect = Rect(
            clamp(center_x - head_width / 2),
            body.top,
            clamp(center_x + head_width / 2),
            min(body.bottom, body.top + head_height),
        )
        return _scaled_height(rect, face["height_scale"]), "body-top"
    raise ValueError("face unavailable")


def _effective_confidence(landmark: dict[str, Any]) -> float:
    confidence = float(landmark.get("visibility", 1.0))
    if landmark.get("presence_set", False):
        confidence = min(confidence, float(landmark.get("presence", 1.0)))
    return confidence


def _torso_scale(points: np.ndarray, keypoint_schema: str) -> float:
    if keypoint_schema == "coco17":
        left_shoulder, right_shoulder, left_hip, right_hip = 5, 6, 11, 12
    else:
        left_shoulder, right_shoulder, left_hip, right_hip = 11, 12, 23, 24
    required = max(left_shoulder, right_shoulder, left_hip, right_hip)
    if len(points) <= required:
        return 0.05
    shoulder_width = np.linalg.norm(points[left_shoulder] - points[right_shoulder])
    hip_width = np.linalg.norm(points[left_hip] - points[right_hip])
    shoulder_mid = (points[left_shoulder] + points[right_shoulder]) / 2
    hip_mid = (points[left_hip] + points[right_hip]) / 2
    torso_height = np.linalg.norm(shoulder_mid - hip_mid)
    candidates = [0.05, shoulder_width, hip_width, torso_height]
    return float(max(value for value in candidates if math.isfinite(float(value))))


def classify_reliability_windows(
    landmark_payload: dict[str, Any], settings: dict[str, Any]
) -> list[ReliabilityWindow]:
    gate = settings["boxes"]["reliability_gate"]
    window_seconds = gate["window_seconds"]
    keypoint_schema = landmark_payload.get("keypoint_schema", "blazepose33")
    grouped: dict[int, list[dict[str, Any]]] = {}
    for sample in landmark_payload["samples"]:
        index = int(math.floor((float(sample["seconds"]) + 1e-9) / window_seconds))
        grouped.setdefault(index, []).append(sample)

    windows: list[ReliabilityWindow] = []
    for index, samples in sorted(grouped.items()):
        visible_counts = []
        residual_jumps: list[float] = []
        for sample in samples:
            landmarks = sample.get("landmarks") or []
            visible_counts.append(
                sum(
                    _effective_confidence(landmark) >= gate["visible_confidence"]
                    for landmark in landmarks
                )
            )

        for previous, current in zip(samples[:-1], samples[1:]):
            previous_landmarks = previous.get("landmarks") or []
            current_landmarks = current.get("landmarks") or []
            if not previous_landmarks or len(previous_landmarks) != len(current_landmarks):
                continue
            previous_points = np.asarray(
                [[landmark["x"], landmark["y"]] for landmark in previous_landmarks],
                dtype=float,
            )
            current_points = np.asarray(
                [[landmark["x"], landmark["y"]] for landmark in current_landmarks],
                dtype=float,
            )
            previous_confidence = np.asarray(
                [_effective_confidence(landmark) for landmark in previous_landmarks]
            )
            current_confidence = np.asarray(
                [_effective_confidence(landmark) for landmark in current_landmarks]
            )
            valid = (
                (previous_confidence >= gate["jump_confidence"])
                & (current_confidence >= gate["jump_confidence"])
                & np.all(np.isfinite(previous_points), axis=1)
                & np.all(np.isfinite(current_points), axis=1)
            )
            if np.count_nonzero(valid) < 2:
                continue
            displacement = current_points[valid] - previous_points[valid]
            global_displacement = np.median(displacement, axis=0)
            residual = np.linalg.norm(displacement - global_displacement, axis=1)
            scale = max(
                _torso_scale(previous_points, keypoint_schema),
                _torso_scale(current_points, keypoint_schema),
            )
            residual_jumps.extend((residual / scale).tolist())

        median_visible = float(np.median(visible_counts))
        residual_p90 = (
            float(np.percentile(residual_jumps, 90)) if residual_jumps else None
        )
        bad = (
            median_visible < gate["minimum_median_visible_joints"]
            and residual_p90 is not None
            and residual_p90 > gate["maximum_residual_jump_p90"]
        )
        windows.append(
            ReliabilityWindow(
                index=index,
                start_seconds=index * window_seconds,
                end_seconds=(index + 1) * window_seconds,
                median_visible_joints=median_visible,
                residual_jump_p90=residual_p90,
                bad=bad,
            )
        )
    return windows


def build_boxes(
    landmark_payload: dict[str, Any],
    settings: dict[str, Any],
    reliability_windows: list[ReliabilityWindow] | None = None,
) -> list[BoxSample]:
    box_settings = settings["boxes"]
    source = landmark_payload["source"]
    keypoint_schema = landmark_payload.get("keypoint_schema", "blazepose33")
    aspect = source["display_width"] / max(1, source["display_height"])
    samples: list[BoxSample] = []
    for item in landmark_payload["samples"]:
        landmarks = item["landmarks"]
        body = body_rect(landmarks, box_settings) if landmarks else None
        face = None
        face_source = None
        if landmarks and body is not None:
            try:
                face, face_source = face_rect(
                    landmarks, body, aspect, box_settings, keypoint_schema
                )
            except ValueError:
                pass
        samples.append(
            BoxSample(
                frame_index=item["frame_index"],
                seconds=item["seconds"],
                body=body,
                face=face,
                landmarks=landmarks,
                face_source=face_source,
            )
        )

    ratio = box_settings["body"]["outlier_median_ratio"]
    areas = sorted(sample.body.area for sample in samples if sample.body is not None)
    if areas and ratio > 0:
        median = areas[len(areas) // 2]
        samples = [
            sample
            if sample.body is not None and sample.body.area >= median * ratio
            else BoxSample(
                frame_index=sample.frame_index,
                seconds=sample.seconds,
                body=None,
                face=None,
                landmarks=sample.landmarks,
                face_source=None,
            )
            for sample in samples
        ]
    gate = box_settings["reliability_gate"]
    if gate["enabled"]:
        windows = reliability_windows or classify_reliability_windows(
            landmark_payload, settings
        )
        bad_indices = {window.index for window in windows if window.bad}
        window_seconds = gate["window_seconds"]
        samples = [
            BoxSample(
                frame_index=sample.frame_index,
                seconds=sample.seconds,
                body=None,
                face=None,
                landmarks=sample.landmarks,
                face_source=None,
            )
            if int(math.floor((sample.seconds + 1e-9) / window_seconds)) in bad_indices
            else sample
            for sample in samples
        ]
    return samples


def boxes_at(samples: list[BoxSample], seconds: float, mode: str) -> tuple[Rect | None, Rect | None]:
    if not samples:
        return None, None
    if seconds <= samples[0].seconds:
        return samples[0].body, samples[0].face
    if seconds >= samples[-1].seconds:
        return samples[-1].body, samples[-1].face
    times = [sample.seconds for sample in samples]
    after_index = bisect.bisect_right(times, seconds)
    before = samples[after_index - 1]
    after = samples[after_index]
    span = max(0.000001, after.seconds - before.seconds)
    fraction = (seconds - before.seconds) / span

    def interpolate(first: Rect | None, second: Rect | None) -> Rect | None:
        if first is not None and second is not None:
            return first.interpolate(second, fraction)
        if mode == "nearest":
            return first if fraction < 0.5 else second
        return None

    body = interpolate(before.body, after.body)
    face = interpolate(before.face, after.face) if body is not None else None
    return body, face


def _pixel_rect(rect: Rect, width: int, height: int) -> tuple[int, int, int, int]:
    return (
        max(0, min(width - 1, round(rect.left * width))),
        max(0, min(height - 1, round(rect.top * height))),
        max(0, min(width - 1, round(rect.right * width))),
        max(0, min(height - 1, round(rect.bottom * height))),
    )


def _draw_label(frame: np.ndarray, text: str, left: int, top: int, color: tuple[int, int, int]) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.48
    thickness = 1
    (width, height), baseline = cv2.getTextSize(text, font, scale, thickness)
    label_top = max(0, top - height - baseline - 7)
    cv2.rectangle(frame, (left, label_top), (left + width + 10, label_top + height + baseline + 6), color, -1)
    cv2.putText(frame, text, (left + 5, label_top + height + 2), font, scale, (10, 15, 22), thickness, cv2.LINE_AA)


def _raw_point(landmark: dict[str, Any], width: int, height: int) -> tuple[int, int] | None:
    x = float(landmark.get("x", math.nan))
    y = float(landmark.get("y", math.nan))
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    if not (-0.1 <= x <= 1.1 and -0.1 <= y <= 1.1):
        return None
    return round(clamp(x) * (width - 1)), round(clamp(y) * (height - 1))


def _confidence_color(landmark: dict[str, Any]) -> tuple[int, int, int]:
    confidence = float(landmark.get("visibility", 1.0))
    if landmark.get("presence_set", False):
        confidence = min(confidence, float(landmark.get("presence", 1.0)))
    confidence = min(1.0, max(0.0, confidence))
    # Piecewise BGR heatmap: red (0) -> yellow (0.5) -> green (1).
    # Keeping one channel fully saturated on each half makes mid-confidence
    # points visibly yellow instead of muddy brown/green.
    if confidence <= 0.5:
        red = 255
        green = round(510 * confidence)
    else:
        red = round(510 * (1.0 - confidence))
        green = 255
    return (24, green, red)


def _draw_raw_landmarks(
    frame: np.ndarray,
    sample: BoxSample,
    rendered_seconds: float,
    settings: dict[str, Any],
    keypoint_schema: str,
) -> None:
    landmarks = sample.landmarks or []
    height, width = frame.shape[:2]
    render = settings["render"]
    points = [_raw_point(landmark, width, height) for landmark in landmarks]

    if render["show_skeleton"]:
        connections = (
            COCO17_CONNECTIONS
            if keypoint_schema == "coco17"
            else mp.solutions.pose.POSE_CONNECTIONS
        )
        for first, second in connections:
            if first >= len(points) or second >= len(points):
                continue
            start = points[first]
            end = points[second]
            if start is not None and end is not None:
                cv2.line(frame, start, end, (235, 235, 235), 1, cv2.LINE_AA)

    for index, (landmark, point) in enumerate(zip(landmarks, points)):
        if point is None:
            continue
        color = _confidence_color(landmark)
        cv2.circle(frame, point, 4, (18, 22, 28), -1, cv2.LINE_AA)
        cv2.circle(frame, point, 3, color, -1, cv2.LINE_AA)
        parts: list[str] = []
        if render["show_landmark_indices"]:
            parts.append(str(index))
        if render["show_landmark_confidence"]:
            visibility = (
                f"{float(landmark.get('visibility', 1.0)):.2f}"
                if landmark.get("visibility_set", False)
                else "--"
            )
            presence = (
                f"{float(landmark.get('presence', 1.0)):.2f}"
                if landmark.get("presence_set", False)
                else "--"
            )
            parts.append(f"v{visibility}/p{presence}")
        if parts:
            label = " ".join(parts)
            x = min(width - 3, point[0] + 5)
            y = min(height - 3, max(10, point[1] + (10 if index % 2 else -5)))
            cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.27, (8, 10, 14), 2, cv2.LINE_AA)
            cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.27, color, 1, cv2.LINE_AA)

    delta_ms = round(abs(rendered_seconds - sample.seconds) * 1000)
    diagnostics = (
        f"RAW POSE sample frame {sample.frame_index}  delta {delta_ms} ms  "
        f"points {len(landmarks)}  {keypoint_schema}  label=id confidence"
    )
    cv2.rectangle(frame, (0, height - 49), (width, height), (12, 16, 22), -1)
    cv2.putText(
        frame,
        diagnostics,
        (7, height - 29),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.31,
        (240, 244, 248),
        1,
        cv2.LINE_AA,
    )
    legend = [
        (0.0, "0.0 low"),
        (0.5, "0.5"),
        (1.0, "1.0 high"),
    ]
    x = 9
    for confidence, label in legend:
        color = _confidence_color(
            {
                "visibility": confidence,
                "visibility_set": True,
                "presence": 1.0,
                "presence_set": False,
            }
        )
        cv2.circle(frame, (x, height - 12), 4, color, -1, cv2.LINE_AA)
        cv2.putText(
            frame,
            label,
            (x + 7, height - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.29,
            (225, 230, 235),
            1,
            cv2.LINE_AA,
        )
        x += 83
    cv2.putText(
        frame,
        "confidence = min(v,p); unset p is ignored",
        (x, height - 8),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.27,
        (180, 190, 200),
        1,
        cv2.LINE_AA,
    )


def render_overlay(
    video: Path,
    output: Path,
    landmark_payload: dict[str, Any],
    settings: dict[str, Any],
    progress: Progress,
) -> dict[str, Any]:
    gate = settings["boxes"]["reliability_gate"]
    reliability_windows = (
        classify_reliability_windows(landmark_payload, settings)
        if gate["enabled"]
        else []
    )
    samples = build_boxes(landmark_payload, settings, reliability_windows)
    reliability_by_index = {window.index: window for window in reliability_windows}
    keypoint_schema = landmark_payload.get("keypoint_schema", "blazepose33")
    capture, _ = open_video(video)
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, first = capture.read()
    if not ok:
        capture.release()
        raise RuntimeError(f"could not decode {video.name}")
    source_height, source_width = first.shape[:2]
    scale = min(1.0, settings["render"]["max_dimension"] / max(source_width, source_height))
    width = max(2, int(round(source_width * scale)) // 2 * 2)
    height = max(2, int(round(source_height * scale)) // 2 * 2)
    output.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
        "-r", f"{fps:.8f}", "-i", "-", "-i", str(video),
        "-map", "0:v:0", "-map", "1:a?", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest",
        "-movflags", "+faststart",
        str(output),
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if process.stdin is None or process.stderr is None:
        capture.release()
        raise RuntimeError("could not start ffmpeg overlay encoder")

    render = settings["render"]
    line_width = render["line_width"]
    body_color = (255, 209, 0)
    face_color = (102, 51, 255)
    frame_index = 0
    body_frames = 0
    face_frames = 0
    started = time.monotonic()
    frame = first
    try:
        while True:
            if scale < 1.0:
                rendered = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            else:
                rendered = frame.copy()
            body, face = boxes_at(samples, frame_index / fps, settings["interpolation"]["mode"])
            if body is not None:
                left, top, right, bottom = _pixel_rect(body, width, height)
                cv2.rectangle(rendered, (left, top), (right, bottom), body_color, line_width, cv2.LINE_AA)
                if render["show_labels"]:
                    _draw_label(rendered, "BODY", left, top, body_color)
                body_frames += 1
            if face is not None:
                left, top, right, bottom = _pixel_rect(face, width, height)
                cv2.rectangle(rendered, (left, top), (right, bottom), face_color, line_width, cv2.LINE_AA)
                if render["show_labels"]:
                    _draw_label(rendered, "FACE", left, top, face_color)
                face_frames += 1
            if render["show_landmarks"]:
                rendered_seconds = frame_index / fps
                nearest = min(samples, key=lambda item: abs(item.seconds - rendered_seconds))
                _draw_raw_landmarks(
                    rendered, nearest, rendered_seconds, settings, keypoint_schema
                )
            if gate["enabled"]:
                window_index = int(
                    math.floor((frame_index / fps + 1e-9) / gate["window_seconds"])
                )
                reliability = reliability_by_index.get(window_index)
                if reliability is not None and reliability.bad:
                    cv2.rectangle(rendered, (0, 0), (width, 38), (25, 25, 210), -1)
                    cv2.putText(
                        rendered,
                        "BAD 0.5s WINDOW - BODY + FACE BOXES OFF",
                        (10, 26),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.58,
                        (255, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )
            if render["show_missing"] and body is None:
                cv2.putText(rendered, "NO BODY BOX", (18, height - 58), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (40, 40, 255), 2, cv2.LINE_AA)
            process.stdin.write(rendered.tobytes())
            frame_index += 1
            if frame_index % 15 == 0:
                progress(
                    {
                        "stage": "rendering",
                        "message": f"Rendering overlay: {video.name}",
                        "fraction": min(0.99, frame_index / max(1, frame_count)),
                    }
                )
            ok, frame = capture.read()
            if not ok:
                break
    except (BrokenPipeError, OSError) as error:
        raise RuntimeError("ffmpeg stopped while encoding the overlay") from error
    finally:
        capture.release()
        try:
            process.stdin.close()
        except OSError:
            pass
    return_code = process.wait()
    stderr = process.stderr.read().decode("utf-8", errors="replace").strip()
    if return_code != 0:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg overlay encode failed: {stderr or return_code}")
    return {
        "frames_processed": frame_index,
        "frames_with_body_box": body_frames,
        "frames_with_face_box": face_frames,
        "body_sample_count": sum(sample.body is not None for sample in samples),
        "face_sample_count": sum(sample.face is not None for sample in samples),
        "face_sources": {
            source: sum(sample.face_source == source for sample in samples)
            for source in ("landmarks", "shoulders", "body-top")
        },
        "render_width": width,
        "render_height": height,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "reliability_gate": {
            "enabled": gate["enabled"],
            "window_count": len(reliability_windows),
            "bad_window_count": sum(window.bad for window in reliability_windows),
            "windows": [asdict(window) for window in reliability_windows],
        },
    }


class PoseExperimentRunner:
    def __init__(self, store: ExperimentStore) -> None:
        self.store = store

    def run(
        self,
        experiment_id: str,
        directory: Path,
        requested_name: str,
        video_names: list[str],
        checkpoint_id: str,
        settings: dict[str, Any],
        progress: Progress,
    ) -> dict[str, Any]:
        checkpoint = self.store.resolve_checkpoint(checkpoint_id)
        videos = [self.store.resolve_video(name) for name in video_names]
        manifest: dict[str, Any] = {
            "id": experiment_id,
            "name": requested_name.strip() or directory.name.split("--", 1)[1],
            "status": "running",
            "created_at": self.store.now(),
            "checkpoint": {"id": checkpoint_id},
            "settings": settings,
            "videos": video_names,
            "results": [],
        }
        self.store.write_json(directory / "manifest.json", manifest)
        started = time.monotonic()
        try:
            for index, video in enumerate(videos):
                progress(
                    {
                        "stage": "starting-video",
                        "message": f"Starting {video.name}",
                        "fraction": index / len(videos),
                        "video_index": index,
                        "video_count": len(videos),
                    }
                )

                def video_progress(update: dict[str, Any]) -> None:
                    local_fraction = float(update.get("fraction", 0.0))
                    stage = update.get("stage")
                    if stage == "scanning":
                        local_fraction *= 0.55
                    elif stage == "landmarks-cache-hit":
                        local_fraction = 0.55
                    elif stage == "rendering":
                        local_fraction = 0.55 + local_fraction * 0.45
                    progress(
                        {
                            **update,
                            "fraction": (index + min(1.0, max(0.0, local_fraction)))
                            / len(videos),
                            "video_index": index,
                            "video_count": len(videos),
                        }
                    )

                landmarks, cache_hit, model_hashes = scan_landmarks(
                    video,
                    checkpoint,
                    settings["inference"],
                    self.store.cache,
                    video_progress,
                )
                landmark_name = f"{video.stem}--landmarks.json"
                landmark_path = directory / "landmarks" / landmark_name
                self.store.write_json(landmark_path, landmarks)
                overlay_relative = f"overlays/{video.stem}--boxes.mp4"
                overlay_path = directory / overlay_relative
                stats = render_overlay(video, overlay_path, landmarks, settings, video_progress)
                report = {
                    "video": video.relative_to(self.store.root).as_posix(),
                    "source_sha256": landmarks["source"]["sha256"],
                    "landmark_cache_hit": cache_hit,
                    "models": model_hashes,
                    "landmark_file": f"landmarks/{landmark_name}",
                    "overlay": overlay_relative,
                    "stats": stats,
                }
                self.store.write_json(directory / "reports" / f"{video.stem}.json", report)
                manifest["results"].append(report)
                self.store.write_json(directory / "manifest.json", manifest)
            manifest["status"] = "completed"
            manifest["completed_at"] = self.store.now()
            manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self.store.write_json(directory / "manifest.json", manifest)
            progress({"stage": "completed", "message": f"Completed {experiment_id}", "fraction": 1.0})
            return manifest
        except Exception as error:
            manifest["status"] = "failed"
            manifest["failed_at"] = self.store.now()
            manifest["error"] = str(error)
            manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self.store.write_json(directory / "manifest.json", manifest)
            raise
