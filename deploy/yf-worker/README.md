# yf-worker — omp as a Cairn/yf red-team worker agent

This directory is the **merge-safe customization layer** that adapts upstream `omp`
(`@oh-my-pi/pi-coding-agent`) into the worker agent that `yf` (Cairn) drives inside its
worker containers over the **RPC protocol** (`omp --mode rpc`, see `../../docs/rpc.md`).

It deliberately lives **outside** `packages/coding-agent/src/` so it never conflicts when this
fork merges an upstream tag. **Do not patch omp core to serve yf** — everything yf needs is a
supported surface: RPC host tools, `models.yml` providers, and CLI capability flags.

## What's here

| Path | Role |
| ---- | ---- |
| `omp-home/.omp/agent/config.yml` | Static hardening: no upstream update pings, no setup wizard, quiet boot. |
| `omp-home/.omp/agent/models.yml.tmpl` | Cairn gateway provider, env-templated. Secrets stay in env (omp resolves `apiKey` as an env-var **name**). |
| `omp-home/.omp/agent/prompts/yf-contract.md` | The always-appended system prompt: "conclude every task via `submit_result`". |
| `render-models.sh` | Renders `models.yml` from the current env (yf's `PI_*` → cairn provider). Dependency-free. |
| `omp-wrapper.sh` | Installed as `/usr/local/bin/omp` in the worker image: renders `models.yml` from the **per-exec** env, then execs the real binary. Keeps the Rust driver pure. |
| `entrypoint.sh` | Container-start staging + a default render (for the static single-model case). |
| `HOST-TOOLS.md` | **Canonical contract** for the host tools the yf Rust driver registers. Shared source of truth between the omp side (this bundle) and the yf side. |
| `Dockerfile.omp-linux` + `build-linux-binary.sh` | Build the pinned standalone **linux-x64** `dist/omp` (reuses the repo's real build), plus the vendor bundle. |
| `smoke-rpc.ts` | Live RPC smoke against a real omp: flags + `ready` + `set_host_tools` + `get_state`→cairn (no model turn). |
| `UPSTREAM.md` | Remote setup + the conflict-free upstream-merge SOP. |

## The integration contract (one paragraph)

yf execs `omp --mode rpc` inside the worker container over a duplex stdio channel. The driver
sends `set_host_tools` to register a **terminal `submit_result` tool** (plus pentest tools),
appends `yf-contract.md` to the system prompt, then `prompt`s the rendered task. The model does
its work and **concludes by calling `submit_result({accepted, data})`**; the driver receives that
as a `host_tool_call`, validates `data` against the task contract (`cairn-core/src/contracts.rs`),
and treats it as completion — **no stdout JSON scraping**. See `HOST-TOOLS.md` and `../../docs/rpc.md`.

## HOME convention

omp reads config from `$HOME/.omp/agent/` (`os.homedir()` base; `PI_CONFIG_DIR` only renames the
`.omp` segment). So the bundle is staged under a fixed home and omp is spawned with `HOME` pointed
at it — exactly how `python/robomp` uses `/srv/agent-home`. Default here: **`YF_OMP_HOME=/srv/agent-home`**.

## Capability lockdown (passed by the driver at spawn, Workstream C)

Static config can't scope tools per-exec, so the yf driver passes these flags to `omp --mode rpc`:

```
--tools read,write,edit,bash,search,find,todo   # whitelist; pentest actions arrive as host tools
--no-extensions --no-skills --no-lsp            # nothing auto-loads in an unattended worker
--no-session                                    # or --session-dir <scoped> for multi-turn continuity
```

Plus env: `PI_NO_PTY=1`. RPC mode itself sets `PI_NOTIFICATIONS=off` and resets `todo.*/task.*/async.*`
to defaults. Permission prompts (`extension_ui_request`) are auto-answered headlessly by the driver
(the equivalent of robomp's `install_headless_ui()`).

## Build & upstream tracking

The pinned linux `dist/omp` binary is produced by `build-linux-binary.sh` (Workstream A) and baked
into the worker image (Workstream D). To follow upstream: `git fetch upstream --tags`, review the
RPC/`models.yml`/CLI deltas in `packages/coding-agent/CHANGELOG.md`, `git merge v<new>` (expected
conflict-free — this bundle adds files only), rebuild the binary, re-run the smoke test, then bump
the pinned version.
