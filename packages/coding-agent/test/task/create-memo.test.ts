import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AgentMode } from "@oh-my-pi/pi-coding-agent/config/agent-mode";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

const TEST_AGENTS = [
	{
		name: "task",
		description: "General-purpose task agent",
		systemPrompt: "You are a task agent.",
		source: "bundled" as const,
	},
];

function createSession(cwd: string, agentMode: AgentMode = "coding"): ToolSession {
	return {
		cwd,
		agentMode,
		hasUI: false,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as unknown as ToolSession;
}

describe("TaskTool.create discovery memo", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reuses one discovery scan across repeated creations with the same cwd", async () => {
		const spy = vi
			.spyOn(discoveryModule, "discoverAgents")
			.mockResolvedValue({ agents: TEST_AGENTS, projectAgentsDir: null });

		const first = await TaskTool.create(createSession("/tmp"));
		const second = await TaskTool.create(createSession("/tmp"));

		expect(spy).toHaveBeenCalledTimes(1);
		expect(first.description).toBe(second.description);
	});

	it("rescans for a different cwd", async () => {
		const spy = vi
			.spyOn(discoveryModule, "discoverAgents")
			.mockResolvedValue({ agents: TEST_AGENTS, projectAgentsDir: null });

		await TaskTool.create(createSession("/tmp"));
		await TaskTool.create(createSession("/tmp/omp-memo-other"));

		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("does not reuse discovery across profiles in the same cwd", async () => {
		const spy = vi
			.spyOn(discoveryModule, "discoverAgents")
			.mockResolvedValue({ agents: TEST_AGENTS, projectAgentsDir: null });

		await TaskTool.create(createSession("/tmp", "coding"));
		await TaskTool.create(createSession("/tmp", "redteam"));

		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls.map(call => call[2])).toEqual(["coding", "redteam"]);
	});

	it("renders the task contract for the active profile", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: TEST_AGENTS,
			projectAgentsDir: null,
		});

		const coding = await TaskTool.create(createSession("/tmp", "coding"));
		const redteam = await TaskTool.create(createSession("/tmp", "redteam"));

		expect(coding.description).not.toContain("HTTP(S) vulns need full Burp request+response");
		expect(redteam.description).toContain("HTTP(S) vulns need full Burp request+response");
	});

	it("does not cache a rejected discovery", async () => {
		const spy = vi
			.spyOn(discoveryModule, "discoverAgents")
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValue({ agents: TEST_AGENTS, projectAgentsDir: null });

		await expect(TaskTool.create(createSession("/tmp"))).rejects.toThrow("boom");
		const tool = await TaskTool.create(createSession("/tmp"));

		expect(tool.description).toContain("task");
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
