# Coding Behavior

## Think Before Coding
- State assumptions explicitly before implementing. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so.

## Simplicity First
- No features beyond what was asked. No speculative abstractions.
- No "flexibility" or "configurability" that wasn't requested.
- If you write 200 lines and it could be 50, rewrite it.
- No error handling for impossible scenarios.

## Surgical Changes
- Touch only what the task requires. Don't "improve" adjacent code, comments, or formatting.
- Match existing code style — quotes, spacing, naming conventions.
- Don't refactor things that aren't broken.
- If you notice unrelated dead code, mention it — don't delete it.
- Every changed line should trace to the user's request.

## Goal-Driven Execution
- Define success criteria before starting.
- "Fix bug X" → write a test that reproduces it, then make it pass.
- "Refactor Y" → ensure tests pass before and after.
- For multi-step tasks, state a plan with verification checkpoints:
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
