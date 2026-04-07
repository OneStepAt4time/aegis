/**
 * transcript.ts — JSONL transcript parser for Claude Code sessions.
 * 
 * Port of CCBot's transcript_parser.py.
 * Reads CC session JSONL files and extracts structured messages.
 */

import { readFile, open, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { sessionsIndexSchema } from './validation.js';
import { safeJsonParse, safeJsonParseSchema } from './safe-json.js';

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

/** Issue #488: Cumulative token usage extracted from a batch of JSONL entries. */
export interface TokenUsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface JsonlEntry {
  type: string;         // "user" | "assistant" | "progress" | "system" | etc.
  message?: {
    role: string;
    content: string | ContentBlock[];
    stop_reason?: string;
    /** Token usage reported by the model (present on assistant messages). */
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  timestamp?: string;
  // Tool result entries
  tool_use_id?: string;
  // Progress entries
  data?: Record<string, unknown>;
}

/** Parse a single JSONL line. Returns null if not parseable.
 *  Issue #823: Logs at error level when a non-empty line is dropped. */
function parseLine(line: string): JsonlEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') {
    // Lines that are blank or don't start with '{' are expected (separators, comments)
    return null;
  }
  const parsed = safeJsonParse(trimmed, 'JSONL line');
  if (!parsed.ok) {
    // Issue #823: Log malformed JSON lines so data loss is visible
    console.error(`parseLine: dropping malformed JSONL line (${parsed.error}): ${trimmed.slice(0, 200)}`);
    return null;
  }
  return parsed.data as JsonlEntry;
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

/** Issue #488: Sum token usage across a batch of raw JSONL entries. */
export function extractTokenDelta(raw: JsonlEntry[]): TokenUsageDelta {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  for (const entry of raw) {
    const u = entry.message?.usage;
    if (!u) continue;
    inputTokens += u.input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
    cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
    cacheReadTokens += u.cache_read_input_tokens ?? 0;
  }
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
}

/** Read JSONL file from byte offset, return new entries + new offset. */
export async function readNewEntries(
  filePath: string,
  fromOffset: number
): Promise<{ entries: ParsedEntry[]; newOffset: number; raw: JsonlEntry[] }> {
  // Issue #623: Use a single fd for stat + read to eliminate TOCTOU race.
  const fd = await open(filePath, 'r');
  try {
    const fileStat = await fd.stat();

    // File truncated (e.g. after /clear)
    if (fromOffset > fileStat.size) {
      return { entries: [], newOffset: 0, raw: [] };
    }

    if (fromOffset >= fileStat.size) {
      return { entries: [], newOffset: fromOffset, raw: [] };
    }

    // Read from byte offset to end using createReadStream to avoid loading entire file
    // Issue #222: Only read from offset forward, not the whole file
    // Issue #259: If offset lands mid-entry, scan backwards to previous newline
    // Issue #409: Use async I/O instead of readFileSync to avoid blocking the event loop
    let effectiveOffset = fromOffset;
    if (effectiveOffset > 0) {
      const scanSize = 4096;
      const scanStart = Math.max(0, effectiveOffset - scanSize);
      const scanLen = effectiveOffset - scanStart;
      const scanBuf = Buffer.alloc(scanLen);
      await fd.read(scanBuf, 0, scanLen, scanStart);
      let _foundNewline = false;
      for (let i = scanBuf.length - 1; i >= 0; i--) {
        if (scanBuf[i] === 0x0a) { // '\n'
          effectiveOffset = scanStart + i + 1;
          _foundNewline = true;
          break;
        }
      }
      // Issue #836: If no newline found in the scan window, the line is
      // longer than scanSize. Keep effectiveOffset as-is (fromOffset) —
      // starting mid-line is handled by JSON.parse rejecting partial lines.
      // Never fall back to offset 0, which causes O(n) re-reads.
    }

    const slicedContent = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      // Reuse the same fd — autoClose: false because we close it in the outer finally
      const stream = createReadStream(filePath, { fd: fd.fd, start: effectiveOffset, autoClose: false });
      stream.on('data', (chunk: string | Buffer) => { if (typeof chunk !== 'string') chunks.push(chunk); });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });

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
  } finally {
    await fd.close();
  }
}

/** Check if a path exists (async). Issue #658: replaces sync existsSync. */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Find the JSONL file for a session ID. */
export async function findSessionFile(
  sessionId: string,
  claudeProjectsDir: string = DEFAULT_CLAUDE_PROJECTS_DIR
): Promise<string | null> {
  const projectsDir = claudeProjectsDir;
  if (!(await pathExists(projectsDir))) return null;

  // Strategy 1: Direct glob across all project dirs
  const dirs = await readdir(projectsDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const jsonlPath = join(projectsDir, dir.name, `${sessionId}.jsonl`);
    if (await pathExists(jsonlPath)) return jsonlPath;
  }

  // Strategy 2: Check sessions-index.json files
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const indexPath = join(projectsDir, dir.name, 'sessions-index.json');
    if (await pathExists(indexPath)) {
      try {
        const indexRaw = await readFile(indexPath, 'utf-8');
        const indexParsed = safeJsonParseSchema(indexRaw, sessionsIndexSchema, 'sessions-index.json');
        if (!indexParsed.ok) continue;
        const entries = indexParsed.data.entries || [];
        for (const entry of entries) {
          if (entry.sessionId === sessionId && entry.fullPath && (await pathExists(entry.fullPath))) {
            return entry.fullPath;
          }
        }
      } catch { /* skip bad index */ }
    }
  }

  return null;
}
