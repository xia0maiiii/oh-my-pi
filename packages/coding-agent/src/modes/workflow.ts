import { prompt } from "@oh-my-pi/pi-utils";
import { type AgentMode, DEFAULT_AGENT_MODE } from "../config/agent-mode";
import workflowNoticeTemplate from "../prompts/system/workflow-notice.md" with { type: "text" };
import workflowRedteamNoticeTemplate from "../prompts/system/workflow-redteam-notice.md" with { type: "text" };
import { createGradientHighlighter, type KeywordHighlighter } from "./gradient-highlight";
import { keywordInProse } from "./markdown-prose";

/**
 * "workflowz" keyword support.
 *
 * Typing the standalone word in the input editor paints it with a warm
 * amber→green gradient ({@link highlightWorkflow}); submitting a message that
 * mentions it appends a hidden workflow notice that steers the model to author
 * a deterministic multi-subagent workflow through the active task schema.
 * Matching is whitespace-delimited and case-sensitive (lowercase only) —
 * "workflowz" triggers, but "workflowzed", "Workflowz", and "workflowz.ts"
 * never do.
 */

// Detection: lowercase keyword flanked by whitespace or a string edge. Non-global so `.test` stays stateless.
const WORKFLOW_WORD = /(?<!\S)workflowz(?!\S)/;

/** WORKFLOW_NOTICE is the default hidden notice for sessions with batched task calls enabled. */
export const WORKFLOW_NOTICE: string = renderWorkflowNotice({ taskBatch: true });

/** renderWorkflowNotice renders the workflow notice for the active task schema. */
export function renderWorkflowNotice({
	taskBatch,
	agentMode = DEFAULT_AGENT_MODE,
}: {
	taskBatch: boolean;
	agentMode?: AgentMode;
}): string {
	const template = agentMode === "redteam" ? workflowRedteamNoticeTemplate : workflowNoticeTemplate;
	return prompt.render(template, { taskBatch }).trim();
}

/**
 * Whether `text` contains the standalone keyword "workflowz"
 * (lowercase, whitespace-delimited) in prose — never inside a code block, inline
 * code span, or XML/HTML section.
 */
export function containsWorkflow(text: string): boolean {
	return keywordInProse(text, WORKFLOW_WORD);
}

/**
 * Highlight every standalone "workflowz" in `text` for editor display
 * with a warm amber→green gradient (hue 30..150), visually distinct from
 * ultrathink's rainbow and orchestrate's teal→violet.
 */
export const highlightWorkflow: KeywordHighlighter = createGradientHighlighter({
	probe: /workflowz/,
	highlight: /(?<!\S)workflowz(?!\S)/g,
	stops: 14,
	hue: t => 30 + t * 120,
});
