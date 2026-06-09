#!/usr/bin/env bash
# fork/sync.sh — rebase our patch series onto an upstream omp release tag.
#
# main = <upstream release tag> + our commits. This replays our commits onto a
# newer tag; git rerere auto-applies conflict resolutions seen before.
#
# Usage:
#   fork/sync.sh            # rebase onto the newest upstream v* tag
#   fork/sync.sh v15.10.8   # rebase onto a specific tag (step tag-by-tag on big jumps)
#
# See FORK.md for the full SOP, tiers, and the divergence ledger.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Must be on main (the integration branch the series lives on).
branch="$(git symbolic-ref --short -q HEAD || echo DETACHED)"
if [ "$branch" != "main" ]; then
	echo "ERROR: not on 'main' (on '$branch'). Switch to main first." >&2
	exit 1
fi

# Refuse on a dirty tree — rebasing over uncommitted work is unsafe.
if ! git diff-index --quiet HEAD --; then
	echo "ERROR: working tree is dirty. Commit or stash first:" >&2
	git status -s >&2
	exit 1
fi

echo ">> fetching upstream tags..."
git fetch upstream --tags --quiet

# Target tag: argument, or the newest v* tag.
target="${1:-$(git tag --list 'v*' --sort=-v:refname | head -1)}"
if ! git rev-parse -q --verify "refs/tags/${target}" >/dev/null; then
	echo "ERROR: tag '${target}' not found (did you mean one of:?)" >&2
	git tag --list 'v*' --sort=-v:refname | head -5 >&2
	exit 1
fi

base="$(git merge-base HEAD "$target")"
base_desc="$(git describe --tags --abbrev=0 "$base" 2>/dev/null || git rev-parse --short "$base")"
echo ">> current base: ${base_desc}"
echo ">> target tag:   ${target}"

# Already up to date?
if git merge-base --is-ancestor "$target" HEAD; then
	echo ">> main already contains ${target}; nothing to sync."
	exit 0
fi

# Preview: our commits to replay, and whether the incoming range touches Rust.
echo ""
echo ">> our patch series to replay onto ${target}:"
git --no-pager log --oneline "${target}..HEAD"

rust_changed=""
if ! git diff --quiet "${base}" "${target}" -- crates/; then
	rust_changed=1
	echo ">> NOTE: range touches crates/ (Rust) -> a native rebuild will be required."
else
	echo ">> range does NOT touch crates/ -> no native rebuild needed."
fi

# Snapshot, then rebase.
git branch -f fork-backup HEAD
echo ">> snapshot saved: branch 'fork-backup' (recover with: git reset --hard fork-backup)"
echo ">> rebasing onto ${target} (rerere will auto-apply known resolutions)..."
echo ""

if git rebase "$target"; then
	echo ""
	echo "==================================================================="
	echo "== REBASE OK -> main is now on ${target}"
	echo "==================================================================="
	[ -n "$rust_changed" ] && echo "  REQUIRED: bun run build:native   (the range changed crates/)"
	cat <<EOF
  THEN:
    bun run check
    bun --cwd=packages/coding-agent test
    omp --version            # expect ${target#v}
    git push --force-with-lease origin main
EOF
else
	echo ""
	echo "!! Rebase hit conflicts."
	echo "!! Resolve them, then: git rebase --continue   (rerere recorded them for next time)"
	echo "!! Your seam-marked core edits:  grep -rn 'omp-fork(' packages/ crates/"
	echo "!! To bail out completely:       git rebase --abort"
	exit 1
fi
