#!/usr/bin/env bun
// Live RPC smoke for the yf worker integration, run against a REAL omp.
//
// Validates the integration plumbing without a model turn (no live creds):
//   1. omp --mode rpc boots with the exact lockdown flags the yf driver passes
//      (proves none are rejected by the omp version you're pinning),
//   2. the `{"type":"ready"}` handshake fires,
//   3. `set_host_tools` (submit_result + abort_task) is accepted,
//   4. `get_state` returns the cairn model.
//
// The full model → `submit_result` loop is covered by the cairn-dispatcher Rust
// unit test (scripted server) and the yf integration test (real creds).
//
//   OMP_CMD="bun packages/coding-agent/src/cli.ts" bun deploy/yf-worker/smoke-rpc.ts
//   OMP_CMD="/path/to/dist/omp" bun deploy/yf-worker/smoke-rpc.ts   # test the binary
import { $ } from "bun";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const here = import.meta.dir;
const ompCmd = (Bun.env.OMP_CMD ?? "bun packages/coding-agent/src/cli.ts").split(" ");

const home = await fs.mkdtemp(path.join(os.tmpdir(), "yf-omp-smoke-"));
await $`cp -a ${path.join(here, "omp-home", ".omp")} ${path.join(home, ".omp")}`.quiet();

// Render models.yml (cairn provider) from a dummy gateway env.
const env = {
	...process.env,
	HOME: home,
	YF_OMP_HOME: home,
	PI_BASE_URL: "http://cairn-gateway.invalid/v1",
	PI_MODEL: "claude-sonnet-4-6",
	PI_PROVIDER_API: "anthropic",
	PI_API_KEY: "dummy-key-smoke",
	PI_NO_PTY: "1",
};
await $`${path.join(here, "render-models.sh")}`.env(env).quiet();

// The exact lockdown argv the OmpRpcDriver builds (modern omp flags).
const args = [
	"--mode", "rpc",
	"--model", "cairn/claude-sonnet-4-6",
	"--tools", "read,write,edit,bash,search,find,todo",
	"--no-extensions", "--no-skills", "--no-lsp",
	"--no-session",
	"--append-system-prompt", "Conclude every task by calling submit_result exactly once.",
];

const proc = Bun.spawn([...ompCmd, ...args], {
	cwd: path.join(here, "..", ".."),
	env,
	stdin: "pipe",
	stdout: "pipe",
	stderr: "inherit",
});

const decoder = new TextDecoder();
const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
let buffer = "";

function send(obj: unknown) {
	proc.stdin.write(`${JSON.stringify(obj)}\n`);
	proc.stdin.flush();
}

async function nextFrame(budgetMs: number): Promise<Record<string, unknown>> {
	const deadline = Date.now() + budgetMs;
	for (;;) {
		const nl = buffer.indexOf("\n");
		if (nl >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line) return JSON.parse(line) as Record<string, unknown>;
			continue;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("timed out waiting for an RPC frame");
		const chunk = await Promise.race([
			reader.read(),
			new Promise<{ timeout: true }>((r) => setTimeout(() => r({ timeout: true }), remaining)),
		]);
		if ("timeout" in chunk) throw new Error("timed out waiting for an RPC frame");
		if (chunk.done) throw new Error("omp closed stdout before the expected frame");
		buffer += decoder.decode(chunk.value, { stream: true });
	}
}

async function waitFor(pred: (f: Record<string, unknown>) => boolean, budgetMs: number) {
	const deadline = Date.now() + budgetMs;
	for (;;) {
		const f = await nextFrame(deadline - Date.now());
		if (pred(f)) return f;
	}
}

let failed = false;
try {
	await waitFor((f) => f.type === "ready", 90_000);
	console.log("✓ ready handshake");

	send({
		id: "1",
		type: "set_host_tools",
		tools: [
			{
				name: "submit_result",
				label: "Submit Result",
				description: "Conclude the task.",
				parameters: {
					type: "object",
					properties: { accepted: { type: "boolean" }, data: { type: "object", additionalProperties: true } },
					required: ["accepted", "data"],
					additionalProperties: false,
				},
			},
			{
				name: "abort_task",
				label: "Abort Task",
				description: "Abandon the task.",
				parameters: {
					type: "object",
					properties: { reason: { type: "string" } },
					required: ["reason"],
					additionalProperties: false,
				},
			},
		],
	});
	const shtResp = await waitFor((f) => f.type === "response" && f.id === "1", 30_000);
	if (!shtResp.success) throw new Error(`set_host_tools failed: ${JSON.stringify(shtResp)}`);
	console.log("✓ set_host_tools accepted:", JSON.stringify((shtResp.data as Record<string, unknown>) ?? {}));

	send({ id: "2", type: "get_state" });
	const stateResp = await waitFor((f) => f.type === "response" && f.id === "2", 30_000);
	if (!stateResp.success) throw new Error(`get_state failed: ${JSON.stringify(stateResp)}`);
	const model = (stateResp.data as { model?: { provider?: string; id?: string } } | undefined)?.model;
	console.log("✓ get_state model:", JSON.stringify(model));
	if (model?.provider !== "cairn") {
		throw new Error(`expected cairn provider, got ${JSON.stringify(model)}`);
	}
	console.log("\nSMOKE PASS ✓ — flags accepted, handshake + host tools + cairn model all good.");
} catch (err) {
	failed = true;
	console.error("\nSMOKE FAIL ✗ —", err instanceof Error ? err.message : err);
} finally {
	try {
		proc.stdin.end();
	} catch {}
	proc.kill();
	await proc.exited;
	await fs.rm(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
