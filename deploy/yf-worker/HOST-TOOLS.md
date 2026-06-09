# Host-tool contract (yf ⇄ omp RPC)

Canonical spec for the host tools the **yf Rust driver** registers via `set_host_tools`
(`../../docs/rpc.md` §"Host Tool Sub-Protocol"). This file is the shared source of truth: the omp
side enforces "always call `submit_result`" via `prompts/yf-contract.md`; the yf side
(`cairn-dispatcher` `OmpRpcDriver`, Workstream C) implements the execution handlers below.

Wire flow per call: omp emits `host_tool_call {id, toolCallId, toolName, arguments}` →
yf executes → yf replies `host_tool_result {id, result:{content:[{type:"text",text}]}}`
(set `isError:true` to surface a tool error). Optional `host_tool_update` for progress.

## Terminal tools (conclude the task)

### `submit_result` — REQUIRED, exactly once per task

The model's only sanctioned way to finish. `parameters` is **task-type specific** — the driver
sends the JSON Schema matching the current task (`reason` / `explore` / `bootstrap` / `report`),
so the model sees the exact `data` shape. Mirrors yf's existing payload contract
(`cairn-core/src/contracts.rs`, `{"accepted": bool, "data": {…}}`).

```jsonc
// set_host_tools entry (reason task example)
{
  "name": "submit_result",
  "label": "Submit Result",
  "description": "Conclude the task. Call exactly once with the final structured result.",
  "parameters": {
    "type": "object",
    "properties": {
      "accepted": { "type": "boolean", "description": "true if the task goal was met" },
      "data": {
        "type": "object",
        "description": "Task-specific payload; shape set per task type by the driver",
        "additionalProperties": true
      }
    },
    "required": ["accepted", "data"],
    "additionalProperties": false
  }
}
```

Driver handling: validate `arguments` against the task contract. On success → reply a short ack
(`"recorded"`) and resolve the task with the typed payload. On schema failure → reply
`isError:true` with the validation error so the model **retries `submit_result`** in-loop (this is
where output-schema enforcement lives — yf-side, not an omp core change).

### `abort_task` — optional, terminal

`{ "reason": { "type": "string" } }`. Model abandons the task (out of scope, blocked, unsafe).
Driver records a rejection outcome and resolves.

## Pentest tools (require orchestrator context)

Anything needing yf state (project id, cairn API auth, the proxy gateway, evidence store) is a host
tool so its implementation stays in yf (Rust), versioned with yf — not baked into omp. The model
reaches local CLIs already in the image (e.g. `proxychains4`, scanners) directly through omp's
`bash` tool; only context-bound actions become host tools. Representative set:

| tool | parameters | host-side action |
| ---- | ---------- | ---------------- |
| `upload_evidence` | `{ path: string, label?: string }` | push artifact to the cairn evidence store for this project |
| `record_fact` | `{ fact: object }` | persist an intermediate finding to the cairn API |
| `proxied_request` | `{ method, url, body? }` | perform a request through the engagement proxy with scope enforcement |

These are **examples** — the authoritative list is whatever `OmpRpcDriver` registers per task type.
Keep names/JSON-Schemas in sync between this file and the Rust `host_tool` builders.

## Invariants

- Tool names and parameter JSON-Schemas must match exactly between this doc and the Rust builders.
- `submit_result` and `abort_task` are the **only** terminal tools; everything else returns control
  to the model loop.
- Re-sending `set_host_tools` replaces the whole set — register the full per-task set once before
  the first `prompt`.
