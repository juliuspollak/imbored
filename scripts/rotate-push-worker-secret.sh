#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

secret_file=""
push_worker_secret=""
clear_clipboard() {
  if command -v pbpaste >/dev/null 2>&1 && [[ "$(pbpaste)" == "$push_worker_secret" ]]; then
    printf '' | pbcopy
  fi
}
cleanup() {
  clear_clipboard
  if [[ -n "$secret_file" && -f "$secret_file" ]]; then
    rm -f -- "$secret_file"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$REPO_ROOT"

if [[ ! -s supabase/.temp/project-ref ]]; then
  echo "No linked Supabase project found. Run 'npx supabase link' first." >&2
  exit 1
fi

for dependency in npx openssl pbcopy pbpaste; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Required command not found: $dependency" >&2
    exit 1
  fi
done

push_worker_secret="$(openssl rand -hex 32)"
umask 077
secret_file="$(mktemp /private/tmp/imbored-worker-secret.XXXXXX)"
chmod 600 "$secret_file"
printf 'PUSH_WORKER_SECRET=%s\n' "$push_worker_secret" >"$secret_file"

echo "Rotating PUSH_WORKER_SECRET on the currently linked Supabase project..."
npx supabase secrets set --env-file "$secret_file" >/dev/null
printf '%s' "$push_worker_secret" | pbcopy

echo "PUSH_WORKER_SECRET was rotated and copied to the clipboard."
echo "Paste it now into the scheduler's encrypted PUSH_WORKER_SECRET field."
read -r -p "Press Return after saving it; the clipboard and temporary file will then be cleared. "
