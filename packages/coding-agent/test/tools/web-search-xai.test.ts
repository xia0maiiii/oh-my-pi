import { afterEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import type { AuthStorage, FetchImpl } from "@oh-my-pi/pi-ai";
import { searchXAI, XAIProvider } from "@oh-my-pi/pi-coding-agent/web/search/providers/xai";
import { SearchProviderError } from "@oh-my-pi/pi-coding-agent/web/search/types";

type CapturedRequest = {
	url: string;
	method: string | undefined;
	headers: RequestInit["headers"];
	body: Record<string, unknown> | null;
};

interface FakeAuthCredentials {
	oauthToken?: string;
	xaiApiKey?: string;
	xaiOAuthApiKey?: string;
}

function makeAuthStorage(credentials: FakeAuthCredentials = { oauthToken: "test-xai-oauth-token" }) {
	return {
		async getOAuthAccess(provider: string, sessionId?: string) {
			expect(provider).toBe("xai-oauth");
			expect(sessionId).toBe("session-xai-test");
			return credentials.oauthToken ? { accessToken: credentials.oauthToken } : undefined;
		},
		async rotateSessionCredential(provider: string, sessionId?: string) {
			expect(provider).toBe("xai-oauth");
			expect(sessionId).toBe("session-xai-test");
			return false;
		},
		hasOAuth(provider: string) {
			return provider === "xai-oauth" && Boolean(credentials.oauthToken);
		},
		resolver(_provider: string, options?: { sessionId?: string; baseUrl?: string; modelId?: string }) {
			expect(options?.sessionId).toBe("session-xai-test");
			return async () => credentials.xaiOAuthApiKey ?? credentials.xaiApiKey;
		},
	} as unknown as AuthStorage;
}

function makeParams(fetch: FetchImpl, authStorage: AuthStorage = makeAuthStorage()) {
	return {
		query: "latest xAI web search",
		systemPrompt: "Use web search for current xAI facts.",
		authStorage,
		fetch,
		sessionId: "session-xai-test",
	} as const;
}

function captureFetch(responseBody: Record<string, unknown> | string, status = 200) {
	const capturedRequests: CapturedRequest[] = [];
	const fetchMock: FetchImpl = (input, init) => {
		capturedRequests.push({
			url: typeof input === "string" ? input : input.toString(),
			method: init?.method,
			headers: init?.headers,
			body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
		});
		return Promise.resolve(
			new Response(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	};
	return {
		fetchMock,
		capturedRequests,
		get capturedRequest() {
			return capturedRequests.at(-1) ?? null;
		},
	};
}

function citationUrls(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => `https://example.com/${prefix}-${index + 1}`);
}

describe("xAI web search provider", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		setSystemTime();
	});

	it("POSTs the Responses API with Grok subscription OAuth and the xAI web_search tool payload", async () => {
		const capture = captureFetch({ id: "resp_request", model: "grok-4.5", output_text: "xAI answer" });

		await searchXAI({
			...makeParams(capture.fetchMock),
			maxOutputTokens: 512,
			temperature: 0.2,
		});

		expect(capture.capturedRequest).not.toBeNull();
		expect(capture.capturedRequest?.url).toBe("https://api.x.ai/v1/responses");
		expect(capture.capturedRequest?.method).toBe("POST");
		expect(capture.capturedRequest?.headers).toMatchObject({
			"Content-Type": "application/json",
			Authorization: "Bearer test-xai-oauth-token",
		});
		expect(capture.capturedRequest?.body).toMatchObject({
			model: "grok-4.5",
			input: [
				{ role: "system", content: "Use web search for current xAI facts." },
				{ role: "user", content: "latest xAI web search" },
			],
			tools: [{ type: "web_search" }],
			max_output_tokens: 512,
			temperature: 0.2,
		});
		expect(capture.capturedRequest?.body?.tools).toEqual([{ type: "web_search" }]);
		expect(capture.capturedRequest?.body).not.toHaveProperty("search_parameters");
	});

	it("uses Grok subscription OAuth even when a plain xAI API key is present", async () => {
		const capture = captureFetch({
			id: "resp_xai_oauth_priority",
			model: "grok-4.5",
			output_text: "xAI OAuth answer",
		});

		await searchXAI(
			makeParams(
				capture.fetchMock,
				makeAuthStorage({
					oauthToken: "test-xai-oauth-token",
					xaiApiKey: "test-xai-api-key",
				}),
			),
		);

		expect(capture.capturedRequest).not.toBeNull();
		expect(capture.capturedRequest?.headers).toMatchObject({
			Authorization: "Bearer test-xai-oauth-token",
		});
	});

	it("reports available when only dedicated xAI OAuth credentials exist", () => {
		const provider = new XAIProvider();
		const authStorage = makeAuthStorage({
			oauthToken: "test-xai-oauth-token",
		});

		expect(provider.isAvailable(authStorage)).toBe(true);
	});

	it.each([
		["a plain xAI API key", { xaiApiKey: "test-xai-api-key" }],
		["a static key stored under xai-oauth", { xaiOAuthApiKey: "test-xai-oauth-static-key" }],
	] as const)("rejects %s because search requires a Grok OAuth subscription", async (_caseName, credentials) => {
		const provider = new XAIProvider();
		const authStorage = makeAuthStorage(credentials);
		const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))) as unknown as FetchImpl;

		expect(provider.isAvailable(authStorage)).toBe(false);
		await expect(searchXAI(makeParams(fetchMock, authStorage))).rejects.toThrow(
			"No xAI Grok OAuth subscription credential",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rotates to a sibling Grok subscription after an authorization failure", async () => {
		let activeToken = "oauth-account-a";
		let rotateCalls = 0;
		const authStorage = {
			async getOAuthAccess(provider: string, sessionId?: string) {
				expect(provider).toBe("xai-oauth");
				expect(sessionId).toBe("session-xai-test");
				return { accessToken: activeToken };
			},
			async rotateSessionCredential(provider: string, sessionId?: string) {
				expect(provider).toBe("xai-oauth");
				expect(sessionId).toBe("session-xai-test");
				activeToken = "oauth-account-b";
				rotateCalls += 1;
				return true;
			},
			hasOAuth(provider: string) {
				return provider === "xai-oauth";
			},
		} as unknown as AuthStorage;
		const authorizationHeaders: string[] = [];
		const fetchMock: FetchImpl = (_input, init) => {
			authorizationHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
			if (authorizationHeaders.length === 1) {
				return Promise.resolve(new Response('{"error":"expired"}', { status: 401 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify({ id: "resp_rotated", model: "grok-4.5", output_text: "rotated" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		};

		const response = await searchXAI(makeParams(fetchMock, authStorage));

		expect(response.answer).toBe("rotated");
		expect(authorizationHeaders).toEqual(["Bearer oauth-account-a", "Bearer oauth-account-b"]);
		expect(rotateCalls).toBe(1);
	});

	it("omits search_parameters for minimal web_search requests", async () => {
		const capture = captureFetch({ id: "resp_minimal", model: "grok-4.5", output_text: "minimal xAI answer" });

		await searchXAI(makeParams(capture.fetchMock));

		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
	});

	it.each([
		["limit", { limit: 6 }],
		["numSearchResults", { numSearchResults: 7 }],
		["recency", { recency: "week" }],
		["limit, numSearchResults, and recency", { limit: 0, numSearchResults: 30, recency: "day" }],
		["oversized numSearchResults", { numSearchResults: 99 }],
	] as const)("keeps %s local instead of sending xAI search_parameters", async (_caseName, searchParams) => {
		const capture = captureFetch({ id: "resp_agent_tools", model: "grok-4.5", output_text: "xAI answer" });

		await searchXAI({
			...makeParams(capture.fetchMock),
			...searchParams,
		});

		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("rejects deprecated live-search 410 responses without retrying", async () => {
		const capture = captureFetch("Live search is deprecated. Please use the Agent Tools API.", 410);

		try {
			await searchXAI({
				...makeParams(capture.fetchMock),
				limit: 2,
				numSearchResults: 5,
				recency: "week",
			});
			expect.unreachable("xAI HTTP 410 deprecation failure should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(SearchProviderError);
			expect(error).toMatchObject({
				provider: "xai",
				status: 410,
				message: "xAI Responses API error (410): Live search is deprecated. Please use the Agent Tools API.",
			});
		}

		expect(capture.capturedRequests).toHaveLength(1);
		const body = capture.capturedRequests[0]?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("maps output_text, URL citation annotations, top-level citations, id, model, usage, and auth mode", async () => {
		const capture = captureFetch({
			id: "resp_xai_123",
			model: "grok-4.5",
			output_text: "Top-level xAI answer",
			annotations: [
				{
					type: "url_citation",
					url: "https://example.com/top-annotation",
					title: "Top Annotation",
					text: "Top annotation text",
				},
			],
			output: [
				{
					type: "message",
					annotations: [
						{
							type: "url_citation",
							url: "https://example.com/item-annotation",
							title: "Item Annotation",
							cited_text: "Item annotation text",
						},
					],
					content: [
						{
							type: "output_text",
							text: "Ignored because output_text wins",
							annotations: [
								{
									type: "url_citation",
									url: "https://example.com/annotated",
									title: "Annotated Source",
									cited_text: "Annotated cited text",
								},
							],
						},
					],
				},
			],
			citations: ["https://example.com/top-level-citation"],
			usage: {
				input_tokens: 12,
				output_tokens: 8,
				total_tokens: 20,
			},
		});

		const response = await searchXAI(makeParams(capture.fetchMock));

		expect(response).toMatchObject({
			provider: "xai",
			answer: "Top-level xAI answer",
			requestId: "resp_xai_123",
			model: "grok-4.5",
			authMode: "oauth",
			usage: {
				inputTokens: 12,
				outputTokens: 8,
				totalTokens: 20,
			},
			sources: [
				{
					title: "Top Annotation",
					url: "https://example.com/top-annotation",
					snippet: "Top annotation text",
				},
				{
					title: "Item Annotation",
					url: "https://example.com/item-annotation",
					snippet: "Item annotation text",
				},
				{
					title: "Annotated Source",
					url: "https://example.com/annotated",
					snippet: "Annotated cited text",
				},
				{
					title: "https://example.com/top-level-citation",
					url: "https://example.com/top-level-citation",
				},
			],
			citations: [
				{
					title: "Top Annotation",
					url: "https://example.com/top-annotation",
					citedText: "Top annotation text",
				},
				{
					title: "Item Annotation",
					url: "https://example.com/item-annotation",
					citedText: "Item annotation text",
				},
				{
					title: "Annotated Source",
					url: "https://example.com/annotated",
					citedText: "Annotated cited text",
				},
				{
					title: "https://example.com/top-level-citation",
					url: "https://example.com/top-level-citation",
				},
			],
		});
	});

	it("defaults xAI local cap to 10 sources and citations when no count is requested", async () => {
		const urls = citationUrls("default-cap", 12);
		const capture = captureFetch({
			id: "resp_default_cap",
			model: "grok-4.5",
			output_text: "Default capped xAI answer",
			citations: urls,
		});

		const response = await searchXAI(makeParams(capture.fetchMock));
		const expectedUrls = urls.slice(0, 10);

		expect(response.sources).toHaveLength(10);
		expect(response.citations).toHaveLength(10);
		expect(response.sources.map(source => source.url)).toEqual(expectedUrls);
		expect(response.citations?.map(citation => citation.url)).toEqual(expectedUrls);
		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("clamps oversized xAI local cap requests to 30 sources and citations", async () => {
		const urls = citationUrls("max-cap", 35);
		const capture = captureFetch({
			id: "resp_max_cap",
			model: "grok-4.5",
			output_text: "Max capped xAI answer",
			citations: urls,
		});

		const response = await searchXAI({
			...makeParams(capture.fetchMock),
			numSearchResults: 99,
		});
		const expectedUrls = urls.slice(0, 30);

		expect(response.sources).toHaveLength(30);
		expect(response.citations).toHaveLength(30);
		expect(response.sources.map(source => source.url)).toEqual(expectedUrls);
		expect(response.citations?.map(citation => citation.url)).toEqual(expectedUrls);
		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("caps parsed sources and citations locally without changing Agent Tools request shape", async () => {
		const capture = captureFetch({
			id: "resp_local_cap",
			model: "grok-4.5",
			output_text: "Capped xAI answer",
			annotations: [
				{
					type: "url_citation",
					url: "https://example.com/annotation-1",
					title: "Annotation 1",
					text: "Annotation 1 text",
				},
			],
			output: [
				{
					annotations: [
						{
							type: "url_citation",
							url: "https://example.com/annotation-2",
							title: "Annotation 2",
							cited_text: "Annotation 2 text",
						},
					],
					content: [
						{
							type: "output_text",
							text: "Ignored because output_text wins",
							annotations: [
								{
									type: "url_citation",
									url: "https://example.com/annotation-3",
									title: "Annotation 3",
									cited_text: "Annotation 3 text",
								},
							],
						},
					],
				},
			],
			citations: ["https://example.com/top-level-4", "https://example.com/top-level-5"],
		});

		const response = await searchXAI({
			...makeParams(capture.fetchMock),
			limit: 4,
		});

		expect(response.sources).toHaveLength(4);
		expect(response.citations).toHaveLength(4);
		expect(response.sources.map(source => source.url)).toEqual([
			"https://example.com/annotation-1",
			"https://example.com/annotation-2",
			"https://example.com/annotation-3",
			"https://example.com/top-level-4",
		]);
		expect(response.citations?.map(citation => citation.url)).toEqual([
			"https://example.com/annotation-1",
			"https://example.com/annotation-2",
			"https://example.com/annotation-3",
			"https://example.com/top-level-4",
		]);
		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("uses numSearchResults before limit for the local xAI output cap", async () => {
		const capture = captureFetch({
			id: "resp_num_search_results_cap",
			model: "grok-4.5",
			output_text: "numSearchResults capped xAI answer",
			annotations: [
				{
					type: "url_citation",
					url: "https://example.com/precedence-1",
					title: "Precedence 1",
				},
			],
			citations: [
				"https://example.com/precedence-2",
				"https://example.com/precedence-3",
				"https://example.com/precedence-4",
			],
		});

		const response = await searchXAI({
			...makeParams(capture.fetchMock),
			limit: 1,
			numSearchResults: 3,
		});
		expect(response.sources).toHaveLength(3);
		expect(response.citations).toHaveLength(3);

		expect(response.sources.map(source => source.url)).toEqual([
			"https://example.com/precedence-1",
			"https://example.com/precedence-2",
			"https://example.com/precedence-3",
		]);
		expect(response.citations?.map(citation => citation.url)).toEqual([
			"https://example.com/precedence-1",
			"https://example.com/precedence-2",
			"https://example.com/precedence-3",
		]);
		expect(capture.capturedRequest).not.toBeNull();
		const body = capture.capturedRequest?.body;
		expect(body?.tools).toEqual([{ type: "web_search" }]);
		expect(body).not.toHaveProperty("search_parameters");
		expect(Object.keys(body ?? {}).sort()).toEqual(["input", "model", "tools"]);
	});

	it("falls back to output content parts when output_text is absent", async () => {
		const capture = captureFetch({
			id: "resp_content_parts",
			model: "grok-4.5",
			output: [
				{
					content: [
						{ type: "output_text", text: "First content part" },
						{ type: "text", output_text: "Second content part" },
					],
				},
			],
		});

		const response = await searchXAI(makeParams(capture.fetchMock));
		expect(response).toMatchObject({
			answer: "First content part\nSecond content part",
		});
	});

	it.each([
		[401, "xai: 401 unauthorized"],
		[402, "xai: 402 credits exhausted"],
	] as const)("maps HTTP %s failures to SearchProviderError", async (status, message) => {
		const fetchMock: FetchImpl = () =>
			Promise.resolve(
				new Response(JSON.stringify({ error: "request failed" }), {
					status,
					headers: { "Content-Type": "application/json" },
				}),
			);

		try {
			await searchXAI(makeParams(fetchMock));
			expect.unreachable(`xAI HTTP ${status} failure should reject`);
		} catch (error) {
			expect(error).toBeInstanceOf(SearchProviderError);
			expect(error).toMatchObject({
				provider: "xai",
				status,
				message,
			});
		}
	});

	it("throws a clear missing-key error before fetch when credentials are unavailable", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))) as unknown as FetchImpl;

		try {
			await searchXAI(makeParams(fetchMock, makeAuthStorage({})));
			expect.unreachable("missing Grok subscription credentials should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty(
				"message",
				"No xAI Grok OAuth subscription credential. Run /login → xAI Grok OAuth (SuperGrok or X Premium+).",
			);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
