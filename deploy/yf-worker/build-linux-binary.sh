#!/usr/bin/env bash
# Build the pinned standalone linux-x64 `omp` binary for the yf worker image,
# and assemble the bundle directory that the worker Dockerfile vendors in.
#
# Run from the repo root of this omp fork (needs Docker + BuildKit):
#     deploy/yf-worker/build-linux-binary.sh
#
# Produces:
#     deploy/yf-worker/dist/omp                 — the linux-x64 binary
#     deploy/yf-worker/dist/bundle/             — config bundle + scripts to vendor
#
# Hand-off: copy deploy/yf-worker/dist/ into the yf-rust build context at
# `container/omp/` (see Workstream D / UPSTREAM.md), then build the worker image.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
here="$repo_root/deploy/yf-worker"
out="$here/dist"

echo "==> building linux-x64 omp binary (this reuses the repo's real build)…"
DOCKER_BUILDKIT=1 docker build \
    -f "$here/Dockerfile.omp-linux" \
    --target export \
    --output "type=local,dest=$out" \
    "$repo_root"

test -f "$out/omp" || { echo "build failed: $out/omp missing" >&2; exit 1; }
chmod +x "$out/omp"

echo "==> assembling the worker bundle to vendor into yf…"
bundle="$out/bundle"
rm -rf "$bundle"
mkdir -p "$bundle"
# Static config tree (config.yml, models.yml.tmpl, prompts/) + the render and
# wrapper scripts. The worker Dockerfile stages omp-home/.omp/agent into $HOME
# and installs omp-wrapper.sh as /usr/local/bin/omp.
cp -a "$here/omp-home" "$bundle/"
cp -a "$here/render-models.sh" "$here/omp-wrapper.sh" "$here/HOST-TOOLS.md" "$bundle/"

omp_version="$("$out/omp" --version 2>/dev/null | tr -d '\n' || true)"
echo "==> done. omp --version => ${omp_version:-unknown}"
echo "    binary: $out/omp"
echo "    bundle: $bundle/"
echo
echo "Next: copy '$out/' into yf-rust build context as 'container/omp/' and rebuild the worker image."
echo "Pin OMP_VERSION='${omp_version:-<set me>}' in container/Dockerfile."
