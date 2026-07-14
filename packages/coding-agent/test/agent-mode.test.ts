import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import { type AgentMode, resolveAgentMode } from "@oh-my-pi/pi-coding-agent/config/agent-mode";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { GoalRuntime } from "@oh-my-pi/pi-coding-agent/goals/runtime";
import type { GoalModeState } from "@oh-my-pi/pi-coding-agent/goals/state";
import { runRootCommand } from "@oh-my-pi/pi-coding-agent/main";
import { renderOrchestrateNotice } from "@oh-my-pi/pi-coding-agent/modes/orchestrate";
import { renderWorkflowNotice } from "@oh-my-pi/pi-coding-agent/modes/workflow";
import type { CreateAgentSessionOptions } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { buildSystemPrompt } from "@oh-my-pi/pi-coding-agent/system-prompt";
import { clearBundledAgentsCache, loadBundledAgents } from "../src/task/agents";
import { cleanupTempHome } from "./helpers/temp-home-cleanup";

const EMPTY_TREE = {
	rootPath: "",
	rendered: "",
	truncated: false,
	totalLines: 0,
	agentsMdFiles: [],
};

describe("agent mode", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-mode-"));
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-mode-home-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHomeDir;
		clearBundledAgentsCache();
	});

	afterEach(
		cleanupTempHome(() => {
			clearBundledAgentsCache();
			return { tempDir, tempHomeDir, originalHome };
		}),
	);

	async function render(agentMode: AgentMode, resolvedCustomPrompt?: string): Promise<string> {
		const { systemPrompt } = await buildSystemPrompt({
			agentMode,
			cwd: tempDir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: [],
			workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
			resolvedCustomPrompt,
		});
		return systemPrompt.join("\n\n");
	}

	it("defaults settings to redteam and accepts an explicit coding profile", () => {
		expect(Settings.isolated({}).get("agentMode")).toBe("redteam");
		expect(Settings.isolated({ agentMode: "coding" }).get("agentMode")).toBe("coding");
	});

	it("parses the startup profile flag without leaking its value into the prompt", () => {
		const parsed = parseArgs(["--agent-mode=redteam", "validate target"]);
		expect(parsed.agentMode).toBe("redteam");
		expect(parsed.messages).toEqual(["validate target"]);
		expect(parseArgs(["--agent-mode", "unknown"]).agentMode).toBeUndefined();
	});

	it("keeps persisted sessions pinned before applying startup flags or settings", () => {
		expect(resolveAgentMode("coding", "redteam", "coding")).toBe("redteam");
		expect(resolveAgentMode("redteam", undefined, "coding")).toBe("redteam");
		expect(resolveAgentMode(undefined, undefined, "coding")).toBe("coding");
	});

	it("forwards the startup profile to session creation", async () => {
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const settings = Settings.isolated({ "marketplace.autoUpdate": "off" });
		const parsed = parseArgs(["--agent-mode", "redteam", "--print", "validate target"]);
		parsed.noExtensions = true;
		parsed.noSkills = true;
		parsed.noRules = true;
		parsed.noTools = true;
		parsed.noLsp = true;
		parsed.sessionDir = path.join(tempDir, "sessions");
		let observedOptions: CreateAgentSessionOptions | undefined;

		try {
			await runRootCommand(parsed, ["--agent-mode", "redteam", "--print", "validate target"], {
				discoverAuthStorage: async () => authStorage,
				settings,
				createAgentSession: async options => {
					observedOptions = options;
					throw new Error("stop after session options");
				},
			});
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "stop after session options") throw error;
		} finally {
			authStorage.close();
		}

		expect(observedOptions?.agentMode).toBe("redteam");
	});

	it("keeps the coding prompt generic and layers redteam behavior only when selected", async () => {
		const coding = await render("coding");
		const redteam = await render("redteam");

		expect(coding).toContain("Optimize for correctness first");
		expect(coding).not.toContain('<agent-mode name="redteam">');
		expect(redteam).toContain("Optimize for correctness first");
		expect(redteam).toContain('<agent-mode name="redteam">');
		expect(redteam).toContain("complete Burp-style request and response");
	});

	it("preserves custom system prompt replacement semantics", async () => {
		const rendered = await render("redteam", "CUSTOM PROFILE OVERRIDE");
		expect(rendered).toContain("CUSTOM PROFILE OVERRIDE");
		expect(rendered).not.toContain('<agent-mode name="redteam">');
	});

	it("selects profile-specific goal and orchestration guidance", () => {
		const goalState: GoalModeState = {
			enabled: true,
			mode: "active",
			goal: {
				id: "goal-1",
				objective: "Validate the assigned target",
				status: "active",
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: 1,
				updatedAt: 1,
			},
		};
		const buildGoalPrompt = (agentMode: AgentMode): string => {
			const runtime = new GoalRuntime({
				agentMode,
				getState: () => goalState,
				setState: () => {},
				getCurrentUsage: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
				emit: () => {},
				persist: () => {},
				sendHiddenMessage: async () => {},
			});
			return runtime.buildActivePrompt() ?? "";
		};

		expect(buildGoalPrompt("coding")).not.toContain("full Burp request+response");
		expect(buildGoalPrompt("redteam")).toContain("full Burp request+response");
		expect(renderOrchestrateNotice("coding")).not.toContain("full Burp messages");
		expect(renderOrchestrateNotice("redteam")).toContain("full Burp messages");
		expect(renderWorkflowNotice({ taskBatch: true, agentMode: "coding" })).not.toContain(
			"hard bans (DoS/destructive delete)",
		);
		expect(renderWorkflowNotice({ taskBatch: true, agentMode: "redteam" })).toContain(
			"hard bans (DoS/destructive delete)",
		);
	});

	it("persists the selected profile across resume and new-session boundaries", async () => {
		const sessionDir = path.join(tempDir, "sessions");
		const manager = SessionManager.create(tempDir, sessionDir);
		manager.setAgentMode("redteam");
		await manager.ensureOnDisk();
		const sessionFile = manager.getSessionFile();
		expect(sessionFile).toBeString();
		await manager.close();

		const resumed = await SessionManager.open(sessionFile!, sessionDir);
		expect(resumed.getHeader()?.agentMode).toBe("redteam");
		await resumed.newSession();
		expect(resumed.getHeader()?.agentMode).toBe("redteam");
		await resumed.close();
	});

	it("keeps per-mode bundled-agent caches isolated", () => {
		const redteamNames = loadBundledAgents("redteam").map(agent => agent.name);
		const codingNames = loadBundledAgents("coding").map(agent => agent.name);

		expect(redteamNames).toContain("recon");
		expect(redteamNames).toContain("redteam");
		expect(redteamNames).toContain("task");
		expect(codingNames).toContain("task");
		expect(codingNames).not.toContain("recon");
		expect(codingNames).not.toContain("redteam");
	});
});
