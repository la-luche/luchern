from __future__ import annotations

import copy
import re
from typing import Any


DEFAULT_SETTINGS: dict[str, Any] = {
    "inference": {
        "sample_stride_frames": 3,
        "max_dimension": 512,
        "min_detection_confidence": 0.5,
        "min_tracking_confidence": 0.5,
        "smooth_landmarks": True,
    },
    "boxes": {
        "landmark_confidence": 0.25,
        "body": {
            "min_points": 6,
            "min_width": 0.10,
            "min_height": 0.15,
            "min_area": 0.02,
            "pad_x": 0.32,
            "pad_top": 0.22,
            "pad_bottom": 0.18,
            "min_pad_x": 0.10,
            "min_pad_top": 0.08,
            "min_pad_bottom": 0.10,
            "outlier_median_ratio": 0.25,
        },
        "face": {
            "min_points": 3,
            "min_width": 0.025,
            "min_height": 0.035,
            "pad_left": 0.40,
            "pad_top": 0.85,
            "pad_right": 0.40,
            "pad_bottom": 0.60,
            "height_scale": 2.0,
            "shoulder_fallback": True,
            "top_body_fallback": True,
            "shoulder_confidence": 0.10,
        },
    },
    "interpolation": {
        "mode": "strict",
    },
    "render": {
        "max_dimension": 960,
        "line_width": 3,
        "show_landmarks": True,
        "show_skeleton": True,
        "show_landmark_indices": True,
        "show_landmark_confidence": True,
        "show_labels": True,
        "show_missing": True,
    },
}


NUMERIC_RULES: dict[tuple[str, ...], tuple[float, float, type]] = {
    ("inference", "sample_stride_frames"): (1, 60, int),
    ("inference", "max_dimension"): (128, 2048, int),
    ("inference", "min_detection_confidence"): (0, 1, float),
    ("inference", "min_tracking_confidence"): (0, 1, float),
    ("boxes", "landmark_confidence"): (0, 1, float),
    ("boxes", "body", "min_points"): (1, 33, int),
    ("boxes", "body", "min_width"): (0, 1, float),
    ("boxes", "body", "min_height"): (0, 1, float),
    ("boxes", "body", "min_area"): (0, 1, float),
    ("boxes", "body", "pad_x"): (0, 3, float),
    ("boxes", "body", "pad_top"): (0, 3, float),
    ("boxes", "body", "pad_bottom"): (0, 3, float),
    ("boxes", "body", "min_pad_x"): (0, 1, float),
    ("boxes", "body", "min_pad_top"): (0, 1, float),
    ("boxes", "body", "min_pad_bottom"): (0, 1, float),
    ("boxes", "body", "outlier_median_ratio"): (0, 1, float),
    ("boxes", "face", "min_points"): (1, 11, int),
    ("boxes", "face", "min_width"): (0, 1, float),
    ("boxes", "face", "min_height"): (0, 1, float),
    ("boxes", "face", "pad_left"): (0, 4, float),
    ("boxes", "face", "pad_top"): (0, 4, float),
    ("boxes", "face", "pad_right"): (0, 4, float),
    ("boxes", "face", "pad_bottom"): (0, 4, float),
    ("boxes", "face", "height_scale"): (0.25, 5, float),
    ("boxes", "face", "shoulder_confidence"): (0, 1, float),
    ("render", "max_dimension"): (320, 3840, int),
    ("render", "line_width"): (1, 12, int),
}

BOOLEAN_PATHS = {
    ("inference", "smooth_landmarks"),
    ("boxes", "face", "shoulder_fallback"),
    ("boxes", "face", "top_body_fallback"),
    ("render", "show_landmarks"),
    ("render", "show_skeleton"),
    ("render", "show_landmark_indices"),
    ("render", "show_landmark_confidence"),
    ("render", "show_labels"),
    ("render", "show_missing"),
}


def _deep_merge(target: dict[str, Any], source: dict[str, Any], path: tuple[str, ...] = ()) -> None:
    for key, value in source.items():
        next_path = (*path, key)
        if key not in target:
            raise ValueError(f"unknown setting: {'.'.join(next_path)}")
        if isinstance(target[key], dict):
            if not isinstance(value, dict):
                raise ValueError(f"{'.'.join(next_path)} must be an object")
            _deep_merge(target[key], value, next_path)
        else:
            target[key] = value


def _get(settings: dict[str, Any], path: tuple[str, ...]) -> Any:
    value: Any = settings
    for key in path:
        value = value[key]
    return value


def _set(settings: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    target: Any = settings
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value


def normalize_settings(raw: object | None) -> dict[str, Any]:
    settings = copy.deepcopy(DEFAULT_SETTINGS)
    if raw is not None:
        if not isinstance(raw, dict):
            raise ValueError("settings must be an object")
        _deep_merge(settings, raw)

    for path, (minimum, maximum, target_type) in NUMERIC_RULES.items():
        value = _get(settings, path)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{'.'.join(path)} must be numeric")
        converted = target_type(value)
        if not minimum <= converted <= maximum:
            raise ValueError(
                f"{'.'.join(path)} must be between {minimum:g} and {maximum:g}"
            )
        _set(settings, path, converted)

    for path in BOOLEAN_PATHS:
        value = _get(settings, path)
        if not isinstance(value, bool):
            raise ValueError(f"{'.'.join(path)} must be true or false")

    mode = settings["interpolation"]["mode"]
    if mode not in {"strict", "nearest"}:
        raise ValueError("interpolation.mode must be strict or nearest")
    return settings


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:72] or "pose-box-test"


def automatic_experiment_name(settings: dict[str, Any]) -> str:
    face = settings["boxes"]["face"]
    body = settings["boxes"]["body"]
    stride = settings["inference"]["sample_stride_frames"]
    return (
        f"face-l{round(face['pad_left'] * 100)}-t{round(face['pad_top'] * 100)}"
        f"-r{round(face['pad_right'] * 100)}-b{round(face['pad_bottom'] * 100)}"
        f"-h{round(face['height_scale'] * 100)}"
        f"--body-x{round(body['pad_x'] * 100)}-t{round(body['pad_top'] * 100)}"
        f"-b{round(body['pad_bottom'] * 100)}--stride-{stride}"
    )
