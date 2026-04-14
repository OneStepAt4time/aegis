/**
 * components/shared/CodeBlock.tsx — Syntax-highlighted code block renderer.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Lightweight syntax highlighting via regex — zero dependencies
function highlight(code: string, language: string): string {
  let html = escapeHtml(code);

  // Strings (single/double quotes, backticks)
  html = html.replace(/(&#39;[^]*?&#39;|&quot;[^]*?&quot;|`[^]*?`)/g, '<span style="color:#a5d6ff">$1</span>');

  // Comments
  if (language === 'python' || language === 'yaml' || language === 'bash' || language === 'sh') {
    html = html.replace(/(#[^\n]*)/g, '<span style="color:#8b949e">$1</span>');
  } else {
    html = html.replace(/(\/\/[^\n]*)/g, '<span style="color:#8b949e">$1</span>');
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#8b949e">$1</span>');
  }

  // Numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');

  // Keywords (common set)
  const keywords = [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import',
    'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'type',
    'interface', 'extends', 'implements', 'true', 'false', 'null', 'undefined', 'void', 'typeof',
    'def', 'print', 'self', 'lambda', 'elif', 'except', 'finally', 'with', 'as', 'in', 'not', 'and',
    'or', 'is', 'None', 'True', 'False',
    'sudo', 'apt', 'npm', 'yarn', 'pip', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'echo',
    'grep', 'find', 'chmod', 'chown', 'docker', 'git', 'curl', 'wget',
  ];
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  html = html.replace(kwRegex, '<span style="color:#ff7b72">$1</span>');

  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="my-2 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void-deepest)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-void-lighter)]">
        <span className="text-[10px] text-zinc-500 font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-xs leading-relaxed font-mono text-zinc-300">
        <code dangerouslySetInnerHTML={{ __html: highlight(code, language) }} />
      </pre>
    </div>
  );
}

/**
 * Parse markdown text and render with code blocks highlighted.
 */
export function RenderWithCodeBlocks({ text }: { text: string }) {
  const parts = parseMarkdownCodeBlocks(text);

  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.type === 'code' ? (
          <CodeBlock key={i} code={part.content} language={part.language} />
        ) : (
          <span key={i}>{part.content}</span>
        )
      )}
    </div>
  );
}

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
