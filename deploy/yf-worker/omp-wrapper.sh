#!/bin/sh
# Thin `omp` wrapper for the yf worker container.
#
# yf execs `omp --mode rpc …` per task with the task's PI_*/cairn env injected.
# omp reads models.yml at startup, so this wrapper renders models.yml from the
# *current* (per-exec) env first, then execs the real standalone binary. This
# keeps the Rust OmpRpcDriver pure (it just runs `omp …`) while still honoring
# per-task model/credentials. Installed as /usr/local/bin/omp.
set -eu

: "${YF_OMP_DIR:=/opt/yf-omp}"        # vendored bundle + real binary
: "${YF_OMP_HOME:=${HOME:-/home/kali}}"

# Render $YF_OMP_HOME/.omp/agent/models.yml from env. No-ops (leaving any staged
# models.yml untouched) when base URL / model are not set. Render diagnostics go
# to stderr so they never corrupt omp's RPC stdout stream.
if [ -x "$YF_OMP_DIR/render-models.sh" ]; then
    YF_OMP_HOME="$YF_OMP_HOME" \
    YF_OMP_MODELS_TMPL="$YF_OMP_DIR/omp-home/.omp/agent/models.yml.tmpl" \
        "$YF_OMP_DIR/render-models.sh" >&2 2>/dev/null || true
fi

exec "$YF_OMP_DIR/bin/omp" "$@"
