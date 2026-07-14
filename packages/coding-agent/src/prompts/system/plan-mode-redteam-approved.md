Plan approved.
{{#if contextPreserved}}
- Context is preserved. Use conversation history when useful; if it conflicts with prior exploration, the plan file is the source of truth.
{{/if}}

<instruction>
You MUST read `{{planFilePath}}` before executing.
The file contents are the authoritative ops plan; visible/compacted context is secondary.
Read failure? Report the exact path and error—don't guess.
After reading, you MUST execute the plan step by step with full tool access.
You MUST verify each step before the next (evidence or explicit failure); for HTTP(S) findings capture full Burp messages.
{{#has tools "todo"}}
After reading the plan, initialize todo tracking with `todo`.
After each completed step, update `todo` immediately.
If `todo` fails, fix the payload and retry before continuing.
{{/has}}
</instruction>

<critical>
NEVER stop because inlined plan content was compacted, stale, or unrecoverable. Read `{{planFilePath}}`.
You MUST continue until complete. This matters.
</critical>
