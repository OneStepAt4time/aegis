# CC Agent Swarm & Tmux Backend

**Version:** Claude Code v2.1.81
**Source:** Minified bundle analysis

## 1. Agent Types

| Type | permissionMode | maxTurns | model | Description |
|------|---------------|----------|-------|-------------|
| `subagent` | `default` | 200 | inherit | General-purpose sub-agent, all tools |
| `fork` | `bubble` | 200 | inherit | Implicit fork, inherits full conversation context |
| `teammate` | varies | varies | varies | Team member in cowork/multi-agent |
| `Explore` | `default` | 200 | inherit | Codebase exploration agent (read-only focused) |
| `Plan` | `default` | 1 | inherit | Read-only architect, forced single turn |
| `custom` | user-defined | user-defined | user-defined | Custom agent from settings |

## 2. Fork Pattern

- `"Implicit fork \u2014 inherits full conversation context. Not selectable via subagent_type; triggered by omitting subagent_type when the fork experiment is active."`
- `"Fork started \u2014 processing in background"`
- `"You are a forked worker process"`

Fork is NOT selectable via `subagent_type`. Triggered by omitting `subagent_type` when fork experiment is active.

## 3. Worktree Isolation


Set `isolation: "worktree"` on Task/Agent tool to create a temporary git worktree.
Worktree is auto-cleaned if agent makes no changes; if changes exist, path+branch returned in result.

## 4. Permission Modes for Agents

| Mode | Behavior |
|------|----------|
| `default` | Standard ask-before-write |
| `acceptEdits` | Auto-approve file edits, ask for bash |
| `bypassPermissions` | Auto-approve everything |
| `dontAsk` | Same as bypass but silent |
| `bubble` | Bubble permission requests up to parent |
| `plan` | Read-only, no writes allowed |

## 5. Task/Agent Notification Protocol

JSONL notification fields for agent status:

- `task-notification`
- `task-id`
- `tool-use-id`
- `task-type`
- `output-file`
- `status`
- `summary`
- `worktree`
- `worktreePath`
- `worktreeBranch`

## 6. Tmux Backend

CC requires tmux for agent swarms. Each agent runs in a separate tmux window/pane.

### Setup instructions (from CC source)
- macOS: `brew install tmux && tmux new-session -s claude`
- Linux: `sudo apt install tmux && tmux new-session -s claude`
- Windows: Requires WSL, then same as Linux

### Tmux commands used internally
- `tmux is not natively available on Windows. Consider using WSL or Cygwin.`
- `tmux session: `

## 7. Parent↔Child Communication

- Parent spawns child via Task/Agent tool → child runs in tmux window
- Child returns result as `tool_result` content block
- If child completes: `status: completed`, content array returned
- If child errors: `status: error`, error message returned
- `SendMessage` tool: send message to agent by agentId (for ongoing agents)
- `worktreePath` and `worktreeBranch` returned if worktree isolation was used

## 8. Limits & Cleanup

| Parameter | Value | Context |
|-----------|-------|---------|
| maxTurns | 1 | Plan agent (single-turn architect) |
| maxTurns | 200 | All other agents |
| Worktree cleanup | Auto if no changes | Otherwise path+branch returned |
| Background tasks | `ctrl+b` to background | Task continues in tmux |
