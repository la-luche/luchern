#!/usr/bin/env python3
"""Render Luche privacy blur from a stored production Sapiens2 result."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


CONFIDENCE_MIN = 0.25
BODY_END = 70


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float

    def interpolate(self, other: "Rect", fraction: float) -> "Rect":
        return Rect(
            self.left + (other.left - self.left) * fraction,
            self.top + (other.top - self.top) * fraction,
            self.right + (other.right - self.right) * fraction,
            self.bottom + (other.bottom - self.bottom) * fraction,
        )


def clamp(value: float, upper: float) -> float:
    return min(upper, max(0.0, value))


def odd(value: int) -> int:
    return max(3, value | 1)


def visible(points: np.ndarray, width: int, height: int) -> np.ndarray:
    finite = np.isfinite(points).all(axis=1)
    confident = points[:, 2] >= CONFIDENCE_MIN
    in_frame = (
        (points[:, 0] >= -0.1 * width)
        & (points[:, 0] <= 1.1 * width)
        & (points[:, 1] >= -0.1 * height)
        & (points[:, 1] <= 1.1 * height)
    )
    return points[finite & confident & in_frame, :2]


def body_rect(points: np.ndarray, width: int, height: int) -> Rect | None:
    body = visible(points[:BODY_END], width, height)
    if len(body) < 6:
        return None
    left, top = np.min(body, axis=0)
    right, bottom = np.max(body, axis=0)
    box_width = max(1.0, right - left)
    box_height = max(1.0, bottom - top)
    if box_width < 0.10 * width or box_height < 0.15 * height:
        return None
    return Rect(
        clamp(left - max(0.10 * width, 0.32 * box_width), width),
        clamp(top - max(0.08 * height, 0.22 * box_height), height),
        clamp(right + max(0.10 * width, 0.32 * box_width), width),
        clamp(bottom + max(0.10 * height, 0.18 * box_height), height),
    )


def face_rect(points: np.ndarray, width: int, height: int) -> Rect | None:
    # The dense face subset can contain high-confidence outliers on clothing
    # when the subject turns away. Anchor the mask to the production head and
    # shoulder landmarks instead: nose, eyes, ears, then shoulders for scale.
    head = visible(points[:5], width, height)
    shoulders = points[[5, 6]]
    shoulders_valid = np.isfinite(shoulders).all() and np.all(shoulders[:, 2] >= 0.15)
    if len(head) == 0 or not shoulders_valid:
        return None
    shoulder_width = abs(float(shoulders[1, 0] - shoulders[0, 0]))
    head_bounds_width = float(np.max(head[:, 0]) - np.min(head[:, 0]))
    head_width = min(
        0.45 * width,
        max(0.12 * width, head_bounds_width * 1.35, shoulder_width * 0.70),
    )
    head_height = min(0.38 * height, max(0.10 * height, head_width * 1.25))
    center_x = float(np.median(head[:, 0]))
    center_y = float(np.median(head[:, 1]))
    return Rect(
        clamp(center_x - 0.65 * head_width, width),
        clamp(center_y - 0.65 * head_height, height),
        clamp(center_x + 0.65 * head_width, width),
        clamp(center_y + 0.65 * head_height, height),
    )


def interpolate_gaps(rects: list[Rect | None]) -> list[Rect | None]:
    result = list(rects)
    known = [index for index, rect in enumerate(rects) if rect is not None]
    if not known:
        return result
    for left_index, right_index in zip(known, known[1:]):
        left = rects[left_index]
        right = rects[right_index]
        if left is None or right is None or right_index - left_index <= 1:
            continue
        for index in range(left_index + 1, right_index):
            fraction = (index - left_index) / (right_index - left_index)
            result[index] = left.interpolate(right, fraction)
    return result


def smooth(rects: list[Rect | None], radius: int = 2) -> list[Rect | None]:
    interpolated = interpolate_gaps(rects)
    output: list[Rect | None] = []
    for index, rect in enumerate(interpolated):
        if rect is None:
            output.append(None)
            continue
        neighbors = [
            candidate
            for candidate in interpolated[max(0, index - radius) : index + radius + 1]
            if candidate is not None
        ]
        values = np.asarray(
            [[item.left, item.top, item.right, item.bottom] for item in neighbors],
            dtype=np.float32,
        )
        median = np.median(values, axis=0)
        output.append(Rect(*(float(value) for value in median)))
    return output


def pixel_rect(rect: Rect, width: int, height: int) -> tuple[int, int, int, int]:
    return (
        max(0, min(width - 1, round(rect.left))),
        max(0, min(height - 1, round(rect.top))),
        max(0, min(width - 1, round(rect.right))),
        max(0, min(height - 1, round(rect.bottom))),
    )


def blur_background(frame: np.ndarray, body: Rect | None) -> np.ndarray:
    height, width = frame.shape[:2]
    block = max(24, round(min(width, height) / 24))
    reduced = cv2.resize(
        frame,
        (max(1, math.ceil(width / block)), max(1, math.ceil(height / block))),
        interpolation=cv2.INTER_AREA,
    )
    pixelated = cv2.resize(reduced, (width, height), interpolation=cv2.INTER_NEAREST)
    kernel = odd(round(min(width, height) * 0.055))
    blurred = cv2.GaussianBlur(pixelated, (kernel, kernel), 0)
    if body is None:
        return blurred
    left, top, right, bottom = pixel_rect(body, width, height)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (left, top), (right, bottom), 255, -1)
    feather = odd(round(min(width, height) * 0.025))
    mask = cv2.GaussianBlur(mask, (feather, feather), 0)
    alpha = mask.astype(np.float32)[..., None] / 255.0
    return np.clip(frame * alpha + blurred * (1.0 - alpha), 0, 255).astype(np.uint8)


def blur_face(frame: np.ndarray, face: Rect | None) -> None:
    if face is None:
        return
    height, width = frame.shape[:2]
    left, top, right, bottom = pixel_rect(face, width, height)
    if right <= left or bottom <= top:
        return
    crop = frame[top : bottom + 1, left : right + 1]
    crop_height, crop_width = crop.shape[:2]
    blocks_x = 4
    blocks_y = max(4, round(blocks_x * crop_height / max(1, crop_width)))
    pixelated = cv2.resize(crop, (blocks_x, blocks_y), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(
        pixelated, (crop_width, crop_height), interpolation=cv2.INTER_NEAREST
    )
    kernel = odd(round(min(crop_width, crop_height) * 0.18))
    frame[top : bottom + 1, left : right + 1] = cv2.GaussianBlur(
        pixelated, (kernel, kernel), 0
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--keypoints", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--poster", type=Path)
    parser.add_argument(
        "--face-only",
        action="store_true",
        help="Pixelate the face without altering the background.",
    )
    args = parser.parse_args()

    payload = json.loads(args.keypoints.read_text(encoding="utf-8"))
    if payload.get("keypoint_format") != "sapiens2_keypoints308":
        raise RuntimeError("expected sapiens2_keypoints308 keypoints")
    keyed_frames = {
        int(item["frame_idx"]): np.asarray(item["keypoints"], dtype=np.float32)
        for item in payload["frames"]
    }
    if not keyed_frames or any(points.shape != (308, 3) for points in keyed_frames.values()):
        raise RuntimeError("invalid Sapiens2 frame payload")

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise RuntimeError(f"could not open {args.video}")
    rotation_degrees = float(capture.get(cv2.CAP_PROP_ORIENTATION_META))
    capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, first_frame = capture.read()
    if not ok or fps <= 0 or frame_count <= 0:
        capture.release()
        raise RuntimeError("invalid video metadata")
    height, width = first_frame.shape[:2]

    bodies: list[Rect | None] = []
    faces: list[Rect | None] = []
    for frame_index in range(frame_count):
        points = keyed_frames.get(frame_index)
        bodies.append(body_rect(points, width, height) if points is not None else None)
        faces.append(face_rect(points, width, height) if points is not None else None)
    bodies = smooth(bodies)
    faces = smooth(faces)
    body_coverage = sum(rect is not None for rect in bodies) / frame_count
    face_coverage = sum(rect is not None for rect in faces) / frame_count
    if body_coverage < 0.60:
        capture.release()
        raise RuntimeError(f"body coverage is unsafe: {body_coverage:.1%}")
    if face_coverage < 0.40:
        capture.release()
        raise RuntimeError(f"face coverage is unsafe: {face_coverage:.1%}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
        "-r", f"{fps:.8f}", "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(args.output),
    ]
    encoder = subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    if encoder.stdin is None or encoder.stderr is None:
        capture.release()
        raise RuntimeError("could not start ffmpeg")

    rendered_frames = 0
    frame = first_frame
    try:
        while True:
            output = (
                frame.copy()
                if args.face_only
                else blur_background(frame, bodies[rendered_frames])
            )
            blur_face(output, faces[rendered_frames])
            encoder.stdin.write(output.tobytes())
            rendered_frames += 1
            if rendered_frames % 60 == 0:
                print(
                    f"rendered {rendered_frames}/{frame_count} frames",
                    flush=True,
                )
            ok, frame = capture.read()
            if not ok:
                break
    finally:
        capture.release()
        encoder.stdin.close()
    return_code = encoder.wait()
    stderr = encoder.stderr.read().decode("utf-8", errors="replace").strip()
    if return_code != 0:
        args.output.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg failed: {stderr or return_code}")

    if args.poster:
        args.poster.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", f"{rendered_frames / fps / 2:.3f}", "-i", str(args.output),
                "-frames:v", "1", "-q:v", "2", str(args.poster),
            ],
            check=True,
        )

    report = {
        "source_video": args.video.name,
        "source_keypoints": args.keypoints.name,
        "keypoint_format": payload["keypoint_format"],
        "frames": rendered_frames,
        "width": width,
        "height": height,
        "fps": fps,
        "source_rotation_degrees": rotation_degrees,
        "body_coverage": round(body_coverage, 5),
        "face_coverage": round(face_coverage, 5),
        "audio_removed": True,
        "effects": (
            ["pixelated_gaussian_face_blur"]
            if args.face_only
            else [
                "pixelated_gaussian_background_outside_body",
                "pixelated_gaussian_face_blur",
            ]
        ),
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
