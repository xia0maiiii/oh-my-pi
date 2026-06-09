# FORK.md — maintaining this deep fork of omp

This is a **private downstream fork** of [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)
(`omp`) that tracks a **high-velocity upstream** (dozens of commits/day; ~800+ files
change between patch releases). Unlike a shallow fork, we carry **deep** changes —
including core TypeScript and Rust. This file is how we keep that sustainable.

- `origin` = your private fork (push here) · `upstream` = can1357 (fetch-only, push disabled)
- Local `omp` is dev-linked to this working tree (`deploy/yf-worker/UPSTREAM.md`), so every
  `omp` you run *is* this fork. `packages/**/src` TS is picked up live; only `crates/*` needs a rebuild.
- `git rerere` is enabled (records conflict resolutions, auto-replays them).

---

## The one rule: pick the lowest tier that works

Every change has a **tier** = how much it costs to carry across an upstream sync.
The cost of this fork is dominated by how much lands in Tier 2. **Push everything you
can down to Tier 0.**

### Tier 0 — out-of-core. ZERO sync conflict. Prefer for ~everything.

omp is *built* for out-of-core customization. These touch no upstream file, so an
upstream sync physically cannot conflict with them. Verified seams:

- **Hooks** (`docs/hooks.md`, `src/extensibility/hooks/types.ts`) — these *mutate* runtime,
  not just observe:
  - `tool_call` → **block** a tool call (with a reason)
  - `tool_result` → **rewrite** the result content
  - `context` → **rewrite the entire message stream** fed to the LLM each turn
  - `before_agent_start` → **inject** messages; plus the full session/turn lifecycle
  - API: `pi.on()`, `pi.sendMessage()`, `pi.registerCommand()`, `pi.exec()`, custom renderers
- **Extensions** (`docs/extensions.md`, `examples/extensions/*.ts`) — `registerTool()` to
  add/replace tools, register commands & renderers, drive the runtime. (`plan-mode.ts` ships
  plan mode *as an extension* — that is how much behavior is reachable here.)
- **Capability providers** (`src/capability/`) — implement `Provider<T>` to inject
  models / tools / rules / skills / MCP servers without editing discovery.
- **System prompt** (`docs/system-prompt-customization.md`) — `SYSTEM.md` (project > user),
  `--custom-prompt` (replace), `--append-system-prompt` (append).
- **Custom tools / slash-commands / skills / rules / context files** loaded from disk.

➡ **Put all yf red-team logic and "secret sauce" here.** In-repo it lives under
`deploy/yf-worker/`; for live local dev, drop files in `~/.omp/agent/{hooks,extensions,tools,commands,skills}/`.
Copy a starting point from `packages/coding-agent/examples/{hooks,extensions}/`.

### Tier 1 — thin additive core seams. RARE, trivial conflict.

When Tier 0 genuinely can't reach, add **a single line to a list/union** in core:

| Need | Edit (one entry) |
|------|------------------|
| New built-in tool | `BUILTIN_TOOLS` / `HIDDEN_TOOLS` in `src/tools/index.ts` (+ optional `isToolAllowed()` gate) |
| New hook event type | union in `src/extensibility/hooks/types.ts` + `HookAPI` overload |
| New RPC command | `src/modes/rpc/rpc-types.ts` |
| New system-prompt variable | the `data` object in `src/system-prompt.ts` |

These are additions to collections, so they re-resolve in seconds. **Mark every one**
(see Seam markers) and log it in the ledger.

> **Pro move — convert Tier 2 → Tier 1 → zero.** To do a deep-shaped change cheaply,
> add a **one-line Tier-1 seam** (a hook/dispatch call) in core, then put the real logic in
> a Tier-0 hook/extension *behind* that seam. Then **upstream the seam as a PR**. If it's
> merged, your core patch disappears forever and the logic stays private out-of-core.
> The cheapest divergence is the divergence you eliminate.

### Tier 2 — deep core / Rust patches. REAL conflict; manage with the discipline below.

No seam exists: the turn loop (`src/session/agent-session.ts`), prompt template *structure*,
TUI internals (`packages/tui`), provider internals (`packages/ai`), `crates/*`. These are the
**only** changes that need seam markers, ledger entries, and drift tests.

---

## Seam markers — the divergence X-ray

Wrap **every** Tier-1/Tier-2 edit in greppable markers:

