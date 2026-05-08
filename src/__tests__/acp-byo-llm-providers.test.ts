/**
 * acp-byo-llm-providers.test.ts — Issue #2662
 *
 * BYO LLM provider matrix tests for the ACP lifecycle probe.
 * Verifies that each supported model provider correctly passes through
 * provider metadata, environment variables, and model selection to the
 * ACP child process using the fake ACP agent fixture (no real API keys).
 *
 * Providers tested: glm, lm-studio, azure-openai
 * (anthropic, openrouter, ollama are already covered in acp-lifecycle-probe.test.ts)
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type AcpLifecycleProbeResult,
  REDACTED_ACP_VALUE,
  runAcpLifecycleProbe,
  type JsonObject,
} from '../acp-lifecycle-probe.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-agent.mjs');
const anthAuthTokenKey = ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_');
const anthBaseUrlKey = ['ANTHROPIC', 'BASE', 'URL'].join('_');
const anthDefaultModelKey = ['ANTHROPIC', 'DEFAULT', 'MODEL'].join('_');
const anthFastModelKey = ['ANTHROPIC', 'DEFAULT', 'FAST', 'MODEL'].join('_');
const apiTimeoutKey = ['API', 'TIMEOUT', 'MS'].join('_');

function nodeFixtureOptions(extraEnv: Record<string, string | undefined> = {}) {
  return {
    command: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    sessionCwd: process.cwd(),
    env: extraEnv,
    timeoutMs: 2_000,
  };
}

function findProbePassthrough(result: AcpLifecycleProbeResult): JsonObject {
  for (const notification of result.notifications) {
    const update = notification.params?.update;
    if (isJsonObject(update) && update.sessionUpdate === 'acp_probe_passthrough') {
      return update;
    }
  }
  throw new Error('fake ACP agent did not report passthrough metadata');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shared expected env keys — all BYO LLM providers use the same
 * Anthropic-compatible env var names mapped through the ACP layer.
 */
const EXPECTED_ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_FAST_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'API_TIMEOUT_MS',
];

