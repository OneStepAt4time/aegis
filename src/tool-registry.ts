/**
 * tool-registry.ts — Zod schemas and metadata for all known CC tools.
 *
 * Issue #704: Tool registry and schema validation for CC tool introspection.
 * Enables monitoring, policy enforcement, and analytics by making Aegis
 * aware of which tools Claude Code uses during a session.
 *
 * Each entry has: name, inputSchema (Zod), permissionLevel, category, description.
 */

import { z } from 'zod';

// ── Types ──────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'bash'
  | 'read'
  | 'write'
  | 'edit'
  | 'search'
  | 'agent'
  | 'planning'
  | 'task'
  | 'scheduling'
  | 'web'
  | 'notebook'
  | 'user_interaction'
  | 'skill'
  | 'trigger';

export type PermissionLevel = 'none' | 'read' | 'write';

export interface ToolDefinition {
  name: string;
  inputSchema: z.ZodType;
  permissionLevel: PermissionLevel;
  category: ToolCategory;
  description: string;
}

// ── Input schemas ─────────────────────────────────────────────────────

const bashInputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  run_in_background: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
}).strict();

const readInputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  pages: z.string().optional(),
}).strict();

const writeInputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
}).strict();

const editInputSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
}).strict();

const globInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
}).strict();

const grepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  type: z.string().optional(),
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
  '-A': z.number().optional(),
  '-B': z.number().optional(),
  '-C': z.number().optional(),
  context: z.number().optional(),
  '-n': z.boolean().optional(),
  '-i': z.boolean().optional(),
  head_limit: z.number().optional(),
  offset: z.number().optional(),
  multiline: z.boolean().optional(),
}).strict();

const agentInputSchema = z.object({
  description: z.string(),
  prompt: z.string(),
  subagent_type: z.string().optional(),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  run_in_background: z.boolean().optional(),
  isolation: z.enum(['worktree']).optional(),
}).strict();

const askUserQuestionInputSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    header: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string(),
      preview: z.string().optional(),
    })).optional(),
    multiSelect: z.boolean().optional(),
  })).min(1).max(4),
}).strict();

const todoWriteInputSchema = z.object({
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    activeForm: z.string().optional(),
  })),
}).strict();

const enterWorktreeInputSchema = z.object({
  name: z.string().optional(),
}).strict();

const exitWorktreeInputSchema = z.object({
  action: z.enum(['keep', 'remove']),
  discard_changes: z.boolean().optional(),
}).strict();

const webSearchInputSchema = z.object({
  query: z.string(),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
}).strict();

const notebookEditInputSchema = z.object({
  notebook_path: z.string(),
  new_source: z.string(),
  cell_type: z.enum(['code', 'markdown']).optional(),
  edit_mode: z.enum(['replace', 'insert', 'delete']).optional(),
  cell_id: z.string().optional(),
  cell_number: z.number().optional(),
}).strict();

const taskOutputInputSchema = z.object({
  task_id: z.string(),
  block: z.boolean().optional(),
  timeout: z.number().optional(),
}).strict();

const taskStopInputSchema = z.object({
  task_id: z.string().optional(),
  shell_id: z.string().optional(),
}).strict();

const cronCreateInputSchema = z.object({
  cron: z.string(),
  prompt: z.string(),
  recurring: z.boolean().optional(),
  durable: z.boolean().optional(),
}).strict();

const cronDeleteInputSchema = z.object({
  id: z.string(),
}).strict();

const skillInputSchema = z.object({
  skill: z.string(),
  args: z.string().optional(),
}).strict();

const remoteTriggerInputSchema = z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'run']),
  trigger_id: z.string().optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).strict();

const emptyInputSchema = z.object({}).strict();

// ── Tool definitions ──────────────────────────────────────────────────

