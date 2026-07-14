import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as sdk from "@oh-my-pi/pi-coding-agent/sdk";
import { __resetDirsFromEnvForTests, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";
import { parseSearchArgs, runSearchCommand } from "../../../src/cli/web-search-cli";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalOmpProfile = process.env.OMP_PROFILE;
const originalPiProfile = process.env.PI_PROFILE;
const originalXaiApiKey = process.env.XAI_API_KEY;

let tempAgentDir: TempDir | undefined;
let originalExitCode: typeof process.exitCode;

function responseUrl(input: string | Request | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function makeAuthStorage(accessToken?: string): AuthStorage {
	return {
		getOAuthAccess: vi.fn(async (provider: string, sessionId?: string) => {
			expect(provider).toBe("xai-oauth");
			expect(sessionId).toBe("cli-web-search");
			return accessToken ? { accessToken } : undefined;
		}),
		rotateSessionCredential: vi.fn(async () => false),
		hasOAuth: vi.fn((provider: string) => provider === "xai-oauth" && Boolean(accessToken)),
	} as unknown as AuthStorage;
}

function makeXAIFetchMock(requests: Array<{ url: string; init?: RequestInit }>): typeof fetch {
	return Object.assign(
		async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			const url = responseUrl(input);
			requests.push({ url, init });
			if (url !== "https://api.x.ai/v1/responses") {
				return new Response(`unexpected URL: ${url}`, { status: 500 });
			}
			return new Response(
				JSON.stringify({
					id: "resp-cli-test",
					model: "grok-4.5",
					output_text: "Grok search answer",
					citations: ["https://example.com/grok-source"],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		},
		{ preconnect: fetch.preconnect },
	);
}

function captureStdout(): { read: () => string } {
	let output = "";
	vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
		output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	});
	return { read: () => stripVTControlCharacters(output) };
}

beforeEach(async () => {
	delete process.env.XAI_API_KEY;
	originalExitCode = process.exitCode;
	process.exitCode = 0;

	resetSettingsForTest();
	tempAgentDir = TempDir.createSync("@omp-search-cli-");
	setAgentDir(tempAgentDir.path());
	await Settings.init({ inMemory: true, cwd: tempAgentDir.path() });
});

afterEach(async () => {
	vi.restoreAllMocks();
	resetSettingsForTest();
	process.exitCode = originalExitCode ?? 0;
	if (originalXaiApiKey === undefined) delete process.env.XAI_API_KEY;
	else process.env.XAI_API_KEY = originalXaiApiKey;
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	if (originalOmpProfile === undefined) delete process.env.OMP_PROFILE;
	else process.env.OMP_PROFILE = originalOmpProfile;
	if (originalPiProfile === undefined) delete process.env.PI_PROFILE;
	else process.env.PI_PROFILE = originalPiProfile;
	__resetDirsFromEnvForTests();
	if (tempAgentDir) {
		await tempAgentDir.remove();
		tempAgentDir = undefined;
	}
});

describe("runSearchCommand Grok-only routing", () => {
	it.each([
		["implicit default", undefined],
		["auto alias", "auto"],
		["explicit xAI", "xai"],
	] as const)("routes the %s through xAI OAuth", async (_caseName, selectedProvider) => {
		vi.spyOn(sdk, "discoverAuthStorage").mockResolvedValue(makeAuthStorage("test-grok-oauth-token"));
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(makeXAIFetchMock(requests));
		const stdout = captureStdout();

		await runSearchCommand({
			query: "provider selection smoke test",
			provider: selectedProvider,
			limit: 1,
			expanded: false,
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://api.x.ai/v1/responses");
		expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer test-grok-oauth-token");
		expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
			model: "grok-4.5",
			tools: [{ type: "web_search" }],
		});
		expect(stdout.read()).toContain("Provider: grok-4.5 @ xAI (OAuth)");
		expect(process.exitCode).toBe(0);
	});

	it("fails clearly without Grok OAuth and does not accept a plain xAI API key", async () => {
		process.env.XAI_API_KEY = "plain-xai-api-key";
		vi.spyOn(sdk, "discoverAuthStorage").mockResolvedValue(makeAuthStorage());
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
		const stdout = captureStdout();

		await runSearchCommand({ query: "missing OAuth", expanded: false });

		expect(stdout.read()).toContain("No xAI Grok OAuth subscription credential");
		expect(stdout.read()).toContain("/login");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it("rejects an explicit non-xAI provider before running search", async () => {
		const parsed = parseSearchArgs(["q", "--provider", "brave", "blocked provider"]);
		expect(parsed).toBeDefined();
		let stderr = "";
		vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
			stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("process.exit");
		}) as typeof process.exit);

		await expect(runSearchCommand(parsed!)).rejects.toThrow("process.exit");

		expect(exitSpy).toHaveBeenCalledWith(1);
		const plain = stripVTControlCharacters(stderr);
		expect(plain).toContain('Unknown provider "brave"');
		expect(plain).toContain("Valid providers: auto, xai");
	});
});
