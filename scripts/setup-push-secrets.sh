#!/usr/bin/env bash

set -euo pipefail

readonly APNS_BUNDLE_ID="au.imbored.app"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

secrets_file=""
cleanup() {
  if [[ -n "$secrets_file" && -f "$secrets_file" ]]; then
    rm -f -- "$secrets_file"
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

for dependency in npx openssl awk; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Required command not found: $dependency" >&2
    exit 1
  fi
done

prompt_identifier() {
  local prompt="$1"
  local value=""

  while true; do
    read -r -p "$prompt: " value
    if [[ "$value" =~ ^[A-Za-z0-9]+$ ]]; then
      break
    fi
    echo "$prompt must contain only letters and numbers." >&2
  done

  printf '%s' "$value"
}

apns_key_id="$(prompt_identifier "APNS Key ID")"
apns_team_id="$(prompt_identifier "Apple Team ID")"

while true; do
  read -r -p "Path to the APNs .p8 private key: " p8_path
  if [[ "$p8_path" == \~/* ]]; then
    p8_path="$HOME/${p8_path:2}"
  fi

  if [[ ! -f "$p8_path" ]]; then
    echo "File not found: $p8_path" >&2
    continue
  fi
  if [[ ! -r "$p8_path" ]]; then
    echo "File is not readable: $p8_path" >&2
    continue
  fi
  if ! grep -q '^-----BEGIN PRIVATE KEY-----$' "$p8_path" || \
     ! grep -q '^-----END PRIVATE KEY-----$' "$p8_path"; then
    echo "The selected file does not look like an APNs .p8 private key." >&2
    continue
  fi
  break
done

# The Edge Function restores these literal \n sequences before importing the key.
apns_private_key="$(awk '{ printf "%s\\n", $0 }' "$p8_path")"
push_worker_secret="$(openssl rand -hex 32)"

umask 077
secrets_file="$(mktemp /private/tmp/imbored-push-secrets.XXXXXX)"
chmod 600 "$secrets_file"

{
  printf 'APNS_KEY_ID=%s\n' "$apns_key_id"
  printf 'APNS_TEAM_ID=%s\n' "$apns_team_id"
  printf 'APNS_PRIVATE_KEY=%s\n' "$apns_private_key"
  printf 'APNS_BUNDLE_ID=%s\n' "$APNS_BUNDLE_ID"
  printf 'PUSH_WORKER_SECRET=%s\n' "$push_worker_secret"
} >"$secrets_file"

echo "Setting push secrets on the currently linked Supabase project..."
npx supabase secrets set --env-file "$secrets_file"
echo "Push secrets set successfully. No secret values were printed or kept in the repository."