const tools: ToolDefinition[] = [
  // ── Execution ───────────────────────────────────────
  {
    name: 'Bash',
    inputSchema: bashInputSchema,
    permissionLevel: 'write',
    category: 'bash',
    description: 'Execute a bash command in the working directory',
  },

  // ── File operations ─────────────────────────────────
  {
    name: 'Read',
    inputSchema: readInputSchema,
    permissionLevel: 'read',
    category: 'read',
    description: 'Read file contents from the local filesystem',
  },
  {
    name: 'Write',
    inputSchema: writeInputSchema,
    permissionLevel: 'write',
    category: 'write',
    description: 'Write content to a file, overwriting if it exists',
  },
  {
    name: 'Edit',
    inputSchema: editInputSchema,
    permissionLevel: 'write',
    category: 'edit',
    description: 'Perform exact string replacements in files',
  },

  // ── Search ──────────────────────────────────────────
  {
    name: 'Glob',
    inputSchema: globInputSchema,
    permissionLevel: 'read',
    category: 'search',
    description: 'Fast file pattern matching tool',
  },
  {
    name: 'Grep',
    inputSchema: grepInputSchema,
    permissionLevel: 'read',
    category: 'search',
    description: 'Search file contents using ripgrep',
  },

  // ── Agent / subagent ────────────────────────────────
  {
    name: 'Agent',
    inputSchema: agentInputSchema,
    permissionLevel: 'write',
    category: 'agent',
    description: 'Launch a specialized sub-agent for complex tasks',
  },

  // ── Planning ────────────────────────────────────────
  {
    name: 'EnterPlanMode',
    inputSchema: emptyInputSchema,
    permissionLevel: 'none',
    category: 'planning',
    description: 'Enter planning mode for implementation design',
  },
  {
    name: 'ExitPlanMode',
    inputSchema: emptyInputSchema,
    permissionLevel: 'none',
    category: 'planning',
    description: 'Exit planning mode and proceed to implementation',
  },

  // ── Task management ─────────────────────────────────
  {
    name: 'TodoRead',
    inputSchema: emptyInputSchema,
    permissionLevel: 'none',
    category: 'task',
    description: 'Read the current todo/task list',
  },
  {
    name: 'TodoWrite',
    inputSchema: todoWriteInputSchema,
    permissionLevel: 'none',
    category: 'task',
    description: 'Create and manage a structured task list',
  },

  // ── Worktree ────────────────────────────────────────
  {
    name: 'EnterWorktree',
    inputSchema: enterWorktreeInputSchema,
    permissionLevel: 'write',
    category: 'task',
    description: 'Create an isolated git worktree',
  },
  {
    name: 'ExitWorktree',
    inputSchema: exitWorktreeInputSchema,
    permissionLevel: 'write',
    category: 'task',
    description: 'Exit a worktree session',
  },

  // ── Web ─────────────────────────────────────────────
  {
    name: 'WebSearch',
    inputSchema: webSearchInputSchema,
    permissionLevel: 'none',
    category: 'web',
    description: 'Search the web and return results',
  },
  {
    name: 'WebFetch',
    inputSchema: z.object({ url: z.string(), return_format: z.string().optional(), timeout: z.number().optional() }).strict(),
    permissionLevel: 'none',
    category: 'web',
    description: 'Fetch and read content from a URL',
  },

  // ── Notebook ────────────────────────────────────────
  {
    name: 'NotebookEdit',
    inputSchema: notebookEditInputSchema,
    permissionLevel: 'write',
    category: 'notebook',
    description: 'Edit Jupyter notebook cells',
  },

  // ── User interaction ────────────────────────────────
  {
    name: 'AskUserQuestion',
    inputSchema: askUserQuestionInputSchema,
    permissionLevel: 'none',
    category: 'user_interaction',
    description: 'Ask the user a clarifying question',
  },

  // ── Background tasks ────────────────────────────────
  {
    name: 'TaskOutput',
    inputSchema: taskOutputInputSchema,
    permissionLevel: 'none',
    category: 'task',
    description: 'Retrieve output from a running or completed background task',
  },
  {
    name: 'TaskStop',
    inputSchema: taskStopInputSchema,
    permissionLevel: 'none',
    category: 'task',
    description: 'Stop a running background task',
  },

  // ── Scheduling ──────────────────────────────────────
  {
    name: 'CronCreate',
    inputSchema: cronCreateInputSchema,
    permissionLevel: 'none',
    category: 'scheduling',
    description: 'Schedule a prompt to run on a recurring cron schedule',
  },
  {
    name: 'CronDelete',
    inputSchema: cronDeleteInputSchema,
    permissionLevel: 'none',
    category: 'scheduling',
    description: 'Cancel a scheduled cron job',
  },
  {
    name: 'CronList',
    inputSchema: emptyInputSchema,
    permissionLevel: 'none',
    category: 'scheduling',
    description: 'List all scheduled cron jobs',
  },

  // ── Skills ──────────────────────────────────────────
  {
    name: 'Skill',
    inputSchema: skillInputSchema,
    permissionLevel: 'none',
    category: 'skill',
    description: 'Execute a skill within the main conversation',
  },

  // ── Remote triggers ─────────────────────────────────
  {
    name: 'RemoteTrigger',
    inputSchema: remoteTriggerInputSchema,
    permissionLevel: 'none',
    category: 'trigger',
    description: 'Manage and run remote-triggered agents',
  },
];

// ── Registry lookup ────────────────────────────────────────────────────

const toolMap = new Map<string, ToolDefinition>();
for (const tool of tools) {
  toolMap.set(tool.name, tool);
}

/** Get a tool definition by name. Returns undefined if unknown. */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

/** Get all registered tool definitions. */
export function getAllTools(): readonly ToolDefinition[] {
  return tools;
}

/** Get tools filtered by category. */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return tools.filter(t => t.category === category);
}

/** Get tools filtered by permission level. */
export function getToolsByPermission(level: PermissionLevel): ToolDefinition[] {
  return tools.filter(t => t.permissionLevel === level);
}

/** Validate tool input against its registered schema.
 *  Returns parsed data on success, or a Zod error on failure. */
export function validateToolInput(
  toolName: string,
  input: unknown,
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const def = toolMap.get(toolName);
  if (!def) {
    return { success: false, error: new z.ZodError([{
      code: 'custom',
      path: [],
      message: `Unknown tool: ${toolName}`,
    }]) };
  }
  const result = def.inputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/** Check if a tool name is registered. */
export function isKnownTool(name: string): boolean {
  return toolMap.has(name);
}

/** Total number of registered tools. */
export const TOOL_COUNT = tools.length;
