/**
 * Bundled agent definitions.
 *
 * Agents are embedded at build time via Bun's import with { type: "text" }.
 */
import { Effort } from "@oh-my-pi/pi-ai";
import { parseFrontmatter, prompt } from "@oh-my-pi/pi-utils";
import { type AgentMode, DEFAULT_AGENT_MODE } from "../config/agent-mode";
import { parseAgentFields } from "../discovery/helpers";
import attackPlannerMd from "../prompts/agents/attack-planner.md" with { type: "text" };
import designerMd from "../prompts/agents/designer.md" with { type: "text" };
import exploreMd from "../prompts/agents/explore.md" with { type: "text" };
import findingReviewerMd from "../prompts/agents/finding-reviewer.md" with { type: "text" };
// Embed agent markdown files at build time
import agentFrontmatterTemplate from "../prompts/agents/frontmatter.md" with { type: "text" };
import librarianMd from "../prompts/agents/librarian.md" with { type: "text" };
import planMd from "../prompts/agents/plan.md" with { type: "text" };
import reconMd from "../prompts/agents/recon.md" with { type: "text" };
import redteamMd from "../prompts/agents/redteam.md" with { type: "text" };
import reportDesignerMd from "../prompts/agents/report-designer.md" with { type: "text" };
import reviewerMd from "../prompts/agents/reviewer.md" with { type: "text" };
import taskMd from "../prompts/agents/task.md" with { type: "text" };
import testerMd from "../prompts/agents/tester.md" with { type: "text" };
import validatorMd from "../prompts/agents/validator.md" with { type: "text" };
import vulnLibrarianMd from "../prompts/agents/vuln-librarian.md" with { type: "text" };

import type { AgentDefinition, AgentSource } from "./types";

interface AgentFrontmatter {
	name: string;
	description: string;
	tools?: string[];
	spawns?: string;
	model?: string | string[];
	thinkingLevel?: string;
	blocking?: boolean;
}

interface EmbeddedAgentDef {
	fileName: string;
	frontmatter?: AgentFrontmatter;
	template: string;
}

function buildAgentContent(def: EmbeddedAgentDef): string {
	const body = prompt.render(def.template);
	if (!def.frontmatter) return body;
	return prompt.render(agentFrontmatterTemplate, { ...def.frontmatter, body });
}

const CODING_AGENT_DEFS: EmbeddedAgentDef[] = [
	{ fileName: "explore.md", template: exploreMd },
	{ fileName: "plan.md", template: planMd },
	{ fileName: "designer.md", template: designerMd },
	{ fileName: "reviewer.md", template: reviewerMd },
	{ fileName: "librarian.md", template: librarianMd },
	{ fileName: "tester.md", template: testerMd },
	{
		fileName: "task.md",
		frontmatter: {
			name: "task",
			description: "General-purpose subagent with full capabilities for delegated multi-step tasks",
			spawns: "*",
			model: "pi/task",
		},
		template: taskMd,
	},
	{
		fileName: "sonic.md",
		frontmatter: {
			name: "sonic",
			description: "Low-reasoning agent for strictly mechanical updates or data collection only",
			model: "pi/smol",
			thinkingLevel: Effort.Medium,
		},
		template: taskMd,
	},
];

const REDTEAM_AGENT_DEFS: EmbeddedAgentDef[] = [
	{ fileName: "recon.md", template: reconMd },
	{ fileName: "attack-planner.md", template: attackPlannerMd },
	{ fileName: "finding-reviewer.md", template: findingReviewerMd },
	{ fileName: "validator.md", template: validatorMd },
	{ fileName: "vuln-librarian.md", template: vulnLibrarianMd },
	{ fileName: "report-designer.md", template: reportDesignerMd },
	{ fileName: "redteam.md", template: redteamMd },
];

// Computed lazily on first loadBundledAgents() call to avoid eager prompt.render at module load.

export class AgentParsingError extends Error {
	constructor(
		error: Error,
		readonly source?: unknown,
	) {
		super(`Failed to parse agent: ${error.message}`, { cause: error });
		this.name = "AgentParsingError";
	}

	toString(): string {
		const details: string[] = [this.message];
		if (this.source !== undefined) {
			details.push(`Source: ${JSON.stringify(this.source)}`);
		}
		if (this.cause && typeof this.cause === "object" && "stack" in this.cause && this.cause.stack) {
			details.push(`Stack:\n${this.cause.stack}`);
		} else if (this.stack) {
			details.push(`Stack:\n${this.stack}`);
		}
		return details.join("\n\n");
	}
}

/**
 * Parse an agent from embedded content.
 */
export function parseAgent(
	filePath: string,
	content: string,
	source: AgentSource,
	level: "fatal" | "warn" | "off" = "fatal",
): AgentDefinition {
	const { frontmatter, body } = parseFrontmatter(content, {
		location: filePath,
		level,
	});
	const fields = parseAgentFields(frontmatter);
	if (!fields) {
		throw new AgentParsingError(new Error(`Invalid agent field: ${filePath}\n${content}`), filePath);
	}
	return {
		...fields,
		systemPrompt: body,
		source,
		filePath,
	};
}

/** Per-mode cache: a process may host coding and red-team sessions concurrently. */
const bundledAgentsCache = new Map<AgentMode, AgentDefinition[]>();

/**
 * Load bundled agents for a session profile.
 * Red-team mode extends the generic coding roster with distinct specialist IDs;
 * it never replaces the generic agent definitions.
 */
export function loadBundledAgents(agentMode: AgentMode = DEFAULT_AGENT_MODE): AgentDefinition[] {
	const cached = bundledAgentsCache.get(agentMode);
	if (cached) return cached;

	const defs = agentMode === "redteam" ? [...CODING_AGENT_DEFS, ...REDTEAM_AGENT_DEFS] : CODING_AGENT_DEFS;
	const agents = defs.map(def => parseAgent(`embedded:${def.fileName}`, buildAgentContent(def), "bundled"));
	bundledAgentsCache.set(agentMode, agents);
	return agents;
}

/**
 * Get a bundled agent by name.
 */
export function getBundledAgent(name: string, agentMode: AgentMode = DEFAULT_AGENT_MODE): AgentDefinition | undefined {
	return loadBundledAgents(agentMode).find(agent => agent.name === name);
}

/**
 * Get all bundled agents as a map keyed by name.
 */
export function getBundledAgentsMap(agentMode: AgentMode = DEFAULT_AGENT_MODE): Map<string, AgentDefinition> {
	const map = new Map<string, AgentDefinition>();
	for (const agent of loadBundledAgents(agentMode)) {
		map.set(agent.name, agent);
	}
	return map;
}

/**
 * Clear every bundled-agent profile cache (for testing).
 */
export function clearBundledAgentsCache(): void {
	bundledAgentsCache.clear();
}

// Re-export for backward compatibility
export const BUNDLED_AGENTS = loadBundledAgents;
