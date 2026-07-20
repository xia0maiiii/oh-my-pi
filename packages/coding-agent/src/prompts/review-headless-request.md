## Attack Surface Review Request

### Mode

Headless review request

### Distribution Guidelines

Use the `task` tool with `agent: "reviewer"` and a `tasks` array.
Create exactly **1 reviewer task** for recent code changes. Require it to trace from the diff to the necessary producers, validation points, distribution points, and security-relevant outcomes.

{{#if focus}}
### Focus

{{focus}}
{{/if}}
