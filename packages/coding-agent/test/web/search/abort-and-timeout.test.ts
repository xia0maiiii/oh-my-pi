/**
 * Regression coverage for issue #1221: `web_search` froze when an upstream
 * provider stalled because Bun's WinHTTP fetch could ignore `AbortSignal`,
 * and `executeSearch` masked the eventual `AbortError` as a normal provider
 * failure.
 *
 * The fix has two halves: a hard-timeout safety net wrapped around every
 * provider's outbound fetch (via the shared `withHardTimeout` helper), and
 * an abort re-throw in search execution so the session sees a real
 * cancellation instead of an xAI provider failure. The provider wiring is
 * spot-checked on anthropic (LLM-backed) and brave (pure search API); the
 * helper itself is exercised directly.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AuthStorage, FetchImpl } from "@oh-my-pi/pi-ai";
import type { AgentStorage } from "@oh-my-pi/pi-coding-agent/session/agent-storage";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { runSearchQuery, WebSearchTool } from "@oh-my-pi/pi-coding-agent/web/search";
import * as provider from "@oh-my-pi/pi-coding-agent/web/search/provider";
import { searchAnthropic } from "@oh-my-pi/pi-coding-agent/web/search/providers/anthropic";
import type { SearchParams } from "@oh-my-pi/pi-coding-agent/web/search/providers/base";
import { searchBrave } from "@oh-my-pi/pi-coding-agent/web/search/providers/brave";
import { withHardTimeout } from "@oh-my-pi/pi-coding-agent/web/search/providers/utils";
import {
	SearchProviderError,
	type SearchProviderId,
	type SearchResponse,
} from "@oh-my-pi/pi-coding-agent/web/search/types";

const fakeAuthStorage = {
	getOAuthAccess: async () => undefined,
	rotateSessionCredential: async () => false,
	hasOAuth: () => false,
} as unknown as AuthStorage;
const FAKE_SESSION = { authStorage: fakeAuthStorage } as ToolSession;
const fakeStorage = {
	listAuthCredentials: () => [],
	updateAuthCredential: () => undefined,
	get authStore() {
		return null as never;
	},
} as unknown as AgentStorage;

describe("withHardTimeout", () => {
	it("returns a signal that aborts on the hard timeout when no caller signal is supplied", async () => {
		const signal = withHardTimeout(undefined, 10);
		await Bun.sleep(40);
		expect(signal.aborted).toBe(true);
	});

	it("forwards a caller signal's abort to the composed signal", () => {
		const ac = new AbortController();
		const signal = withHardTimeout(ac.signal, 60_000);
		ac.abort(new Error("user-cancel"));
		expect(signal.aborted).toBe(true);
	});

	it("fires the hard timeout even when the caller signal stays open", async () => {
		const ac = new AbortController();
		const signal = withHardTimeout(ac.signal, 10);
		await Bun.sleep(40);
		expect(signal.aborted).toBe(true);
		expect(ac.signal.aborted).toBe(false);
	});
});

describe("Anthropic provider hard-timeout wiring", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.ANTHROPIC_SEARCH_API_KEY;
		delete process.env.ANTHROPIC_SEARCH_BASE_URL;
	});

	it("passes a composed signal to fetch even when the caller did not supply one", async () => {
		process.env.ANTHROPIC_SEARCH_API_KEY = "sk-test";

		let capturedSignal: AbortSignal | null | undefined;
		const fetchMock: FetchImpl = async (_input, init) => {
			capturedSignal = init?.signal;
			return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		await searchAnthropic({ query: "ping", system_prompt: "", fetch: fetchMock }, fakeStorage);

		// Without the hard-timeout wrapper, init.signal would be undefined when
		// the caller didn't supply one — leaving fetch with no cancellation at
		// all on a stalled WinHTTP connection.
		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal?.aborted).toBe(false);
	});

	it("composes the caller signal with the hard timeout instead of forwarding it directly", async () => {
		process.env.ANTHROPIC_SEARCH_API_KEY = "sk-test";

		const ac = new AbortController();
		let capturedSignal: AbortSignal | null | undefined;
		const fetchMock: FetchImpl = async (_input, init) => {
			capturedSignal = init?.signal;
			return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		await searchAnthropic({ query: "ping", system_prompt: "", signal: ac.signal, fetch: fetchMock }, fakeStorage);

		// The signal handed to fetch must be a *composed* one, not the raw
		// caller signal: that's what guarantees the hard timeout fires even
		// when Bun fails to honour the caller's abort.
		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal).not.toBe(ac.signal);
	});
	it("applies ANTHROPIC_SEARCH_BASE_URL to stored Anthropic credentials", async () => {
		process.env.ANTHROPIC_SEARCH_BASE_URL = "https://search.example.test/";

		let capturedUrl: string | undefined;
		const fetchMock: FetchImpl = async input => {
			capturedUrl = String(input);
			return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		await searchAnthropic({
			query: "ping",
			systemPrompt: "",
			fetch: fetchMock,
			authStorage: {
				getApiKey: async () => "sk-fallback",
				resolver: vi.fn(() => async () => "sk-fallback"),
				getOAuthAccountId: () => undefined,
			} as unknown as AuthStorage,
		});

		expect(capturedUrl).toBe("https://search.example.test/v1/messages?beta=true");
	});
});

describe("Brave provider hard-timeout wiring", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.BRAVE_API_KEY;
	});

	it("hands fetch a composed signal even with no caller signal — confirms the rollout reaches non-Anthropic providers", async () => {
		process.env.BRAVE_API_KEY = "brave-test-key";

		let capturedSignal: AbortSignal | null | undefined;
		const fetchMock: FetchImpl = async (_input, init) => {
			capturedSignal = init?.signal;
			return new Response(JSON.stringify({ web: { results: [] } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		await searchBrave({ query: "ping", fetch: fetchMock });

		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal?.aborted).toBe(false);
	});
});

describe("executeSearch abort propagation", () => {
	afterEach(() => vi.restoreAllMocks());

	function fakeProvider(
		id: SearchProviderId,
		behaviour: (params: SearchParams) => Promise<SearchResponse>,
	): provider.SearchProvider {
		return {
			id,
			label: id === "xai" ? "xAI" : id,
			isAvailable: () => true,
			isExplicitlyAvailable: () => true,
			search: behaviour,
		};
	}

	it("surfaces caller cancellation as ToolAbortError on the xAI route", async () => {
		const xaiSearch = vi.fn(async () => {
			throw new DOMException("aborted", "AbortError");
		});
		vi.spyOn(provider, "getSearchProvider").mockResolvedValue(fakeProvider("xai", xaiSearch));

		const tool = new WebSearchTool(FAKE_SESSION);
		const ac = new AbortController();
		ac.abort();

		await expect(tool.execute("test-id", { query: "anything" }, ac.signal)).rejects.toBeInstanceOf(ToolAbortError);
		expect(xaiSearch).toHaveBeenCalledTimes(1);
	});

	it("reports an xAI failure without falling back to another provider", async () => {
		const xaiSearch = vi.fn(async () => {
			throw new SearchProviderError("xai", "forbidden", 403);
		});
		const getProvider = vi.spyOn(provider, "getSearchProvider").mockResolvedValue(fakeProvider("xai", xaiSearch));

		const tool = new WebSearchTool(FAKE_SESSION);
		const result = await tool.execute("test-id", { query: "anything" });
		const block = result.content[0];
		expect(block?.type).toBe("text");
		expect(block && "text" in block ? block.text : "").toContain("xAI Grok OAuth authorization failed (403)");
		expect(result.details?.error).toBe(
			"xAI Grok OAuth authorization failed (403). Re-run /login and verify the account has SuperGrok or X Premium+.",
		);
		expect(result.details?.response.provider).toBe("xai");
		expect(getProvider.mock.calls).toEqual([["xai"]]);
		expect(xaiSearch).toHaveBeenCalledTimes(1);
	});

	it("reports an empty xAI response without falling back", async () => {
		const xaiSearch = vi.fn(
			async (): Promise<SearchResponse> => ({
				provider: "xai",
				sources: [],
			}),
		);
		const getProvider = vi.spyOn(provider, "getSearchProvider").mockResolvedValue(fakeProvider("xai", xaiSearch));

		const tool = new WebSearchTool(FAKE_SESSION);
		const result = await tool.execute("test-id", { query: "anything" });

		const block = result.content[0];
		expect(block?.type).toBe("text");
		expect(block && "text" in block ? block.text : "").toContain("xAI returned no renderable search content");
		expect(result.details?.error).toContain("xAI returned no renderable search content");
		expect(result.details?.response.provider).toBe("xai");
		expect(getProvider.mock.calls).toEqual([["xai"]]);
		expect(xaiSearch).toHaveBeenCalledTimes(1);
	});

	it("rejects an explicitly requested non-xAI provider before search execution", async () => {
		const getProvider = vi.spyOn(provider, "getSearchProvider");

		const result = await runSearchQuery({ query: "anything", provider: "brave" }, { authStorage: fakeAuthStorage });

		expect(result.details?.error).toBe('Web search is locked to xAI Grok OAuth; provider "brave" is not allowed.');
		expect(result.details?.response).toEqual({ provider: "none", sources: [] });
		expect(getProvider).not.toHaveBeenCalled();
	});
});
