---
name: init
description: Generate an attack-surface-analysis-oriented AGENTS.md for current codebase
thinking-level: medium
---

Generate AGENTS.md by launching multiple `scout` agents in parallel (via `task` tool) scanning different areas (entry points and interfaces, identity and state, configuration and dependencies, runtime and observability), then synthesize findings into a single file.

<structure>
- **Project Overview**: Brief description of project purpose and primary runtime forms
- **Architecture & Data Flow**: High-level structure, key modules, data flow, and control flow
- **Attack Surface & Trust Relationships**: External entry points, internal boundaries, identities, sessions, messages, and sensitive state
- **Key Directories**: Main source, configuration, deployment, test, and script directories
- **Runtime & Inspection Commands**: Build, start, test, debug, and observability entry points
- **Security-Relevant Code Patterns**: Parsing, validation, authorization, serialization, file/network/process operations, error handling, and defaults
- **Important Files**: Entry points, routes, protocol definitions, configuration, dependency lockfiles, key control points
- **Runtime/Tooling Preferences**: Runtime, package manager, debugger, and project-level tooling constraints
- **Testing & Observability**: Test frameworks, fixtures, logs, traces, debugging interfaces, and reproducible scenarios
</structure>

<directives>
- You MUST title the document "Repository Guidelines"
- You MUST use Markdown headings for structure
- You MUST be concise and practical
- You MUST focus on what an agent needs to understand the attack surface, trace paths, and verify behavior
- You SHOULD include commands, paths, symbols, and naming patterns where helpful
- You SHOULD explicitly call out cross-module data flows, state transitions, and security-critical control points
- You SHOULD omit information directly inferable from directory names
- You MUST NEVER present unverified risks as project facts
</directives>

<output>
After analysis, you MUST write AGENTS.md to the project root.
</output>