describe('ACP BYO LLM provider matrix (#2662)', () => {
  // ── GLM (ZhipuAI / ChatGLM) ────────────────────────────────────

  describe('glm provider', () => {
    it('passes glm provider metadata and env to the ACP child process', async () => {
      const result = await runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        model: 'glm-4-plus',
        modelProvider: 'glm',
        providerEnv: {
          [anthBaseUrlKey]: 'https://open.bigmodel.cn/api/paas/v4',
          [anthAuthTokenKey]: 'glm-test-api-key',
          [anthDefaultModelKey]: 'glm-4-plus',
          [anthFastModelKey]: 'glm-4-flash',
          [apiTimeoutKey]: '30000',
        },
      });

      const passthrough = findProbePassthrough(result);

      expect(result.modelPassthrough.provider).toBe('glm');
      expect(result.modelPassthrough.model).toBe('glm-4-plus');
      expect(result.modelPassthrough.env).toEqual({
        [anthBaseUrlKey]: 'https://open.bigmodel.cn/api/paas/v4',
        [anthAuthTokenKey]: REDACTED_ACP_VALUE,
        [anthDefaultModelKey]: 'glm-4-plus',
        [anthFastModelKey]: 'glm-4-flash',
        [apiTimeoutKey]: '30000',
      });

      expect(passthrough.provider).toBe('glm');
      expect(passthrough.model).toBe('glm-4-plus');
      expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvKeys).toEqual(EXPECTED_ENV_KEYS);

      // Verify secret redaction
      expect(JSON.stringify(result.modelPassthrough)).not.toContain('glm-test-api-key');
    });
  });

  // ── LM Studio (local) ──────────────────────────────────────────

  describe('lm-studio provider', () => {
    it('passes lm-studio provider metadata with local endpoint to the ACP child process', async () => {
      const result = await runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        model: 'llama-3.3-70b-instruct',
        modelProvider: 'lm-studio',
        providerEnv: {
          [anthBaseUrlKey]: 'http://127.0.0.1:1234/v1',
          [anthAuthTokenKey]: 'lm-studio-local',
          [anthDefaultModelKey]: 'llama-3.3-70b-instruct',
          [anthFastModelKey]: 'llama-3.3-70b-instruct',
          [apiTimeoutKey]: '120000',
        },
      });

      const passthrough = findProbePassthrough(result);

      expect(result.modelPassthrough.provider).toBe('lm-studio');
      expect(result.modelPassthrough.model).toBe('llama-3.3-70b-instruct');
      expect(result.modelPassthrough.env).toEqual({
        [anthBaseUrlKey]: 'http://127.0.0.1:1234/v1',
        [anthAuthTokenKey]: REDACTED_ACP_VALUE,
        [anthDefaultModelKey]: 'llama-3.3-70b-instruct',
        [anthFastModelKey]: 'llama-3.3-70b-instruct',
        [apiTimeoutKey]: '120000',
      });

      expect(passthrough.provider).toBe('lm-studio');
      expect(passthrough.model).toBe('llama-3.3-70b-instruct');
      expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvKeys).toEqual(EXPECTED_ENV_KEYS);
    });

    it('supports lm-studio with no auth token (local unauthenticated endpoint)', async () => {
      const result = await runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        model: 'mistral-7b-instruct',
        modelProvider: 'lm-studio',
        providerEnv: {
          [anthBaseUrlKey]: 'http://localhost:1234/v1',
          [anthDefaultModelKey]: 'mistral-7b-instruct',
          [anthFastModelKey]: 'mistral-7b-instruct',
        },
      });

      const passthrough = findProbePassthrough(result);

      expect(result.modelPassthrough.provider).toBe('lm-studio');
      expect(result.modelPassthrough.model).toBe('mistral-7b-instruct');
      expect(passthrough.spawnEnvAuthTokenSeen).toBe(false);
      expect(passthrough.optionEnvAuthTokenSeen).toBe(false);
    });
  });

  // ── Azure OpenAI ────────────────────────────────────────────────

  describe('azure-openai provider', () => {
    it('passes azure-openai provider metadata and env to the ACP child process', async () => {
      const result = await runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        model: 'gpt-4.1',
        modelProvider: 'azure-openai',
        providerEnv: {
          [anthBaseUrlKey]: 'https://example.openai.azure.com/openai/deployments/my-deployment',
          [anthAuthTokenKey]: 'azure-api-key-test',
          [anthDefaultModelKey]: 'gpt-4.1',
          [anthFastModelKey]: 'gpt-4.1-mini',
          [apiTimeoutKey]: '60000',
        },
      });

      const passthrough = findProbePassthrough(result);

      expect(result.modelPassthrough.provider).toBe('azure-openai');
      expect(result.modelPassthrough.model).toBe('gpt-4.1');
      expect(result.modelPassthrough.env).toEqual({
        [anthBaseUrlKey]: 'https://example.openai.azure.com/openai/deployments/my-deployment',
        [anthAuthTokenKey]: REDACTED_ACP_VALUE,
        [anthDefaultModelKey]: 'gpt-4.1',
        [anthFastModelKey]: 'gpt-4.1-mini',
        [apiTimeoutKey]: '60000',
      });

      expect(passthrough.provider).toBe('azure-openai');
      expect(passthrough.model).toBe('gpt-4.1');
      expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvKeys).toEqual(EXPECTED_ENV_KEYS);

      // Verify secret redaction
      expect(JSON.stringify(result.modelPassthrough)).not.toContain('azure-api-key-test');
    });
  });

  // ── Cross-provider validation ───────────────────────────────────

  describe('cross-provider validation', () => {
    it('rejects provider-native env keys for glm (only mapped keys allowed)', async () => {
      await expect(
        runAcpLifecycleProbe({
          ...nodeFixtureOptions(),
          modelProvider: 'glm',
          providerEnv: {
            GLM_API_KEY: 'should-be-rejected',
          },
        })
      ).rejects.toThrow('Provider env GLM_API_KEY is not allowlisted for glm');
    });

    it('rejects provider-native env keys for lm-studio', async () => {
      await expect(
        runAcpLifecycleProbe({
          ...nodeFixtureOptions(),
          modelProvider: 'lm-studio',
          providerEnv: {
            LM_STUDIO_API_KEY: 'should-be-rejected',
          },
        })
      ).rejects.toThrow('Provider env LM_STUDIO_API_KEY is not allowlisted for lm-studio');
    });

    it('rejects provider-native env keys for azure-openai', async () => {
      await expect(
        runAcpLifecycleProbe({
          ...nodeFixtureOptions(),
          modelProvider: 'azure-openai',
          providerEnv: {
            AZURE_OPENAI_API_KEY: 'should-be-rejected',
          },
        })
      ).rejects.toThrow(
        'Provider env AZURE_OPENAI_API_KEY is not allowlisted for azure-openai'
      );
    });

    it('all providers share the same env key allowlist', async () => {
      // Verify each provider accepts the same set of mapped keys
      const providers = ['anthropic', 'glm', 'openrouter', 'lm-studio', 'ollama', 'azure-openai'] as const;

      for (const provider of providers) {
        const result = await runAcpLifecycleProbe({
          ...nodeFixtureOptions(),
          model: 'test-model',
          modelProvider: provider,
          providerEnv: {
            [anthBaseUrlKey]: 'https://test.example.com',
            [anthAuthTokenKey]: 'test-token',
            [anthDefaultModelKey]: 'test-model',
            [anthFastModelKey]: 'test-fast-model',
            [apiTimeoutKey]: '30000',
          },
        });

        const passthrough = findProbePassthrough(result);
        expect(passthrough.optionEnvKeys).toEqual(EXPECTED_ENV_KEYS);
        expect(passthrough.provider).toBe(provider);
      }
    });
  });
});
