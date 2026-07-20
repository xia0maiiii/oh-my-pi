Before you consider this task finished, verify:

- Consistency: if the same identity, field, protocol, parsing rule, or control appears in multiple places, use grep/LSP/structural search to find every producer, transformation point, and consumer. Verifying only one of the copies is still a failure.
- Coverage: compare the final conclusion against the original objective and attack-surface model. Every critical path edge must be confirmed, disproven, or explicitly marked as unknown with the missing evidence identified; the number of tool runs is not the same as coverage.
- Verification: repeat the decisive scenario on the actual target, and vary at least one critical condition as a negative control. Verifying only a script, scanner template, or test double does not verify the target behavior.

Do not claim the task is complete until you have done these three checks.
