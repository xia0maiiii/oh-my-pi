#!/usr/bin/env bash
# Render $YF_OMP_HOME/.omp/agent/models.yml from models.yml.tmpl using the current
# environment. Dependency-free (pure sed; no gettext/envsubst needed).
#
# Reusable in two places:
#   1. entrypoint.sh at container boot (static / single-model worker), and
#   2. the yf OmpRpcDriver, re-run via `docker exec` right before spawning
#      `omp --mode rpc` when model/creds are injected per task.
#
# Inputs (with fallbacks to yf's existing PI_* env contract, then defaults):
#   YF_OMP_BASE_URL        <- PI_BASE_URL          (REQUIRED; cairn gateway base URL)
#   YF_OMP_MODEL_ID        <- PI_MODEL             (REQUIRED; model id at the gateway)
#   YF_OMP_API             <- normalized PI_PROVIDER_API   (default: openai-completions)
#   YF_OMP_MODEL_NAME      <- YF_OMP_MODEL_ID
#   YF_OMP_CONTEXT_WINDOW  <- PI_MODEL_CONTEXT_WINDOW       (default: 200000)
#   YF_OMP_MAX_TOKENS                                       (default: 32768)
#   YF_OMP_REASONING                                        (default: true)
#   YF_OMP_AUTH_HEADER                                      (default: true)
#
# The API key is NOT rendered here: models.yml references the env var NAME
# `PI_API_KEY`, which omp resolves at runtime. The secret stays in process env.
set -euo pipefail

YF_OMP_HOME="${YF_OMP_HOME:-/srv/agent-home}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmpl="${YF_OMP_MODELS_TMPL:-$script_dir/omp-home/.omp/agent/models.yml.tmpl}"
out_dir="$YF_OMP_HOME/.omp/agent"
out="$out_dir/models.yml"

# --- resolve inputs (YF_OMP_* override; else map yf's PI_*; else default) ---
base_url="${YF_OMP_BASE_URL:-${PI_BASE_URL:-}}"
model_id="${YF_OMP_MODEL_ID:-${PI_MODEL:-}}"

if [ -z "$base_url" ] || [ -z "$model_id" ]; then
    echo "render-models: YF_OMP_BASE_URL/PI_BASE_URL and YF_OMP_MODEL_ID/PI_MODEL are required;" \
         "leaving any existing models.yml untouched." >&2
    exit 0
fi

# Normalize the omp provider `api` from yf's PI_PROVIDER_API (old Pi used different values).
normalize_api() {
    local raw="${YF_OMP_API:-${PI_PROVIDER_API:-}}"
    case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
        *anthropic*)                              echo "anthropic-messages" ;;
        ""|*openai-completions*|*completions*|*openai*) echo "openai-completions" ;;
        openai-responses|openai-codex-responses|azure-openai-responses|google-generative-ai|google-vertex) echo "$raw" ;;
        *) echo "openai-completions" ;;
    esac
}

api="$(normalize_api)"
model_name="${YF_OMP_MODEL_NAME:-$model_id}"
context_window="${YF_OMP_CONTEXT_WINDOW:-${PI_MODEL_CONTEXT_WINDOW:-200000}}"
max_tokens="${YF_OMP_MAX_TOKENS:-32768}"
reasoning="${YF_OMP_REASONING:-true}"
auth_header="${YF_OMP_AUTH_HEADER:-true}"

# --- render via sed (escape sed-special chars in substituted values) ---
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

mkdir -p "$out_dir"
tmp="$(mktemp)"
sed \
    -e "s|\${YF_OMP_BASE_URL}|$(esc "$base_url")|g" \
    -e "s|\${YF_OMP_API}|$(esc "$api")|g" \
    -e "s|\${YF_OMP_AUTH_HEADER}|$(esc "$auth_header")|g" \
    -e "s|\${YF_OMP_MODEL_ID}|$(esc "$model_id")|g" \
    -e "s|\${YF_OMP_MODEL_NAME}|$(esc "$model_name")|g" \
    -e "s|\${YF_OMP_REASONING}|$(esc "$reasoning")|g" \
    -e "s|\${YF_OMP_CONTEXT_WINDOW}|$(esc "$context_window")|g" \
    -e "s|\${YF_OMP_MAX_TOKENS}|$(esc "$max_tokens")|g" \
    "$tmpl" > "$tmp"
mv "$tmp" "$out"
chmod 0644 "$out"
echo "render-models: wrote $out (provider=cairn api=$api model=$model_id)" >&2
