#!/usr/bin/env node
/**
 * generate-openapi.mjs — Generate openapi.yaml from Zod schemas at build time.
 *
 * Imports the compiled generateOpenApiDocument and writes the result
 * as JSON and YAML to dist/.
 *
 * Issue #1909.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

// Ensure dist exists
mkdirSync(distDir, { recursive: true });

// Dynamic import of compiled JS (must run after tsc)
const { generateOpenApiDocument } = await import('../dist/openapi.js');
const { registerOpenApiSpec } = await import('../dist/routes/openapi.js');

// Register all endpoint descriptors then generate the document
registerOpenApiSpec();
const doc = generateOpenApiDocument();

// Write JSON
const jsonPath = join(distDir, 'openapi.json');
writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n');
console.log(`✓ ${jsonPath}`);

// Write YAML (manual serialization — no dependency needed)
const yamlPath = join(distDir, 'openapi.yaml');
writeFileSync(yamlPath, jsonToYaml(doc));
console.log(`✓ ${yamlPath}`);

/**
 * Minimal JSON-to-YAML serializer. Handles the flat OpenAPI document structure
 * without requiring a third-party YAML library.
 */
function jsonToYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];

  if (obj === null || obj === undefined) return 'null\n';
  if (typeof obj !== 'object') return `${JSON.stringify(obj)}\n`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]\n';
    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        lines.push(`${pad}- ${jsonToYaml(item, indent + 1).trimStart()}`);
      } else {
        lines.push(`${pad}- ${JSON.stringify(item)}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  const keys = Object.keys(obj);
  for (const key of keys) {
    const val = obj[key];
    const needsQuote = /[:{}\[\],&*?|>!%#@`"'\\]/.test(key) || /^\d/.test(key) || key === '';
    const safeKey = needsQuote ? JSON.stringify(key) : key;

    if (val === null || val === undefined) {
      lines.push(`${pad}${safeKey}: null`);
    } else if (typeof val === 'boolean' || typeof val === 'number') {
      lines.push(`${pad}${safeKey}: ${val}`);
    } else if (typeof val === 'string') {
      lines.push(`${pad}${safeKey}: ${JSON.stringify(val)}`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${safeKey}: []`);
      } else {
        lines.push(`${pad}${safeKey}:`);
        lines.push(jsonToYaml(val, indent + 1));
      }
    } else if (typeof val === 'object') {
      const subKeys = Object.keys(val);
      if (subKeys.length === 0) {
        lines.push(`${pad}${safeKey}: {}`);
      } else {
        lines.push(`${pad}${safeKey}:`);
        lines.push(jsonToYaml(val, indent + 1));
      }
    }
  }
  return lines.join('\n') + '\n';
}
