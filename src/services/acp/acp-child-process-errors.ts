/**
 * acp-child-process-errors.ts — Error types for AcpChildProcess.
 * Extracted to break a circular import between child-process.ts and
 * permission-mode-args-4522.ts (Issue #4522).
 */

export interface AcpChildProcessErrorDetails {
  command: string;
  args: string[];
  cwd: string;
  message: string;
}

export class AcpChildProcessStartError extends Error {
  readonly code = 'AEGIS_ACP_CHILD_PROCESS_START_FAILED';
  readonly details: AcpChildProcessErrorDetails;

  constructor(details: AcpChildProcessErrorDetails) {
    super(`ACP child process failed to start: ${details.message}`);
    this.name = 'AcpChildProcessStartError';
    this.details = details;
  }
}
