#!/usr/bin/env python3
"""Normalize test videos to the effective Luche app capture resolution."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3] / "test_local_pose_estimatino"
VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v"}


def probe(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries",
            "stream=codec_name,codec_tag_string,width,height,pix_fmt,avg_frame_rate,bit_rate:stream_side_data=rotation:format=duration,size",
            "-of", "json", str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    stream = payload["streams"][0]
    rotation = 0
    for side_data in stream.get("side_data_list", []):
        if "rotation" in side_data:
            rotation = int(side_data["rotation"])
            break
    width = int(stream["width"])
    height = int(stream["height"])
    if abs(rotation) % 180 == 90:
        display_width, display_height = height, width
    else:
        display_width, display_height = width, height
    return {
        "coded_width": width,
        "coded_height": height,
        "display_width": display_width,
        "display_height": display_height,
        "rotation": rotation,
        "codec": stream.get("codec_name"),
        "codec_tag": stream.get("codec_tag_string"),
        "pixel_format": stream.get("pix_fmt"),
        "frame_rate": stream.get("avg_frame_rate"),
        "bit_rate": stream.get("bit_rate"),
        "duration": payload.get("format", {}).get("duration"),
        "size": payload.get("format", {}).get("size"),
    }


def normalize(path: Path, width: int, height: int) -> dict[str, Any]:
    before = probe(path)
    if (before["display_width"], before["display_height"]) == (width, height):
        return {"file": path.name, "status": "already-matches", "before": before}

    temporary = path.with_name(f".{path.stem}.normalized{path.suffix}")
    temporary.unlink(missing_ok=True)
    filter_graph = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    )
    try:
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(path), "-map", "0:v:0", "-vf", filter_graph,
                "-r", "30000/1001", "-c:v", "hevc_videotoolbox", "-tag:v", "hvc1",
                "-b:v", "3000000", "-maxrate", "3000000", "-bufsize", "6000000",
                "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1",
                "-movflags", "+faststart", str(temporary),
            ],
            check=True,
        )
        after = probe(temporary)
        if (after["display_width"], after["display_height"]) != (width, height):
            raise RuntimeError(
                f"normalization produced {after['display_width']}x{after['display_height']}"
            )
        temporary.replace(path)
        return {"file": path.name, "status": "normalized", "before": before, "after": after}
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(os.getenv("LUCHE_POSE_EXPERIMENT_ROOT", ROOT)),
    )
    parser.add_argument("--display-width", type=int, default=720)
    parser.add_argument("--display-height", type=int, default=1280)
    args = parser.parse_args()
    root = args.root.resolve()
    videos = sorted(
        path
        for path in root.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    )
    results = [normalize(path, args.display_width, args.display_height) for path in videos]
    print(json.dumps({"root": str(root), "results": results}, indent=2))


if __name__ == "__main__":
    main()
