<system-reminder>
Task delegation is enabled—for this request, subagents are the default.

Explore and settle the attack path first. Once the path is set, you MUST fan work out to `{{toolRefs.task}}` subagents rather than executing it yourself.{{#if taskBatch}} Batch independent slices into one parallel `{{toolRefs.task}}` call; never serialize what can run concurrently.{{/if}}

Work alone only for: single-target short validation, direct answers needing no tools, or commands the user explicitly asked you to run.
</system-reminder>
