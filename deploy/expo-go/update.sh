#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/home/pi-rus/Downloads/feral-remote/luche-go
REPOSITORY=$ROOT/app
RELEASES=$ROOT/releases
CURRENT=$ROOT/current
DEPLOY_STATE=$ROOT/deploy
LOCK_FILE=$DEPLOY_STATE/update.lock
READY_MARKER=.luche-release-ready
MAX_RELEASES=3

mkdir -p "$RELEASES" "$DEPLOY_STATE"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    exit 0
fi

log() {
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

notify_success() {
    local sha=$1
    local subject=$2
    local chat_id=${DEPLOY_TELEGRAM_CHAT_ID:--5198292543}
    if [[ -z "${TELEGRAM_INTERNAL_BOT_TOKEN:-}" ]]; then
        log "Telegram success notification skipped: token is unavailable"
        return 0
    fi
    curl --fail --silent --show-error --max-time 20 \
        --request POST \
        "https://api.telegram.org/bot${TELEGRAM_INTERNAL_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=$chat_id" \
        --data-urlencode $'text=✅ go.luche.ai redeployed successfully\ncommit: '"${sha:0:12}"$'\n'"$subject"$'\nhttps://github.com/la-luche/luchern/commit/'"$sha" \
        >/dev/null
}

previous_target=""
switched=0

switch_current() {
    local target=$1
    local next=$ROOT/.current.$$
    rm -f "$next"
    ln -s "$target" "$next"
    mv -Tf "$next" "$CURRENT"
}

rollback() {
    if [[ "$switched" == 1 && -n "$previous_target" && -d "$previous_target" ]]; then
        log "rolling back to $(git -C "$previous_target" rev-parse --short HEAD 2>/dev/null || basename "$previous_target")"
        switch_current "$previous_target"
        systemctl --user restart luche-go-expo.service || true
    fi
}

on_error() {
    local status=$1
    local line=$2
    trap - ERR
    log "deployment failed at line $line (exit $status)"
    rollback
    exit "$status"
}
trap 'on_error $? $LINENO' ERR

prepare_release_entry() {
    local release=$1
    local sha=$2
    local entry_name=.luche-entry-${sha}.js
    local release_slug=luche-rn-${sha:0:12}

    printf "import 'expo-router/entry';\n" > "$release/$entry_name"
    node - "$release/package.json" "./$entry_name" "$release/app.json" "$release_slug" <<'NODE'
const fs = require('node:fs');
const [packagePath, main, appPath, slug] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.main = main;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
app.expo.slug = slug;
fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
NODE
}

warm_platform() {
    local platform=$1
    local manifest bundle_path

    manifest=$(curl --fail --silent --show-error --max-time 20 \
        -H "expo-platform: $platform" \
        -H 'accept: application/expo+json' \
        http://127.0.0.1:8091/) || return 1
    bundle_path=$(python3 -c '
import json, sys
from urllib.parse import urlsplit
url = urlsplit(json.load(sys.stdin)["launchAsset"]["url"])
print(url.path + (("?" + url.query) if url.query else ""))
' <<<"$manifest") || return 1
    [[ -n "$bundle_path" ]] || return 1
    curl --fail --silent --show-error --max-time 120 \
        "http://127.0.0.1:8089$bundle_path" >/dev/null || return 1
}

log "checking origin/main"
git -C "$REPOSITORY" fetch --quiet --prune origin main
target_sha=$(git -C "$REPOSITORY" rev-parse refs/remotes/origin/main)
current_sha=$(git -C "$CURRENT" rev-parse HEAD 2>/dev/null || true)

if [[ "$target_sha" == "$current_sha" && "${FORCE_DEPLOY:-0}" != 1 ]]; then
    log "already current at ${target_sha:0:12}"
    exit 0
fi

release=$RELEASES/$target_sha
if [[ -d "$release" && ! -f "$release/$READY_MARKER" ]]; then
    log "removing incomplete release ${target_sha:0:12}"
    git -C "$REPOSITORY" worktree remove --force "$release"
fi

if [[ ! -f "$release/$READY_MARKER" ]]; then
    log "staging ${target_sha:0:12}"
    git -C "$REPOSITORY" worktree add --quiet --detach "$release" "$target_sha"
    (
        cd "$release"
        npm install --no-audit --no-fund
        ./node_modules/.bin/tsc --noEmit
        npm test -- --runInBand --watch=false
        touch "$READY_MARKER"
    )
else
    log "reusing validated release ${target_sha:0:12}"
fi

# Expo Go caches launch assets by URL. A release-specific entry filename makes
# Metro emit a unique, integrity-valid bundle path without rewriting manifests.
prepare_release_entry "$release" "$target_sha"

previous_target=$(readlink -f "$CURRENT")
switch_current "$release"
switched=1
systemctl --user restart luche-go-expo.service

healthy=0
for _ in $(seq 1 90); do
    if warm_platform ios && warm_platform android; then
        healthy=1
        break
    fi
    sleep 2
done
if [[ "$healthy" != 1 ]]; then
    log "Metro bundle health check timed out"
    false
fi

switched=0
printf '%s\n' "$target_sha" > "$DEPLOY_STATE/last-successful-sha"
log "deployed ${target_sha:0:12}"
commit_subject=$(git -C "$release" log -1 --format=%s)
if ! notify_success "$target_sha" "$commit_subject"; then
    log "Telegram success notification failed"
fi

mapfile -t release_dirs < <(
    find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
        | sort -nr \
        | cut -d' ' -f2-
)
for ((index = MAX_RELEASES; index < ${#release_dirs[@]}; index++)); do
    old_release=${release_dirs[$index]}
    if [[ "$(readlink -f "$CURRENT")" != "$(readlink -f "$old_release")" ]]; then
        log "pruning $(basename "$old_release" | cut -c1-12)"
        git -C "$REPOSITORY" worktree remove --force "$old_release"
    fi
done
git -C "$REPOSITORY" worktree prune
