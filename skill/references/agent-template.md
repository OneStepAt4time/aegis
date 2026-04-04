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

## Dogfooding Pattern

Use Aegis to improve Aegis itself with a strict loop:

1. Agent reads issue + current implementation.
2. Agent writes code with minimal diff.
3. Agent runs: `npx tsc --noEmit && npm run build && npm test`.
4. Agent commits only touched files.
5. Agent posts a short QA summary (pass/fail + known baseline failures).

Prompt snippet:

```text
You are implementing issue #<N> in the Aegis repository.
Use minimal changes, keep public API stable, run quality gate, then commit.
If quality gate fails, fix up to 3 iterations before escalating.
```

## Escalation Pattern

Escalate to human review when any of these happen:

- More than 3 fix loops without green gate
- Security-sensitive behavior change (auth, permissions, hooks)
- Ambiguous acceptance criteria or conflicting issue comments

Escalation message template:

```text
Blocked on issue #<N> after <k> fix loops.
What changed: <one line>
Blocking error: <one line>
Proposed options: 1) <opt A> 2) <opt B>
```

## Memory Pattern

Persist useful context between sessions using memory keys:

- `project/<topic>` for repository-wide conventions
- `session:<id>/<topic>` for run-local context
- `team/<topic>` for shared workflows

Inject memory into prompts via `memoryKeys` on session creation to keep prompts concise and consistent.
