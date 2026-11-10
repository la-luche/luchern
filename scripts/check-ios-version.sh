#!/bin/sh
set -eu
cd "$PROJECT_DIR/.."
if [ -f "$PROJECT_DIR/.xcode.env" ]; then . "$PROJECT_DIR/.xcode.env"; fi
if [ -f "$PROJECT_DIR/.xcode.env.local" ]; then . "$PROJECT_DIR/.xcode.env.local"; fi
: "${NODE_BINARY:=node}"
"$NODE_BINARY" scripts/build-version.cjs check
"$NODE_BINARY" scripts/verify-build.cjs "$TARGET_BUILD_DIR/$WRAPPER_NAME"
