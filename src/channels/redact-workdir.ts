/**
 * channels/redact-workdir.ts — Shared workdir redaction for notification channels.
 *
 * Replaces the user's home directory with '~' and keeps only the last 2 path
 * segments for privacy. Used by Email, Slack, and any other channel that
 * exposes session.workDir in outbound payloads.
 *
 * Pattern matches telegram/message-formatter.ts shortenHomePath + shortPath.
 */

import { homedir } from 'node:os';

export function redactWorkDir(workDir: string): string {
  const normalized = workDir.replace(/\\/g, '/');
  const home = homedir().replace(/\\/g, '/').replace(/\/+$/, '');

  // Replace home with ~
  let redacted = normalized;
  if (normalized === home) {
    redacted = '~';
  } else if (normalized.startsWith(`${home}/`)) {
    redacted = `~${normalized.slice(home.length)}`;
  }

  // Keep only last 2 segments for privacy
  const parts = redacted.replace(/^\//, '').split('/');
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}
