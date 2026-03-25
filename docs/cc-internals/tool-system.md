# CC Tool System & JSONL Protocol

**Version:** Claude Code v2.1.81
**Source:** Minified bundle analysis + extracted tool descriptions

## 1. Tool Display Mapping

From source: `GW$` object maps tool names to display labels.

| Tool | Display Label | Parameter | Description |
|------|-------------|-----------|-------------|
| `Read` | path | `file_path` | Read file contents |
| `Write` | path | `file_path` | Write/create file |
| `Edit` | path | `file_path` | Edit file (search/replace) |
| `MultiEdit` | path | `file_path` | Multiple edits in one file |
| `NotebookEdit` | path | `notebook_path` | Edit Jupyter notebook |
| `NotebookRead` | path | `notebook_path` | Read Jupyter notebook |
| `Bash` | command | `command` | Run bash command |
| `Grep` | pattern | `pattern` | Search file contents |
| `Glob` | pattern | `pattern` | Find files by pattern |
| `LS` | path | `path` | List directory |
| `WebFetch` | url | `url` | Fetch web page |
| `WebSearch` | query | `query` | Search the web |
| `Task` | prompt | `prompt` | Spawn sub-agent task |
| `Agent` | prompt | `prompt` | Spawn named agent |
| `Tmux` | command | `args.join(' ')` | Tmux control |
| `TodoRead` | — | — | Read todo list |
| `TodoWrite` | — | — | Write todo list |
| `Sleep` | — | `duration` | Wait for duration (internal) |
| `SummaryOfChanges` | — | — | Generate change summary (internal) |

## 2. JSONL Conversation Format

Each line in the `.jsonl` file is a JSON object with these types:

### Message Types

| `type` | `message.role` | Content |
|--------|---------------|---------|
| `user` | `user` | User input text |
| `assistant` | `assistant` | CC response text + tool_use blocks |
| `tool_result` | — | Result of tool execution |

### Content Block Types (in `message.content[]`)

| `type` | Description |
|--------|-------------|
| `text` | Plain text content |
| `tool_use` | Tool invocation (`id`, `name`, `input`) |
| `tool_result` | Tool result (`tool_use_id`, `content`, `is_error`) |
| `thinking` | Extended thinking (not always present) |

## 3. Terminal Display Format

CC renders tool use in the terminal with specific patterns:

```
📖 Read <file_path>              (dimmed)
✏️ Write <file_path>             (highlighted)
✏️ Edit <file_path>              (with diff preview)
🖥️ Bash <command>                (with output)
🔍 Grep <pattern>                (with matches)
📁 Glob <pattern>                (with file list)
🌐 WebFetch <url>                (with content preview)
🔎 WebSearch <query>             (with results)
🤖 Task <prompt>                 (sub-agent)
👤 Agent <prompt>                (named agent)
```

### Grouped Tool Display

JSONL types for visual grouping:
- `grouped_tool_use`
- `collapsed_read_search`
- `system`
- `attachment`

Keyboard actions on grouped items:
- `Enter` → expand/collapse
- `c` → copy content
- `p` → copy tool parameter (path/command/pattern)

## 4. Internal Tools

| Tool | Description | Visible to User? |
|------|-------------|-------------------|
| `Sleep` | Wait for specified duration, user can interrupt | No (background) |
| `SummaryOfChanges` | Generate summary of all changes made | End of session |
| `Tmux` | Control tmux windows/panes for agent swarm | No (internal) |
| `SendMessage` | Send message to another agent by agentId | No (inter-agent) |

## 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| Tool timeout | `API_TIMEOUT_MS` env var (default varies) |
| User cancellation | `Esc` → `app:interrupt` event → cancel current tool |
| Tool error | `is_error: true` in tool_result, error message in content |
| Rate limit | Exponential backoff, `CLAUDE_CODE_MAX_RETRIES` |
| Bash timeout | Configurable per-command, default from settings |
| Network error | Retry with backoff, max retries from env var |

## 6. Sed Interception (Special)

CC intercepts `sed -i` commands and converts them to internal Edit operations.
This avoids needing bash permission for simple file edits.
Pattern: `sed -i 's/old/new/g' file.txt` → Edit tool call
