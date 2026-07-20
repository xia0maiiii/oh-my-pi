## Attack Surface Review Request

### Mode

{{mode}}

### Changed Files ({{len files}} files, +{{totalAdded}}/-{{totalRemoved}} lines)

{{#if files.length}}
{{#table files headers="File|+/-|Type"}}
{{path}} | +{{linesAdded}}/-{{linesRemoved}} | {{ext}}
{{/table}}
{{else}}
_No files to review._
{{/if}}
{{#if excluded.length}}
### Excluded Files ({{len excluded}})

{{#list excluded prefix="- " join="\n"}}
`{{path}}` (+{{linesAdded}}/-{{linesRemoved}}) — {{reason}}
{{/list}}
{{/if}}

### Distribution Guidelines

Use the `task` tool with `agent: "reviewer"` and a `tasks` array.
{{#when agentCount "==" 1}}Create exactly **1 reviewer task**.{{else}}Spawn **{{agentCount}} reviewer agents** in parallel.{{/when}}
{{#if multiAgent}}
Group files by attack-path relationships, e.g.:
- Same entry point, identity, or state machine → same agent
- Producers, transformation points, and consumers → same agent
- Tests/fixtures with their implementation → same agent
{{/if}}

### Reviewer Instructions

Reviewer MUST:
1. Focus ONLY on assigned files and the direct context required to prove the path
2. {{#if skipDiff}}{{diffInstruction}}{{else}}MUST use diff hunks below (NEVER re-run git diff){{/if}}
3. {{contextInstruction}}
4. Report only real paths introduced by the patch, with a controllable input leading to an observable impact
5. Use incremental `yield` sections for findings and verdict fields; do NOT call a separate findings tool

{{#if skipDiff}}
### Diff Previews

_Full diff too large ({{len files}} files). Showing first ~{{linesPerFile}} lines per file._

{{#list files join="\n\n"}}
#### {{path}}

{{#codeblock lang="diff"}}
{{hunksPreview}}
{{/codeblock}}
{{/list}}
{{else}}

### Diff

<diff>
{{rawDiff}}
</diff>
{{/if}}

{{#if additionalInstructions}}
### Additional Instructions

{{additionalInstructions}}
{{/if}}
