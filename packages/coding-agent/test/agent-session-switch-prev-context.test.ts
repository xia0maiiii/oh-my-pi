import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { AgentMode } from "@oh-my-pi/pi-coding-agent/config/agent-mode";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import type { BuildSessionContextOptions, SessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

/**
 * Regression for issue #3846: in-TUI `/resume` rebuilt the *previous*
 * session's display context before switching files. That call expands persisted
 * snapcompact archives and `openaiRemoteCompaction.replacementHistory` payloads
 * into messages, which can OOM on huge pre-fix sessions even though the loader
 * itself streams. The previous context is only needed for same-session reloads
 * (where `#didSessionMessagesChange` compares against the freshly rebuilt one);
 * different-session switches MUST skip that work.
 */
describe("AgentSession.switchSession previous-context build", () => {
	let sharedDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;
	const tempDirs: TempDir[] = [];
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-switch-prev-ctx-shared-");
		authStorage = await AuthStorage.create(path.join(sharedDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in anthropic model to exist");
		model = bundled;
	});

	afterAll(async () => {
		authStorage.close();
		try {
			await sharedDir.remove();
		} catch {}
	});

	afterEach(async () => {
		while (sessions.length > 0) {
			await sessions.pop()?.dispose();
		}
		for (const dir of tempDirs.splice(0)) {
			try {
				await dir.remove();
			} catch {}
		}
	});

	function buildSessionWithManager(
		sessionManager: SessionManager,
		settings: Settings,
		agentMode?: AgentMode,
	): { session: AgentSession; sessionManager: SessionManager } {
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		const session = new AgentSession({
			agent,
			sessionManager,
			settings,
			agentMode,
			modelRegistry,
		});
		sessions.push(session);
		return { session, sessionManager };
	}

	function buildSession(
		tempDir: TempDir,
		agentMode: AgentMode = "coding",
	): { session: AgentSession; sessionManager: SessionManager } {
		return buildSessionWithManager(
			SessionManager.create(tempDir.path(), tempDir.path()),
			Settings.isolated({ "compaction.enabled": false }),
			agentMode,
		);
	}

	async function writeLegacyV3Session(tempDir: TempDir, id: string): Promise<string> {
		const sessionFile = path.join(tempDir.path(), `${id}.jsonl`);
		const timestamp = "2025-01-01T00:00:00.000Z";
		await Bun.write(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id,
				timestamp,
				cwd: tempDir.path(),
			})}\n${JSON.stringify({
				type: "message",
				id: `${id}-message`,
				parentId: null,
				timestamp,
				message: { role: "user", content: "legacy", timestamp: 1 },
			})}\n`,
		);
		return sessionFile;
	}

	/** Wrap `sessionManager.buildSessionContext` so each call's caller-visible
	 *  state (the manager's currently-loaded session file) is recorded in
	 *  invocation order. The constructor itself calls `buildSessionContext`
	 *  once; spying *after* construction means only switchSession-driven calls
	 *  are observed. */
	function instrumentBuildSessionContext(sessionManager: SessionManager): {
		calls: Array<{ sessionFile: string | undefined; transcript: boolean | undefined }>;
		restore: () => void;
	} {
		const calls: Array<{ sessionFile: string | undefined; transcript: boolean | undefined }> = [];
		const original = sessionManager.buildSessionContext.bind(sessionManager);
		const patched = (options?: BuildSessionContextOptions): SessionContext => {
			calls.push({ sessionFile: sessionManager.getSessionFile(), transcript: options?.transcript });
			return original(options);
		};
		sessionManager.buildSessionContext = patched as SessionManager["buildSessionContext"];
		return {
			calls,
			restore: () => {
				sessionManager.buildSessionContext = original;
			},
		};
	}

	it("skips building the previous display context when switching to a different session", async () => {
		const tempDir = TempDir.createSync("@pi-switch-prev-ctx-different-");
		tempDirs.push(tempDir);

		const { session, sessionManager } = buildSession(tempDir);
		sessionManager.appendMessage({ role: "user", content: "previous", timestamp: 1 });
		await sessionManager.flush();
		const previousSessionFile = sessionManager.getSessionFile();
		expect(previousSessionFile).toBeString();

		const otherManager = SessionManager.create(tempDir.path(), tempDir.path());
		otherManager.appendMessage({ role: "user", content: "target", timestamp: 2 });
		await otherManager.flush();
		const targetSessionFile = otherManager.getSessionFile();
		expect(targetSessionFile).toBeString();
		expect(targetSessionFile).not.toBe(previousSessionFile);
		await otherManager.close();

		const { calls, restore } = instrumentBuildSessionContext(sessionManager);
		try {
			const switched = await session.switchSession(targetSessionFile!);
			expect(switched).toBe(true);
			expect(session.sessionFile).toBe(targetSessionFile);
		} finally {
			restore();
		}

		// The previous session's display context MUST NOT be materialized. Only
		// the new target context (post-`setSessionFile`) should be built.
		expect(calls).toEqual([{ sessionFile: targetSessionFile!, transcript: undefined }]);
	});

	it("rejects in-place switches to a session with another profile", async () => {
		const tempDir = TempDir.createSync("@pi-switch-profile-");
		tempDirs.push(tempDir);

		const { session, sessionManager } = buildSession(tempDir, "coding");
		sessionManager.appendMessage({ role: "user", content: "coding", timestamp: 1 });
		await sessionManager.flush();
		const originalFile = sessionManager.getSessionFile();

		const redteamManager = SessionManager.create(tempDir.path(), tempDir.path());
		redteamManager.setAgentMode("redteam");
		redteamManager.appendMessage({ role: "user", content: "redteam", timestamp: 2 });
		await redteamManager.ensureOnDisk();
		const redteamFile = redteamManager.getSessionFile();
		expect(redteamFile).toBeString();
		expect(redteamManager.getHeader()?.agentMode).toBe("redteam");
		expect((await redteamManager.readSessionHeader(redteamFile!))?.agentMode).toBe("redteam");
		await redteamManager.close();

		await expect(session.switchSession(redteamFile!)).rejects.toThrow(
			"Cannot switch from a coding session to a redteam session in place",
		);
		expect(session.sessionFile).toBe(originalFile);
	});

	it("resumes legacy v3 sessions as coding under a redteam global default", async () => {
		const tempDir = TempDir.createSync("@pi-switch-legacy-resume-");
		tempDirs.push(tempDir);
		const legacyFile = await writeLegacyV3Session(tempDir, "legacy-resume");
		const legacyManager = await SessionManager.open(legacyFile, tempDir.path());

		const { session } = buildSessionWithManager(
			legacyManager,
			Settings.isolated({ agentMode: "redteam", "compaction.enabled": false }),
		);

		expect(session.agentMode).toBe("coding");
		expect(legacyManager.getHeader()?.version).toBe(4);
		expect(legacyManager.getHeader()?.agentMode).toBe("coding");
	});

	it("rejects switching a redteam session to a legacy v3 coding session", async () => {
		const tempDir = TempDir.createSync("@pi-switch-legacy-guard-");
		tempDirs.push(tempDir);
		const legacyFile = await writeLegacyV3Session(tempDir, "legacy-switch");
		const { session } = buildSession(tempDir, "redteam");

		expect((await session.sessionManager.readSessionHeader(legacyFile))?.agentMode).toBe("coding");
		await expect(session.switchSession(legacyFile)).rejects.toThrow(
			"Cannot switch from a redteam session to a coding session in place",
		);
	});

	it("builds the previous display context for same-session reloads", async () => {
		const tempDir = TempDir.createSync("@pi-switch-prev-ctx-reload-");
		tempDirs.push(tempDir);

		const { session, sessionManager } = buildSession(tempDir);
		sessionManager.appendMessage({ role: "user", content: "current", timestamp: 1 });
		await sessionManager.flush();
		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeString();

		const { calls, restore } = instrumentBuildSessionContext(sessionManager);
		try {
			const switched = await session.switchSession(sessionFile!);
			expect(switched).toBe(true);
			expect(session.sessionFile).toBe(sessionFile);
		} finally {
			restore();
		}

		// Same-session reload must snapshot the pre-reload context so
		// `#didSessionMessagesChange` can detect rollback edits.
		expect(calls).toEqual([
			{ sessionFile: sessionFile!, transcript: undefined },
			{ sessionFile: sessionFile!, transcript: undefined },
		]);
	});
});
