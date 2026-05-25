
/**
 * Derive a human-readable activity description from a CC tool invocation.
 * Issue #4203: Live Agent Status indicator.
 */
export function deriveActivityText(
  hookEvent: string,
  toolName?: string,
  toolInput?: Record<string, unknown>,
): string | undefined {
  if (hookEvent === 'PreToolUse' || hookEvent === 'PostToolUse') {
    if (!toolName) return 'Working';
    switch (toolName) {
      case 'Bash': {
        const cmd = (toolInput?.command as string) || '';
        // Show just the command, truncated
        const short = cmd.split('\n')[0].slice(0, 60);
        return short ? `Running: ${short}` : 'Running command';
      }
      case 'Edit':
      case 'MultiEdit': {
        const path = (toolInput?.file_path as string) || '';
        const base = path.split('/').pop() || path;
        return base ? `Editing: ${base}` : 'Editing file';
      }
      case 'Write': {
        const path = (toolInput?.file_path as string) || '';
        const base = path.split('/').pop() || path;
        return base ? `Writing: ${base}` : 'Writing file';
      }
      case 'Read': {
        const path = (toolInput?.file_path as string) || '';
        const base = path.split('/').pop() || path;
        return base ? `Reading: ${base}` : 'Reading file';
      }
      case 'Grep':
      case 'Glob':
        return 'Searching files';
      case 'WebFetch':
        return 'Fetching URL';
      case 'TodoRead':
      case 'TodoWrite':
        return 'Updating task list';
      default:
        return `Running: ${toolName}`;
    }
  }

  switch (hookEvent) {
    case 'Stop': return 'Idle';
    case 'PreCompact': return 'Compacting context';
    case 'PostCompact': return 'Compaction complete';
    case 'PermissionRequest': return 'Waiting for approval';
    case 'Elicitation': return 'MCP elicitation';
    case 'SubagentStart': return 'Starting sub-agent';
    case 'UserPromptSubmit': return 'Processing prompt';
    case 'WorktreeCreate': return 'Creating worktree';
    case 'WorktreeRemove': return 'Removing worktree';
    default: return undefined;
  }
}
