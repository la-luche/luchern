#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.lock.txt
# rtmlib incorrectly declares both opencv-python and opencv-contrib-python.
# The pinned contrib wheel already supplies cv2, so install this thin Python
# adapter without pulling a second, conflicting OpenCV distribution.
.venv/bin/python -m pip install --disable-pip-version-check -q --no-deps rtmlib==0.0.16
exec .venv/bin/python -u server.py "$@"
