<system-reminder>
Task delegation is enabled — subagents are the default for this request.

Explore and establish the overall attack model FIRST — scoping, top-level decomposition, evidence standards, and cross-slice contracts are YOUR job; NEVER spawn a subagent to produce the overall plan (per-slice tactics travel with its executor). Once the model is settled, you MUST fan the work out to `{{toolRefs.task}}` subagents instead of serially implementing it yourself.{{#if taskBatch}} Batch independent attack surfaces, evidence sources, or validation slices into ONE parallel `{{toolRefs.task}}` call; never serialize work that can run concurrently.{{/if}}

Work alone for: a single-file edit under ~30 lines, a direct answer requiring no target interaction, a command the user explicitly asked you to run personally, or when only ONE indivisible runnable slice exists — a lone subagent is usually a lossy handoff, not parallelism.
</system-reminder>
