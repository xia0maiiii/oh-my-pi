## Deliverable / Finding Review Request

### Mode

{{mode}}

### Materials under review ({{len files}} files, +{{totalAdded}}/-{{totalRemoved}} lines)

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

Use the `task` tool with `agent: "finding-reviewer"` and a `tasks` array.
{{#when agentCount "==" 1}}Create exactly **1 finding-reviewer task**.{{else}}Spawn **{{agentCount}} finding-reviewer agents** in parallel.{{/when}}
{{#if multiAgent}}
Group materials by locality, e.g.:
- Same app/host → same agent
- Related attack surface → same agent
- Finding with its evidence/PoC → same agent
{{/if}}

### Reviewer Instructions

Reviewer MUST:
0. Focus on reproducibility, evidence strength, impact inflation; for HTTP(S) findings, whether full Burp request+response is present
1. Focus ONLY on assigned files
2. {{#if skipDiff}}{{diffInstruction}}{{else}}MUST use diff hunks below (NEVER re-run git diff){{/if}}
3. {{contextInstruction}}
4. Use incremental `yield` sections for findings and verdict fields; do NOT call a separate finding tool

{{#if skipDiff}}
### Diff Previews

_Full diff too large ({{len files}} files). Showing ~{{linesPerFile}} lines per file._

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
