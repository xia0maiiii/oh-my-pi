## Attack Surface Review Request

### Mode

Custom review instructions

### Distribution Guidelines

Use the `task` tool with `agent: "reviewer"` and a `tasks` array.
Create exactly **1 reviewer task**. Its assignment MUST include the custom instructions below.

### Reviewer Instructions

Reviewer MUST:
1. Follow the custom instructions below
2. Read the referenced files, callers, configuration, or workspace context needed to evaluate attack paths
3. Distinguish real paths, leads, and `[INFERENCE]`
4. Use incremental `yield` sections for findings and verdict fields; do NOT call a separate findings tool

### Custom Instructions

{{instructions}}
