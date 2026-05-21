/**
 * components/shared/CodeBlock.tsx — Safe, CSP-compatible syntax-highlighted code block renderer.
 *
 * Uses React element rendering (no dangerouslySetInnerHTML) for XSS safety and
 * CSP compatibility. Colors are driven by CSS custom properties for theme consistency.
 *
 * Token types: keyword, string, comment, number, plain
 */

import { Fragment, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useT } from '../../i18n/context';

// ── Token Types ─────────────────────────────────────────────

type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'plain';

interface Token {
  type: TokenType;
  value: string;
}

// ── Keyword Lists ──────────────────────────────────────────

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'import', 'export', 'from', 'default', 'async', 'await', 'try',
  'catch', 'throw', 'new', 'this', 'type', 'interface', 'extends', 'implements',
  'true', 'false', 'null', 'undefined', 'void', 'typeof', 'switch', 'case',
  'break', 'continue', 'do', 'finally', 'of', 'yield', 'super', 'static',
  'get', 'set', 'enum', 'readonly', 'as', 'in', 'delete', 'instanceof',
]);

const PYTHON_KEYWORDS = new Set([
  'def', 'print', 'self', 'lambda', 'elif', 'except', 'finally', 'with',
  'as', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'from',
  'import', 'class', 'return', 'if', 'else', 'for', 'while', 'try', 'catch',
  'raise', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal', 'assert',
  'async', 'await',
]);

const SHELL_KEYWORDS = new Set([
  'sudo', 'apt', 'npm', 'yarn', 'pip', 'cd', 'ls', 'mkdir', 'rm', 'cp',
  'mv', 'cat', 'echo', 'grep', 'find', 'chmod', 'chown', 'docker', 'git',
  'curl', 'wget', 'export', 'source', 'bash', 'sh', 'zsh', 'make', 'go',
  'cargo', 'rustc', 'python', 'python3', 'node', 'npx', 'pnpm', 'brew',
  'sudo', 'systemctl', 'journalctl', 'sed', 'awk', 'sort', 'uniq', 'wc',
  'head', 'tail', 'tee', 'xargs', 'kill', 'ps', 'top', 'htop', 'df', 'du',
]);

// ── Tokenizer ──────────────────────────────────────────────

function isShellLike(lang: string): boolean {
  const l = lang.toLowerCase();
  return l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh' || l === 'yaml';
}

function tokenize(code: string, language: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = code.length;
  const keywords = isShellLike(language) || language.toLowerCase() === 'python'
    ? new Set([...SHELL_KEYWORDS, ...PYTHON_KEYWORDS])
    : JS_KEYWORDS;

  while (i < len) {
    // Single-line comment
    if (code[i] === '#') {
      const start = i;
      while (i < len && code[i] !== '\n') i++;
      tokens.push({ type: 'comment', value: code.slice(start, i) });
      continue;
    }

    // C-style single-line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      const start = i;
      while (i < len && code[i] !== '\n') i++;
      tokens.push({ type: 'comment', value: code.slice(start, i) });
      continue;
    }

    // C-style multi-line comment
    if (code[i] === '/' && code[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
      if (i < len - 1) i += 2; // skip */
      tokens.push({ type: 'comment', value: code.slice(start, i) });
      continue;
    }

    // Strings (single, double, backtick)
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i];
      const start = i;
      i++;
      while (i < len && code[i] !== quote) {
        if (code[i] === '\\') i++; // skip escape
        i++;
      }
      if (i < len) i++; // skip closing quote
      tokens.push({ type: 'string', value: code.slice(start, i) });
      continue;
    }

    // Numbers
    if (/\d/.test(code[i]) && (i === 0 || !/\w/.test(code[i - 1]))) {
      const start = i;
      while (i < len && /[\d.]/.test(code[i])) i++;
      tokens.push({ type: 'number', value: code.slice(start, i) });
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$@]/.test(code[i])) {
      const start = i;
      while (i < len && /[\w$@]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else {
        tokens.push({ type: 'plain', value: word });
      }
      continue;
    }

    // Everything else (operators, punctuation, whitespace)
    tokens.push({ type: 'plain', value: code[i] });
    i++;
  }

  return tokens;
}

// ── Token Renderer ─────────────────────────────────────────

function TokenSpan({ token }: { token: Token }) {
  if (token.type === 'plain') {
    return <Fragment>{token.value}</Fragment>;
  }
  return (
    <span className={`syn-${token.type}`} title={token.type}>
      {token.value}
    </span>
  );
}

// ── Code Block Component ───────────────────────────────────

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const tokens = tokenize(code, language);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="my-2 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void-deepest)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-void-lighter)]">
        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label={t('aria.copyCode')}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-xs leading-relaxed font-mono text-[var(--color-text-primary)]">
        <code>
          {tokens.map((token, i) => (
            <TokenSpan key={i} token={token} />
          ))}
        </code>
      </pre>
    </div>
  );
}

// ── Markdown Code Block Renderer ───────────────────────────

export function RenderWithCodeBlocks({ text }: { text: string }) {
  const parts = parseMarkdownCodeBlocks(text);

  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.type === 'code' ? (
          <CodeBlock key={i} code={part.content} language={part.language} />
        ) : (
          <span key={i}>{part.content}</span>
        ),
      )}
    </div>
  );
}

// ── Markdown Parser (unchanged) ───────────────────────────

interface ParsedPart {
  type: 'text' | 'code';
  content: string;
  language: string;
}

function parseMarkdownCodeBlocks(text: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index), language: '' });
    }
    parts.push({ type: 'code', content: match[2], language: match[1] || 'text' });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex), language: '' });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text, language: '' }];
}
