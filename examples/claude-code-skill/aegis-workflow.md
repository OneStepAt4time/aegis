# Aegis Workflow Skill

Use this skill when you need full lifecycle orchestration for one or more tasks.

## Objective
Drive tasks from issue selection to validated PR-ready changes with Aegis sessions.

## Workflow
1. Select non-blocked issue(s) and define acceptance criteria.
2. Create one Aegis session per issue with explicit scope and constraints.
3. Supervise each session with heartbeat polling and stall nudges.
4. Approve safe prompts; reject or escalate risky operations.
5. Validate changed scope with tests/build.
6. Commit with conventional commit type.
7. Push branch and open PR with issue linkage and validation notes.

## Guardrails
- Never bypass auth/security checks.
- Never merge with failing quality gate.
- Keep PRs single-purpose and reviewable.
- Prefer `fix:` or `refactor:` over `feat:` unless user-visible capability is added.