```ts
// >>> omp-fork(<topic>): why this exists + which upstream behavior it relies on
   ...your change...
// <<< omp-fork(<topic>)
```

Then, at any moment:

```sh
grep -rn "omp-fork(" packages/ crates/
```

is your **complete** core footprint. If a line is in core and not wrapped, it's a bug in our
discipline. Every marker topic must have a row in the ledger.

---

## Divergence ledger

Keep this exhaustive. On every sync, walk it and re-validate each row.

| # | Tier | Marker topic | Files | Purpose | Relies on (upstream) | Re-validate after sync | Upstreamable? |
|---|------|--------------|-------|---------|----------------------|------------------------|---------------|
| 1 | T0 | — (additive bundle) | `deploy/yf-worker/**` | yf/Cairn RPC worker integration | RPC wire, `models.yml` schema, CLI flags | `deploy/yf-worker/smoke-rpc.ts` green | no (private) |
| 2 | T0 | — (fork infra) | `FORK.md`, `fork/**`, `.github/workflows/fork-sync.yml` | fork-maintenance rig + CI sync-bot | — | `fork/sync.sh` runs; bot files an issue | no |

_(append one row per Tier-1/Tier-2 patch as you add it)_

---

## Sync SOP — rebase our series onto an upstream release tag

`main` = `<upstream tag>` + our patch series. `git rebase v<new> main` replays exactly our
commits onto the new tag; `rerere` auto-applies recurring resolutions. Pin to **release tags**,
never `upstream/main` (it moves dozens of times a day).

> **Tags here are mutable.** Upstream's release automation force-moves the latest patch tag
> (we observed `v15.10.8` move `74d4f009`→`c69ba70a`). `fork/sync.sh` force-fetches tags to
> follow that; once you've rebased onto a tag its content is captured in your history, so a
> later move can't alter what you already synced. The script prints the resolved SHA — record
> it in the ledger as the stable reference.

```sh
fork/sync.sh                 # rebase onto the newest upstream tag
fork/sync.sh v15.10.8        # rebase onto a specific tag
```

`fork/sync.sh` refuses on a dirty tree, snapshots `fork-backup`, fetches tags, previews the
replay set and whether the incoming range touches `crates/`, runs the rebase, and prints the
exact follow-up. After it succeeds:

```sh
bun run build:native                    # ONLY if the range touched crates/ (the script tells you)
bun run check                           # typecheck + lint
bun --cwd=packages/coding-agent test    # upstream + our fork-* tests
omp --version                           # should report the new version (proves the dev-link)
git push --force-with-lease origin main # publish the rebased series to your fork
```

### Rebuild matrix (why most syncs need no build)

| Changed in the range | Action |
|----------------------|--------|
| `packages/**/src` TS (coding-agent, tui, ai, agent, …) | **none** — dev-launch runs source live |
| prompts `*.md` | none — imported as text, live |
| `crates/*` Rust | `bun run build:native` (a few minutes) |

### Big jumps

Step **one tag at a time** (`fork/sync.sh v15.10.5` → `…6` → `…`). `rerere` makes the repeated
parts free, and each step's conflicts stay small and legible.

### Recovery

`git rebase --abort` mid-conflict, or `git reset --hard fork-backup` after the fact.

---

## CI sync-bot & fork repo settings (GitHub-side)

`.github/workflows/fork-sync.yml` runs Mon/Thu (and on manual dispatch): it probes whether our
series still rebases onto the newest upstream tag and files/updates a `fork-sync`-labelled issue
with the result + the exact local commands. It is **report-only** — it never pushes `main` or
builds. Do the real sync locally with `fork/sync.sh`.

Because this fork is an independent private repo carrying upstream's full history, it also
inherited upstream's `ci.yml` (their CI on every push). That is **disabled** on the fork
(`gh workflow disable CI`) — we build/test locally; re-enable with `gh workflow enable CI` if
ever wanted. Keep Actions enabled (Settings → Actions) so the bot's schedule can fire, or just
run `fork/sync.sh` on demand.

## Semantic drift is the real enemy

A **clean** rebase can still silently break a Tier-2 patch: upstream refactors a function your
patch calls, the types still line up, but the behavior changed. Conflicts you see; drift you
don't. Defend with tests under `packages/coding-agent/test/fork-*.test.ts` that assert your
fork's behavior, and run them after every sync. **Add a drift test with every Tier-2 patch.**
