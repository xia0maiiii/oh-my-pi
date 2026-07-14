export const AGENT_MODES = ["coding", "redteam"] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

export const DEFAULT_AGENT_MODE: AgentMode = "redteam";

/** Keep an existing session pinned; startup flags only select a profile for sessions without one. */
export function resolveAgentMode(
	explicit: AgentMode | undefined,
	persisted: AgentMode | undefined,
	configured: AgentMode,
): AgentMode {
	return persisted ?? explicit ?? configured;
}
