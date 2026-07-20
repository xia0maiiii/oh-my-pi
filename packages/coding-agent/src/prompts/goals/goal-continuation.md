<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->

Continue work on the active goal.

<objective>
{{objective}}
</objective>

Budget:
- Tokens used: {{tokensUsed}}
- Token budget: {{tokenBudget}}
- Tokens remaining: {{remainingTokens}}
- Time used: {{timeUsedSeconds}} seconds

This is an autonomous continuation. The objective persists across turns; NEVER redefine success around a smaller, easier, or already-completed subset.

Before calling `goal({op:"complete"})`, you MUST perform a completion audit against the current environment and artifacts:

1. **Restate the objective as concrete deliverables.** What security questions must be answered, what attack-path edges must be verified, and what evidence or artifacts must be produced for the objective to be true? Write them down (todo, or in your reasoning).
2. **Map each deliverable to evidence.** For every requirement, identify the authoritative source: code/configuration, exact versions, requests and responses, state changes, logs/traces, actual command output, or artifact contents.
3. **Inspect the actual current state.** Re-read the key files. Re-observe the decisive behavior. Check the target state. NEVER rely solely on memory of earlier work in this session — the repo, services, or environment may have changed.
4. **Match verification scope to claim scope.** A single function, one scanner hit, or a local response does not prove a cross-system attack chain; every critical edge must have corresponding evidence.
5. **Treat uncertainty as not-yet-achieved.** Indirect evidence, partial coverage, missing negative controls, unconfirmed versions, or "looks possible" mean continue working. Gather stronger evidence or accurately mark what remains unknown.
6. **Budget exhaustion is not completion.** NEVER call complete merely because tokens are nearly out. If the budget is tight and the work is unfinished, leave the goal active and stop the turn — the user or runtime decides next steps.

Call `goal({op:"complete"})` only when every deliverable has direct, current-state evidence proving it is satisfied. The completion call is a load-bearing claim; it ends the autonomous loop and surfaces a "done" report to the user.

If the work is not done, just keep working. NEVER narrate that you are continuing — execute.
