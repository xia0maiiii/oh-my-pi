<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->

Continue working on the currently active goal.

<objective>
{{objective}}
</objective>

Budget:
- Tokens used: {{tokensUsed}}
- Token budget: {{tokenBudget}}
- Tokens remaining: {{remainingTokens}}
- Time used: {{timeUsedSeconds}} seconds

This is an autonomous continuation. The goal stays fixed across turns; NEVER redefine success criteria as a smaller, simpler, or already-done subset.

Before calling `goal({op:"complete"})`, you MUST run a completion audit against current state:

1. **Restate the goal as concrete deliverables.** What findings, evidence, report chapters, PoCs, or artifacts must exist for the goal to hold? Write them down (todo, or in your reasoning).
2. **Map each deliverable to evidence.** For each requirement, find the authoritative source that proves it: command output, **full Burp request/response (HTTP(S))**, file contents, reproduction steps, negative-result records.
3. **Check actual current state.** Read files. Re-run key validation. NEVER rely only on session memory of earlier work—the target environment may have changed.
4. **Match verification scope to claim scope.** A narrow check (port open) does not prove a wide claim (code execution achieved).
5. **Treat uncertainty as not done.** Indirect evidence, partial coverage, missing artifacts, or unchecked "looks right" means keep working. Collect stronger evidence or do more work.
6. **Budget exhaustion is not completion.** NEVER call complete merely because tokens are low. If budget is tight and work is unfinished, leave the goal active and end this turn—the user or runtime decides next.

Call `goal({op:"complete"})` only when every deliverable has direct, current-state evidence. A complete call is a binding claim; it ends the autonomous loop and shows the user a "done" report.

If work is unfinished, continue doing it. NEVER narrate that you are continuing—just execute.
