# Aegis Single-Task Skill

Use this skill for one focused implementation task.

## Input
- Issue number
- Repo path
- Explicit acceptance criteria

## Steps
1. Create a session with a precise prompt.
2. Poll status until completion.
3. Handle `permission_prompt`, `bash_approval`, `plan_mode`, and `ask_question` states.
4. Review touched files for regressions.
5. Run targeted tests.
6. Commit and push if checks pass.

## Output Checklist
- [ ] Requirement implemented
- [ ] No unrelated changes
- [ ] Tests executed and passing
- [ ] Commit message follows conventional commits
