import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { discoverAuthStorage, resolveAuthBrokerConfig } from "@oh-my-pi/pi-ai/auth-broker";
import { removeWithRetries } from "../../utils/src/temp";
import { withEnv } from "./helpers";

const SUPPRESS_AUTH_BROKER_ENV = {
	OMP_AUTH_BROKER_URL: undefined,
	OMP_AUTH_BROKER_TOKEN: undefined,
} as const;

describe("resolveAuthBrokerConfig config discovery", () => {
	let agentDir = "";

	beforeEach(async () => {
		agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-broker-config-"));
	});

	afterEach(async () => {
		if (agentDir) {
			await removeWithRetries(agentDir);
			agentDir = "";
		}
	});

	test("resolves broker URL and token from config.yaml when config.yml is absent", async () => {
		await Bun.write(
			path.join(agentDir, "config.yaml"),
			"auth.broker.url: https://yaml-broker.example/v1\nauth.broker.token: yaml-token\n",
		);

		await withEnv(SUPPRESS_AUTH_BROKER_ENV, async () => {
			await expect(resolveAuthBrokerConfig({ agentDir })).resolves.toEqual({
				url: "https://yaml-broker.example/v1",
				token: "yaml-token",
			});
		});
	});

	test("prefers config.yml over config.yaml when both exist", async () => {
		await Bun.write(
			path.join(agentDir, "config.yaml"),
			"auth.broker.url: https://yaml-broker.example/v1\nauth.broker.token: yaml-token\n",
		);
		await Bun.write(
			path.join(agentDir, "config.yml"),
			"auth.broker.url: https://yml-broker.example/v1\nauth.broker.token: yml-token\n",
		);

		await withEnv(SUPPRESS_AUTH_BROKER_ENV, async () => {
			await expect(resolveAuthBrokerConfig({ agentDir })).resolves.toEqual({
				url: "https://yml-broker.example/v1",
				token: "yml-token",
			});
		});
	});

	test("uses OMP_AUTH_DB_PATH for local credential discovery", async () => {
		const authDbPath = path.join(agentDir, "shared-auth.db");
		const seedStore = await SqliteAuthCredentialStore.open(authDbPath);
		seedStore.upsertAuthCredentialForProvider("shared-provider", { type: "api_key", key: "shared-key" });
		seedStore.close();

		await withEnv({ ...SUPPRESS_AUTH_BROKER_ENV, OMP_AUTH_DB_PATH: authDbPath }, async () => {
			const storage = await discoverAuthStorage({ agentDir });
			try {
				expect(storage.get("shared-provider")).toEqual({ type: "api_key", key: "shared-key" });
			} finally {
				storage.close();
			}
		});

		expect(await Bun.file(path.join(agentDir, "agent.db")).exists()).toBe(false);
	});
});
