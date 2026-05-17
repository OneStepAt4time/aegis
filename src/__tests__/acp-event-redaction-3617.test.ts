/**
 * acp-event-redaction-3617.test.ts — Verify secret redaction in ACP event payloads.
 *
 * Issue #3617: Tool output and agent text were stored verbatim, accumulating
 * Bearer tokens, API keys, connection strings and other secrets on disk.
 * These tests verify that redactSecretsFromText catches all known patterns.
 */

import { describe, it, expect } from 'vitest';
import { redactSecretsFromText } from '../services/acp/event-mapper.js';

describe('redactSecretsFromText (#3617)', () => {
  // --- GitHub tokens ---
  it('should redact GitHub PAT (ghp_)', () => {
    const text = 'export GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('ghp_');
    expect(result).toContain('[REDACTED:github-pat]');
  });

  it('should redact GitHub OAuth token (gho_)', () => {
    const text = 'token: gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('gho_');
    expect(result).toContain('[REDACTED:github-oauth]');
  });

  // --- OpenAI / Anthropic keys ---
  it('should redact OpenAI API key (sk-)', () => {
    const text = 'sk-proj-abc123def456ghi789jkl012mno345pqr678stu';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('sk-proj-');
    expect(result).toContain('[REDACTED:openai-key]');
  });

  it('should redact Anthropic API key (sk-ant-)', () => {
    const text = 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwx';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('sk-ant-');
    expect(result).toContain('[REDACTED:anthropic-key]');
  });

  // --- Bearer tokens ---
  it('should redact Bearer tokens in Authorization headers', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('eyJhbGci');
    expect(result).toContain('[REDACTED:bearer-token]');
  });

  it('should redact Bearer tokens with lowercase "bearer"', () => {
    const text = 'authorization: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('eyJhbGci');
    expect(result).toContain('[REDACTED:bearer-token]');
  });

  it('should redact multiple Bearer tokens in the same text', () => {
    const text = 'Header: Bearer eyJhbGciOiJSUzI1NiJ9.abc123==\nOther: Bearer eyJhbGciOiJSUzI1NiJ9.xyz789==';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('eyJhbGci');
    const matches = result.match(/\[REDACTED:bearer-token\]/g);
    expect(matches).toHaveLength(2);
  });

  // --- Slack tokens ---
  it('should redact Slack bot token (xoxb-)', () => {
    const text = 'SLACK_TOKEN=xoxb-F00FDEADBEEF-FAKEFAKEFAKEFAKEFAKEFAKE';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('xoxb-');
    expect(result).toContain('[REDACTED:slack-token]');
  });

  // --- GitLab PAT ---
  it('should redact GitLab personal access token', () => {
    const text = 'PRIVATE_TOKEN=glpat-abcdefghijklmnopqrstuvwx';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('glpat-');
    expect(result).toContain('[REDACTED:gitlab-pat]');
  });

  // --- AWS keys ---
  it('should redact AWS access key ID', () => {
    const text = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('AKIAIOSFODNN7');
    expect(result).toContain('[REDACTED:aws-key-id]');
  });

  // --- Private keys ---
  it('should redact PEM private keys', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('MIIEpAIBAAKCAQEA');
    expect(result).toContain('[REDACTED:private-key]');
    expect(result).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
  });

  it('should redact OpenSSH private keys', () => {
    const text = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk...\n-----END OPENSSH PRIVATE KEY-----';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('b3BlbnNzaC1rZXk');
    expect(result).toContain('[REDACTED:private-key]');
  });

  // --- Connection strings ---
  it('should redact MongoDB connection strings with password', () => {
    const text = 'MONGODB_URI=mongodb+srv://admin:s3cret@cluster.mongodb.net/mydb';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('s3cret');
    expect(result).toContain('[REDACTED:connection-string]');
  });

  it('should redact PostgreSQL connection strings', () => {
    const text = 'DATABASE_URL=postgres://user:p4ssw0rd@db.example.com:5432/mydb';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('p4ssw0rd');
    expect(result).toContain('[REDACTED:connection-string]');
  });

  it('should redact Redis connection strings', () => {
    const text = 'REDIS_URL=redis://default:s3cret@redis.example.com:6379';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('s3cret');
    expect(result).toContain('[REDACTED:connection-string]');
  });

  // --- Edge cases ---
  it('should not redact non-secret text', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    expect(redactSecretsFromText(text)).toBe(text);
  });

  it('should not redact short bearer-like phrases', () => {
    const text = 'Bearer of bad news';
    expect(redactSecretsFromText(text)).toBe(text);
  });

  it('should not redact placeholder URLs without passwords', () => {
    const text = 'https://example.com/api/v1/resource';
    expect(redactSecretsFromText(text)).toBe(text);
  });

  it('should handle empty string', () => {
    expect(redactSecretsFromText('')).toBe('');
  });

  // --- Real-world patterns from forensic analysis ---
  it('should redact Bearer tokens found in tool output (pattern from forensic scan)', () => {
    // This pattern was found 19 times in acp-local-storage.json
    const text = 'Authorization: Bearer aut_o8X6UqFG0BNPN5MnmFOKF72VGjuYp4lTIE+mR/c=';
    const result = redactSecretsFromText(text);
    expect(result).not.toContain('aut_o8X6UqFG0BNPN5MnmFOKF72VGjuYp4lTIE');
    expect(result).toContain('[REDACTED:bearer-token]');
  });
});
