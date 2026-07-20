Stop and write the complete plan in your NEXT reply — before any further exploration. You have already seen enough to define the remaining execution specification; do not defer this.

First, state the plan itself, explicitly and comprehensively:

- Every remaining step in evidence-dependency order, with the exact attack surfaces, files/symbols/interfaces, commands or interactions, and the hypothesis to be evaluated at each step.
- For each step, specify the concrete inputs or prerequisites, the expected observable result, the result that would falsify the claim, and how you will verify that the attack-path edge actually holds.
- Known competing explanations, edge cases, and environmental differences. Never modify tests, fixtures, or observation criteria to make the conclusions hold.
- What investigation and evidence is already done and reusable, stated briefly, so no step gets repeated.

Be thorough and concrete — this plan is the reference for the remainder of the run. You may verify details with tools after the plan is written, but never continue unstructured exploration before then.

Then, only once the plan above is complete, in the SAME reply, capture it as a todo list (the todo tool): 5-9 items, one per MEANINGFUL attack-surface, verification, or artifact step, each naming its target and observable acceptance criteria. Only steps that change conclusions or verify paths belong on the list — no report polishing, rating, recordkeeping, or formal organization.

This is a checkpoint, not a final answer: do not end your turn on the plan alone — after recording the todo list, continue the task; do not stop here.
