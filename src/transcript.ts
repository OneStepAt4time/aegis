/**
 * transcript.ts — JSONL transcript parser for Claude Code sessions.
 * 
 * Port of CCBot's transcript_parser.py.
 * Reads CC session JSONL files and extracts structured messages.
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';

/** Default Claude projects directory */
const DEFAULT_CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export interface ParsedEntry {
  role: 'user' | 'assistant' | 'system';
  contentType: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'tool_error' | 'permission_request' | 'progress';
  text: string;
  toolName?: string;
  toolUseId?: string;
  timestamp?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

interface JsonlEntry {
  type: string;         // "user" | "assistant" | "progress" | "system" | etc.
  message?: {
    role: string;
    content: string | ContentBlock[];
    stop_reason?: string;
  };
  timestamp?: string;
  // Tool result entries
  tool_use_id?: string;
  // Progress entries
  data?: Record<string, unknown>;
}

/** Parse a single JSONL line. Returns null if not parseable. */
function parseLine(line: string): JsonlEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  try {
    return JSON.parse(trimmed) as JsonlEntry;
  } catch {
    return null;
  }
}

/** Summarize a tool_use block. */
function summarizeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'ReadNotebook':
      return `📖 **Read** ${input.file_path || input.path || ''}`;
    case 'Write':
    case 'MultiWrite':
      return `✏️ **Write** ${input.file_path || input.path || ''}`;
    case 'Edit':
      return `🔧 **Edit** ${input.file_path || input.path || ''}`;
    case 'Bash':
    case 'Terminal':
      return `💻 **Bash** \`${String(input.command || input.cmd || '').slice(0, 80)}\``;
    case 'Grep':
    case 'Search':
      return `🔍 **Search** \`${input.pattern || input.query || ''}\``;
    case 'Glob':
    case 'ListFiles':
      return `📁 **Glob** \`${input.pattern || input.path || ''}\``;
    case 'AskUserQuestion':
      return `❓ **Question**: ${input.question || ''}`;
    case 'TodoWrite':
      return `📝 **Todo** updated`;
    default:
      return `🔧 **${name}**`;
  }
}

/** Parse entries from JSONL data. */
export function parseEntries(entries: JsonlEntry[]): ParsedEntry[] {
  const results: ParsedEntry[] = [];
  const pendingTools = new Map<string, string>(); // tool_use_id -> summary

  for (const entry of entries) {
    if (entry.type === 'progress') {
      const text = entry.data ? JSON.stringify(entry.data) : '';
      if (text.trim()) {
        results.push({ role: 'system', contentType: 'progress', text, timestamp: entry.timestamp });
      }
      continue;
    }

    if (!entry.message) continue;

    const role = entry.message.role as 'user' | 'assistant';
    const content = entry.message.content;
    const timestamp = entry.timestamp;

    if (typeof content === 'string') {
      // Simple text message
      if (content.trim()) {
        results.push({ role, contentType: 'text', text: content.trim(), timestamp });
      }
      continue;
    }

    if (!Array.isArray(content)) continue;

    for (const block of content) {
      switch (block.type) {
        case 'text':
          if (block.text?.trim()) {
            results.push({ role, contentType: 'text', text: block.text.trim(), timestamp });
          }
          break;

        case 'thinking':
          if (block.thinking?.trim()) {
            results.push({ role, contentType: 'thinking', text: block.thinking.trim(), timestamp });
          }
          break;

        case 'tool_use': {
          const name = block.name || 'unknown';
          const input = (block.input || {}) as Record<string, unknown>;
          const summary = summarizeTool(name, input);
          if (block.id) {
            pendingTools.set(block.id, summary);
          }
          results.push({
            role: 'assistant',
            contentType: 'tool_use',
            text: summary,
            toolName: name,
            toolUseId: block.id,
            timestamp,
          });
          break;
        }

        case 'tool_result': {
          const toolId = block.tool_use_id || '';
          let resultText = '';
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = (block.content as ContentBlock[])
              .filter(c => c.type === 'text')
              .map(c => c.text || '')
              .join('\n');
          }
          // Truncate long results
          if (resultText.length > 500) {
            resultText = resultText.slice(0, 500) + '... (truncated)';
          }
          if (resultText.trim()) {
            results.push({
              role: 'assistant',
              contentType: block.is_error ? 'tool_error' : 'tool_result',
              text: resultText.trim(),
              toolUseId: toolId,
              timestamp,
            });
          }
          pendingTools.delete(toolId);
          break;
        }

        case 'permission_request': {
          const permText = block.text || JSON.stringify(block);
          if (permText.trim()) {
            results.push({
              role: 'user',
              contentType: 'permission_request',
              text: permText.trim(),
              timestamp,
            });
          }
          break;
        }
      }
    }
  }

  return results;
}

/** Read JSONL file from byte offset, return new entries + new offset. */
export async function readNewEntries(
  filePath: string,
  fromOffset: number
): Promise<{ entries: ParsedEntry[]; newOffset: number; raw: JsonlEntry[] }> {
  const fileStat = await stat(filePath);
  
  // File truncated (e.g. after /clear)
  if (fromOffset > fileStat.size) {
    return { entries: [], newOffset: 0, raw: [] };
  }
  
  if (fromOffset >= fileStat.size) {
    return { entries: [], newOffset: fromOffset, raw: [] };
  }

  // Read from byte offset to end (buffer-based for correct UTF-8 handling)
  const fullBuf = await readFile(filePath);
  const slicedBuf = fullBuf.subarray(fromOffset);
  const slicedContent = slicedBuf.toString('utf-8');

  const lines = slicedContent.split('\n');
  const rawEntries: JsonlEntry[] = [];

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      rawEntries.push(entry);
    }
  }

  const parsed = parseEntries(rawEntries);
  return { entries: parsed, newOffset: fileStat.size, raw: rawEntries };
}

/** Find the JSONL file for a session ID. */
export async function findSessionFile(
  sessionId: string,
  claudeProjectsDir: string = DEFAULT_CLAUDE_PROJECTS_DIR
): Promise<string | null> {
  const projectsDir = claudeProjectsDir;
  if (!existsSync(projectsDir)) return null;

  // Strategy 1: Direct glob across all project dirs
  const dirs = await readdir(projectsDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const jsonlPath = join(projectsDir, dir.name, `${sessionId}.jsonl`);
    if (existsSync(jsonlPath)) return jsonlPath;
  }

  // Strategy 2: Check sessions-index.json files
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const indexPath = join(projectsDir, dir.name, 'sessions-index.json');
    if (existsSync(indexPath)) {
      try {
        const indexData = JSON.parse(await readFile(indexPath, 'utf-8'));
        const entries = indexData.entries || [];
        for (const entry of entries) {
          if (entry.sessionId === sessionId && entry.fullPath && existsSync(entry.fullPath)) {
            return entry.fullPath;
          }
        }
      } catch { /* skip bad index */ }
    }
  }

  return null;
}
