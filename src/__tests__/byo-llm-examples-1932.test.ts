import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENV_BYO_LLM_WHITELIST } from '../validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, '..', '..', 'examples', 'byo-llm');
const configFiles = readdirSync(examplesDir)
  .filter(name => name.endsWith('.aegis.config.json'))
  .sort();

const expectedProviders = [
  'azure-openai.aegis.config.json',
  'glm.aegis.config.json',
  'lm-studio.aegis.config.json',
  'ollama.aegis.config.json',
  'openrouter.aegis.config.json',
];

const expectedEnvKeys = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_FAST_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'API_TIMEOUT_MS',
].sort();

describe('BYO LLM example configs (Issue #1932)', () => {
  it('ships a runnable config template for every supported provider family', () => {
    expect(configFiles).toEqual(expectedProviders);
  });

  for (const fileName of expectedProviders) {
    it(`${fileName} only uses allowlisted BYO LLM env vars`, () => {
      const parsed = JSON.parse(
        readFileSync(path.join(examplesDir, fileName), 'utf8'),
      ) as { defaultSessionEnv?: Record<string, string> };

      const envKeys = Object.keys(parsed.defaultSessionEnv ?? {}).sort();
      expect(envKeys).toEqual(expectedEnvKeys);
      expect(envKeys.every(key => ENV_BYO_LLM_WHITELIST.includes(key))).toBe(true);
    });
  }
});
