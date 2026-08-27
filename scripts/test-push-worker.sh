#!/usr/bin/env bash
set -euo pipefail
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
secret_file="";curl_config="";response_file=""
cleanup(){ rm -f -- "$secret_file" "$curl_config" "$response_file"; }
trap cleanup EXIT;trap 'exit 129' HUP;trap 'exit 130' INT;trap 'exit 143' TERM
cd "$REPO_ROOT"
[[ -s supabase/.temp/project-ref ]]||{ echo "No linked Supabase project found. Run 'npx supabase link' first." >&2;exit 1; }
for dependency in npx openssl curl;do command -v "$dependency" >/dev/null 2>&1||{ echo "Required command not found: $dependency" >&2;exit 1; };done
project_ref="$(tr -d '[:space:]' < supabase/.temp/project-ref)";[[ "$project_ref" =~ ^[a-z0-9]+$ ]]||{ echo "Linked Supabase project reference is invalid." >&2;exit 1; }
worker_secret="$(openssl rand -hex 32)";umask 077
secret_file="$(mktemp /private/tmp/imbored-worker-secret.XXXXXX)";curl_config="$(mktemp /private/tmp/imbored-worker-curl.XXXXXX)";response_file="$(mktemp /private/tmp/imbored-worker-response.XXXXXX)";chmod 600 "$secret_file" "$curl_config" "$response_file"
printf 'PUSH_WORKER_SECRET=%s\n' "$worker_secret" >"$secret_file";npx supabase secrets set --env-file "$secret_file" >/dev/null
printf 'url = "https://%s.supabase.co/functions/v1/send-push-notifications"\nrequest = "POST"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata = "{\\"mode\\":\\"empty-check\\"}"\nsilent\nshow-error\n' "$project_ref" "$worker_secret" >"$curl_config"
http_status="$(curl --config "$curl_config" --output "$response_file" --write-out '%{http_code}')";body="$(<"$response_file")"
if [[ ! "$http_status" =~ ^2 ]];then printf 'HTTP %s\n%s\n' "$http_status" "$body" >&2;exit 1;fi
printf '%s\n' "$body";if [[ "$body" == *'"eligible":0'* ]];then echo "Push worker endpoint/authentication smoke test passed.";echo "Queue is empty. No push was sent.";else echo "Worker is reachable, but queue is not empty.";echo "No pushes were sent.";fi
