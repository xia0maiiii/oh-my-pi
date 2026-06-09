# Tracking upstream omp in this fork

This fork's only deviations from upstream live under `deploy/yf-worker/` (this
bundle) — **no edits to `packages/coding-agent/src/` core**. That is what makes
upstream merges essentially conflict-free. Keep it that way.

## Remote layout (configured)

This clone is already wired as a private downstream fork:

```sh
origin    https://github.com/xia0maiiii/oh-my-pi.git   # your private fork (push here)
upstream  https://github.com/can1357/oh-my-pi          # read-only (push disabled)
```

`main` is the **integration branch**: upstream history + this `deploy/yf-worker/`
bundle on top. Pin syncs to upstream **release tags** (e.g. `v15.10.4`), never
`upstream/main` (it moves dozens of times a day). Tags come from upstream:
`git fetch upstream --tags`.

## Local `omp` runs this tree (dev-linked)

The global `omp` is symlinked straight at this working tree, so every `omp` you
run *is* your fork — edits and upstream merges take effect with no reinstall:

```sh
ln -sfn "$PWD/packages/coding-agent/scripts/dev-launch" /opt/homebrew/bin/omp
```

Note: `bun run install:dev` writes this symlink into `$(bun pm -g bin)`
(`~/.bun/install/global/bin`), which is **not on this machine's PATH** — so we
link `/opt/homebrew/bin/omp` (the entry that *is* on PATH) directly instead.
`dev-launch` resolves the symlink back to `src/cli.ts` here, so only the link
location matters. Rebuild the native addon (`bun run build:native`) only when an
upstream sync touches Rust under `crates/`; TS changes are picked up live.

## Upgrade SOP (each time you take a newer omp)

1. `git fetch upstream --tags`
2. **Diff the integration contract** between your pinned tag and the target tag —
   this is what your yf driver depends on:
   - `docs/rpc.md` / `packages/coding-agent/src/modes/rpc/rpc-types.ts` (RPC wire)
   - `docs/models.md` (models.yml provider schema)
   - the CLI flags in `packages/coding-agent/src/cli/args.ts` that the driver passes
     (`--mode rpc`, `--tools`, `--no-extensions/--no-skills/--no-lsp`,
     `--append-system-prompt`, `--model`, `--thinking`, `--session-dir`)
   - read `packages/coding-agent/CHANGELOG.md` across the range.
3. `git merge v<new>` (or rebase the `deploy/yf-worker/` commits onto the tag).
   Expect **no conflicts** — this bundle only adds files.
4. Rebuild:
   - **Local dev-linked `omp`** — nothing for TS (picked up live); run
     `bun run build:native` only if the range touched `crates/`. `omp --version`
     should now report `v<new>`.
   - **Worker image** — `deploy/yf-worker/build-linux-binary.sh`.
5. Run the smoke test (`deploy/yf-worker/smoke-rpc.sh`) and the yf dispatcher
   integration test against the new binary.
6. **Only after green:** bump `OMP_VERSION` in `yf-rust/container/Dockerfile` to
   the new tag and redeploy the worker image.

Do not hand-edit versions or the native version sentinel — take whatever the
upstream tag ships.

## What changed on the yf side (so you know what to re-test on upgrade)

- `cairn-dispatcher` gained `rpc` / `host_tools` / `omp_driver` / `transport`
  modules: the RPC client, the `submit_result` host-tool contract, the
  `OmpRpcDriver`, and the child-process + `docker exec` transports.
- The worker container installs the forked `omp` binary + this bundle instead of
  `@mariozechner/pi-coding-agent@0.73.0`.

The behavioral risk on upgrade is **RPC/provider drift**, not file conflicts —
so pin tags, smoke first, promote second.
