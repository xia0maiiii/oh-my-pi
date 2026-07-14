import { describe, expect, it } from "bun:test";
import { $which } from "@oh-my-pi/pi-utils";
import { PYTHON_PRELUDE } from "../prelude";

describe("python prelude", () => {
	it("exposes read(path, offset?, limit?) with positional optional args", () => {
		// The eval docs advertise `read(path, offset?=1, limit?=None)`. A
		// keyword-only signature (`def read(path, *, offset=1, limit=None)`)
		// makes `read("file", 10)` raise `TypeError: read() takes 1 positional
		// argument but 2 were given`, which agents in the wild repeatedly hit.
		// Lock the contract so the helper accepts both positional and keyword
		// forms.
		const match = PYTHON_PRELUDE.match(/def\s+read\(([^)]+)\)/);
		expect(match).not.toBeNull();
		const signature = match?.[1] ?? "";
		expect(signature).not.toContain("*,");
		expect(signature).toContain("offset");
		expect(signature).toContain("limit");
	});

	it("exposes isolation artifacts on the agent() handle node", () => {
		// agent(..., handle=True) is the only escape hatch for
		// recovering apply=False patch/branch/nested artifacts (the bare
		// schema return is just the parsed object), so the helper MUST
		// translate the bridge's camelCase details onto the node — otherwise
		// an isolated apply=False workflow loses captured nested patches.
		expect(PYTHON_PRELUDE).toContain('("patchPath", "patch_path")');
		expect(PYTHON_PRELUDE).toContain('("branchName", "branch_name")');
		expect(PYTHON_PRELUDE).toContain('("nestedPatches", "nested_patches")');
		expect(PYTHON_PRELUDE).toContain('("changesApplied", "changes_applied")');
		expect(PYTHON_PRELUDE).toContain('("isolationSummary", "isolation_summary")');
	});
});

const PYTHON = $which("python3") ?? $which("python");

describe.skipIf(!PYTHON)("python prelude runtime", () => {
	it("omits the agent field so the host can select the session-profile default", async () => {
		const script = `
import json
source = ${JSON.stringify(PYTHON_PRELUDE)}
captured = {}
namespace = {"__omp_display": lambda *args, **kwargs: None}
exec(source, namespace)
def bridge(name, args):
    captured["name"] = name
    captured["args"] = args
    return {"text": "done"}
namespace["_bridge_call"] = bridge
result = namespace["agent"]("probe")
print(json.dumps({"captured": captured, "result": result}))
`;
		const proc = Bun.spawn([PYTHON!, "-c", script], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			captured: { name: "__agent__", args: { prompt: "probe" } },
			result: "done",
		});
	});
});
