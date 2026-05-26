# Agent Template (SOUL.md)

Use this template to define a dev agent that Aegis orchestrates. Place in the session's working directory as `SOUL.md` or `CLAUDE.md`.

---

## Template

```markdown
# <Agent Name>

## Role
<One sentence: what this agent does>

## Working Directory
<repo path>

## Rules
- Write code, don't explain
- Run tests after implementation
- Don't add skip/only annotations to tests
- Don't modify files outside scope unless fixing a blocking issue
- Commit with descriptive messages when done

## Scope
<What this agent should implement. Be specific: issue numbers, file paths, acceptance criteria.>

## Constraints
- <Time/complexity limit>
- <Files not to touch>
- <Patterns to follow>

## Completion Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] Tests pass
```

## Usage

When spawning a session, include the agent's scope in the initial prompt:

```bash
curl -s -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/path/to/repo",
    "name": "agent-name",
    "prompt": "You are <Agent Name>. Your task: <scope>. Follow rules in CLAUDE.md. Write code, run tests, commit when done."
  }'
```

## Agent Archetypes

| Archetype | Prompt Pattern |
|-----------|---------------|
| **Implementer** | "Implement X. Don't explain. Run tests." |
| **Reviewer** | "Review the code in X. Focus on Y. Be concise." |
| **Fixer** | "Fix failing test X. Root cause first, then fix." |
| **Scout** | "Investigate X. Report findings. Don't change code." |
| **Refactorer** | "Refactor X to pattern Y. Keep behavior identical. Run full test suite." |
