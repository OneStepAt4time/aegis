/**
 * mcp/prompts.ts — MCP prompt templates.
 *
 * 3 prompts: implement_issue, review_pr, debug_session.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  validateIssueOrPrNumber,
  validateRepoField,
  validateSessionId,
  validateWorkDir,
} from './prompt-sanitizer.js';

const DEFAULT_REPO_OWNER = 'OneStepAt4time';
const DEFAULT_REPO_NAME = 'aegis';

function resolveRepoContext(
  repoOwner: string | undefined,
  repoName: string | undefined,
): { owner: string; repo: string } {
  return {
    owner: repoOwner ? validateRepoField('repoOwner', repoOwner) : DEFAULT_REPO_OWNER,
    repo: repoName ? validateRepoField('repoName', repoName) : DEFAULT_REPO_NAME,
  };
}

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'implement_issue',
    'Create a session and generate a structured implementation prompt for a GitHub issue.',
    {
      issueNumber: z.string().describe('GitHub issue number'),
      workDir: z.string().describe('Working directory for the new session'),
      repoOwner: z.string().optional().describe('Repository owner (e.g., "OneStepAt4time")'),
      repoName: z.string().optional().describe('Repository name (e.g., "aegis")'),
    },
    async ({ issueNumber, workDir, repoOwner, repoName }) => {
      const safeIssueNumber = validateIssueOrPrNumber('issueNumber', issueNumber);
      const safeWorkDir = validateWorkDir(workDir);
      const { owner, repo } = resolveRepoContext(repoOwner, repoName);
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${safeIssueNumber}`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are tasked with implementing a GitHub issue.',
                '',
                `Issue: ${owner}/${repo}#${safeIssueNumber}`,
                `URL: ${issueUrl}`,
                `Working directory: ${safeWorkDir}`,
                '',
                'Steps:',
                `1. Create a new Aegis session in ${safeWorkDir}`,
                `2. Read the GitHub issue at ${issueUrl} to understand the requirements`,
                '3. Analyze the codebase to understand the current architecture',
                '4. Plan the implementation approach',
                '5. Implement the changes following project conventions',
                '6. Run the quality gate: npx tsc --noEmit && npm run build && npm test',
                '7. If tests pass, commit with a conventional commit message',
                '',
                'Use the create_session tool to start, then send_message for each step.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'review_pr',
    'Create a session and generate a structured code review prompt for a GitHub pull request.',
    {
      prNumber: z.string().describe('GitHub pull request number'),
      workDir: z.string().describe('Working directory for the new session'),
      repoOwner: z.string().optional().describe('Repository owner (e.g., "OneStepAt4time")'),
      repoName: z.string().optional().describe('Repository name (e.g., "aegis")'),
    },
    async ({ prNumber, workDir, repoOwner, repoName }) => {
      const safePrNumber = validateIssueOrPrNumber('prNumber', prNumber);
      const safeWorkDir = validateWorkDir(workDir);
      const { owner, repo } = resolveRepoContext(repoOwner, repoName);
      const prUrl = `https://github.com/${owner}/${repo}/pull/${safePrNumber}`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are tasked with reviewing a GitHub pull request.',
                '',
                `PR: ${owner}/${repo}#${safePrNumber}`,
                `URL: ${prUrl}`,
                `Working directory: ${safeWorkDir}`,
                '',
                'Steps:',
                `1. Create a new Aegis session in ${safeWorkDir}`,
                `2. Fetch the PR details: gh pr view ${safePrNumber} --repo ${owner}/${repo}`,
                `3. Fetch the PR diff: gh pr diff ${safePrNumber} --repo ${owner}/${repo}`,
                '4. Review the changes for:',
                '   - Correctness and edge cases',
                '   - Adherence to project coding conventions (see CLAUDE.md)',
                '   - Security vulnerabilities (injection, XSS, etc.)',
                '   - Test coverage for new code',
                '   - Breaking changes or backwards compatibility',
                '5. Post the review as a PR comment using gh api',
                '',
                'Use the create_session tool to start, then send_message for each step.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'debug_session',
    'Generate a diagnostic summary for an Aegis session by reading its transcript and status.',
    {
      sessionId: z.string().describe('The Aegis session ID to debug'),
    },
    async ({ sessionId }) => {
      const safeSessionId = validateSessionId(sessionId);

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are diagnosing an Aegis session that may be stuck or misbehaving.',
                '',
                `Session ID: ${safeSessionId}`,
                '',
                'Steps:',
                `1. Get the session status using get_status for session ${safeSessionId}`,
                `2. Read the transcript using get_transcript for session ${safeSessionId}`,
                `3. Capture the current terminal pane using capture_pane for session ${safeSessionId}`,
                '4. Analyze the findings:',
                '   - Is the session in an unexpected state (permission_prompt, unknown)?',
                '   - Are there error messages in the transcript?',
                '   - Is the session stalled (no recent activity)?',
                '   - Are there repeated permission requests?',
                '5. Provide a diagnostic summary with recommended actions',
                '',
                'Use get_status, get_transcript, and capture_pane tools to gather data.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}
