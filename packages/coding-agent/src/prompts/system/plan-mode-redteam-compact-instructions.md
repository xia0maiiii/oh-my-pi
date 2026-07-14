Prepare to execute the approved ops plan.

You MUST distill the plan-mode discussion. Keep:
- Plan rationale and alternatives that were explicitly rejected.
- Critical decisions and the constraints that drove them.
- Discovered assets, entries, paths, and evidence anchors the executor will need.
- Explicit user preferences expressed during planning.

You MUST discard:
- Tool-call noise (file reads, searches) if results are already captured in the plan or above.
- Superseded plan drafts.
- Restated context already in the plan file.

{{#if planFilePath}}
The approved plan file is at `{{planFilePath}}`; it is the authoritative source of truth.
You MUST retain this durable path and the fact that the executor must read it directly after compaction.
{{/if}}
