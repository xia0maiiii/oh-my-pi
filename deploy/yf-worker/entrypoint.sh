#!/usr/bin/env bash
# Container entrypoint for the yf worker image when omp is the agent.
#
# yf runs the worker container with CMD `sleep infinity` and `docker exec`s the
# agent per task. This entrypoint runs ONCE at boot: it ensures the omp agent
# home exists and renders a default models.yml from container env, then hands off
# to the CMD. When model/creds are injected per task, the yf OmpRpcDriver re-runs
# render-models.sh via `docker exec` before spawning `omp --mode rpc`.
set -euo pipefail

YF_OMP_HOME="${YF_OMP_HOME:-/srv/agent-home}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Stage the baked bundle into the agent home if it isn't already there. In the
# image the bundle is COPYed to $YF_OMP_HOME/.omp/agent directly; this copy only
# matters when the bundle is mounted at a separate stage path.
stage="${YF_OMP_BUNDLE_STAGE:-$script_dir/omp-home}"
if [ -d "$stage/.omp/agent" ] && [ ! -e "$YF_OMP_HOME/.omp/agent/config.yml" ]; then
    mkdir -p "$YF_OMP_HOME/.omp/agent"
    cp -a "$stage/.omp/agent/." "$YF_OMP_HOME/.omp/agent/"
fi

# Render a default models.yml from whatever env is present at boot (the static /
# single-model case). No-ops cleanly if base URL / model are not set yet.
YF_OMP_HOME="$YF_OMP_HOME" "$script_dir/render-models.sh" || true

# Hand off to the container command (typically `sleep infinity`).
exec "$@"
