#!/usr/bin/env python3
"""Download one authorized Luche production trial into the local pose test library."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / "test_local_pose_estimatino"
REMOTE_APP = "/home/pi-rus/Downloads/feral-remote/feral-api"
REMOTE_PYTHON = "~/miniforge3/envs/feral-api/bin/python"


def trial_payload(trial_id: int) -> dict[str, object]:
    remote_source = f"""
import json
from dotenv import load_dotenv
load_dotenv('.env')
import db
import r2
trial = db.get_trial_full({trial_id})
if trial is None:
    raise SystemExit('trial not found')
print(json.dumps({{
    'id': trial['id'],
    'display_name': trial['display_name'],
    'test_type_id': trial['test_type_id'],
    'url': r2.presign_get(trial['video_key']),
}}))
"""
    command = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=15",
        "ssh.ratemepls.com",
        f"cd {REMOTE_APP} && {REMOTE_PYTHON} -",
    ]
    completed = subprocess.run(
        command,
        input=remote_source,
        text=True,
        capture_output=True,
        check=True,
    )
    value = json.loads(completed.stdout)
    if not isinstance(value, dict) or not isinstance(value.get("url"), str):
        raise RuntimeError("the Pi returned an invalid trial payload")
    return value


def download(url: str, destination: Path) -> int:
    temporary = destination.with_name(f".{destination.name}.partial")
    temporary.unlink(missing_ok=True)
    try:
        # The python.org macOS interpreter can have a stale private CA bundle.
        # Use system curl's trust store; never disable TLS verification.
        subprocess.run(
            [
                "curl", "--fail", "--silent", "--show-error", "--location",
                "--retry", "2", "--retry-all-errors", "--connect-timeout", "15",
                "--max-time", "900", "--output", str(temporary), url,
            ],
            check=True,
        )
        written = temporary.stat().st_size
        if written <= 0:
            raise RuntimeError("downloaded trial is empty")
        subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,width,height:format=duration",
                "-of", "json", str(temporary),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        temporary.replace(destination)
        return written
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("trial_id", type=int)
    parser.add_argument("output_name")
    parser.add_argument("--expected-display-name")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(os.getenv("LUCHE_POSE_EXPERIMENT_ROOT", ROOT)),
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if getpass.getuser() != "ksc":
        raise SystemExit("Pi trial download is authorized only on Peter's Mac")
    if Path(args.output_name).name != args.output_name:
        raise SystemExit("output_name must be a filename, not a path")
    destination = args.root.resolve() / args.output_name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size > 0 and not args.force:
        print(f"already present: {destination.name} ({destination.stat().st_size} bytes)")
        return

    payload = trial_payload(args.trial_id)
    display_name = str(payload["display_name"])
    if args.expected_display_name and display_name != args.expected_display_name:
        raise SystemExit(
            f"trial {args.trial_id} is {display_name!r}, expected {args.expected_display_name!r}"
        )
    size = download(str(payload["url"]), destination)
    print(
        json.dumps(
            {
                "trial_id": args.trial_id,
                "display_name": display_name,
                "test_type_id": payload["test_type_id"],
                "file": destination.name,
                "size_bytes": size,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        message = error.stderr.strip() if isinstance(error.stderr, str) else str(error)
        print(f"trial download failed: {message}", file=sys.stderr)
        raise SystemExit(1) from error
