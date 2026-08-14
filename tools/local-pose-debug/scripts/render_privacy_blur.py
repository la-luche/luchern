#!/usr/bin/env python3
"""Render face + background privacy blur from one completed pose experiment."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

from pose_debug.pipeline import _pixel_rect, boxes_at, build_boxes, open_video


def odd(value: int) -> int:
    return max(3, value | 1)


def blur_background(frame: np.ndarray, body) -> np.ndarray:
    height, width = frame.shape[:2]
    # Production privacy treatment: destroy fine background detail with a
    # coarse mosaic before applying the existing visual blur.
    block = max(24, round(min(width, height) / 24))
    reduced_width = max(1, (width + block - 1) // block)
    reduced_height = max(1, (height + block - 1) // block)
    pixelated = cv2.resize(
        frame, (reduced_width, reduced_height), interpolation=cv2.INTER_AREA
    )
    pixelated = cv2.resize(
        pixelated, (width, height), interpolation=cv2.INTER_NEAREST
    )
    kernel = odd(round(min(width, height) * 0.055))
    blurred = cv2.GaussianBlur(pixelated, (kernel, kernel), 0)
    if body is None:
        return blurred
    left, top, right, bottom = _pixel_rect(body, width, height)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (left, top), (right, bottom), 255, -1)
    feather = odd(round(min(width, height) * 0.025))
    mask = cv2.GaussianBlur(mask, (feather, feather), 0)
    alpha = mask.astype(np.float32)[..., None] / 255.0
    return np.clip(frame * alpha + blurred * (1.0 - alpha), 0, 255).astype(np.uint8)


def blur_face(frame: np.ndarray, face) -> None:
    if face is None:
        return
    height, width = frame.shape[:2]
    left, top, right, bottom = _pixel_rect(face, width, height)
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
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--video", required=True, help="video name recorded in manifest.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    experiment = args.experiment.resolve()
    manifest = json.loads((experiment / "manifest.json").read_text(encoding="utf-8"))
    result = next(
        (item for item in manifest["results"] if item["video"] == args.video), None
    )
    if result is None:
        raise RuntimeError(f"video is not present in experiment: {args.video}")
    root = experiment.parent.parent
    video = (root / args.video).resolve()
    landmarks = json.loads(
        (experiment / result["landmark_file"]).read_text(encoding="utf-8")
    )
    samples = build_boxes(landmarks, manifest["settings"])

    capture, _ = open_video(video)
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    ok, frame = capture.read()
    if not ok:
        capture.release()
        raise RuntimeError(f"could not decode {video.name}")
    height, width = frame.shape[:2]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
        "-r", f"{fps:.8f}", "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "veryfast", "-b:v", "3M", "-maxrate", "3M", "-bufsize", "6M",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(args.output),
    ]
    encoder = subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    if encoder.stdin is None or encoder.stderr is None:
        capture.release()
        raise RuntimeError("could not start ffmpeg")

    frame_index = 0
    missing_body = 0
    missing_face = 0
    try:
        while True:
            body, face = boxes_at(
                samples,
                frame_index / fps,
                manifest["settings"]["interpolation"]["mode"],
            )
            missing_body += body is None
            missing_face += face is None
            rendered = blur_background(frame, body)
            blur_face(rendered, face)
            encoder.stdin.write(rendered.tobytes())
            frame_index += 1
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

    report = {
        "source_experiment": manifest["id"],
        "source_video": args.video,
        "frames": frame_index,
        "frames_without_body_box": missing_body,
        "frames_without_face_box": missing_face,
        "width": width,
        "height": height,
        "fps": fps,
        "output": args.output.name,
        "effects": [
            "pixelated_gaussian_background_outside_body",
            "pixelated_gaussian_face_blur",
        ],
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
