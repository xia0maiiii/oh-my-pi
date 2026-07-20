Runs commands in a persistent shell session.

Use for: calling real binary programs, protocol clients, debugging/evaluation tools, or short pipelines that extract observable facts (`wc -l`, `sort | uniq -c`, `comm`, `diff`).
{{#if hasLaunch}}Services, watchers, debuggers, REPLs, or processes requiring sustained interaction → `hub` (`op:"start"`).{{/if}}
{{#if hasEval}}Inline scripts, heredocs, shell control flow, `$(…)`, multi-stage pipelines, `&&`-chains, quote/JSON escaping → `eval` cells.{{else}}Inline scripts, heredocs, shell control flow, `$(…)`, multi-stage pipelines, `&&`-chains → purpose-built tool or checked-in script.{{/if}}

<instruction>
- `cwd` sets working dir (not `cd dir && …`). `env: { NAME: "…" }` for multiline/quote-heavy values; `"$NAME"` to expand.
- `pty: true` only for real terminal needs (`sudo`, `ssh`); default `false`.
- Each call should correspond to one clear observation or experiment. Independent calls may run concurrently; order-dependent commands must remain in the same call or the same supervised process.
- Internal URIs (`skill://`, `agent://`, …) auto-resolve to FS paths.
{{#if asyncEnabled}}- `async: true` defers reporting for finite commands needing no later input.{{/if}}
</instruction>

<critical>
{{#if hasGrep}}- NEVER shell out for code/file search: `grep`/`rg` → built-in `grep`. Filtering flags within protocol clients or evaluation programs are exempt from this restriction.{{/if}}
{{#if hasRead}}{{#if hasGlob}}- NEVER use `ls` or `find` to inspect the workspace — `ls` → `read`, `find` → `glob`. NON-NEGOTIABLE.{{/if}}{{/if}}
- Avoid head/tail/redirections to trim evidence: stderr merged, output auto-truncated, full capture at `artifact://<id>`.
{{#if hasLaunch}}- NEVER launch daemons/watchers/servers/debuggers/REPLs through bash — use `hub` (`op:"start"`).{{/if}}
</critical>

{{#if asyncEnabled}}- `timeout`: nonzero clamped 1–3600, killed on elapse. `async: true` defers reporting only, doesn't extend timeout.{{/if}}
{{#if autoBackgroundEnabled}}- Long foreground calls may auto-background; result arrives as follow-up — NOT a failure. Need inline? Raise timeout{{#if asyncEnabled}} or `async: true`{{/if}}.{{/if}}
- Long output truncated, test/lint filtered to failures. Footer links full capture. No footer = what you see is exact output.
