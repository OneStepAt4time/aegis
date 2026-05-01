#!/usr/bin/env node
/**
 * generate-openapi.mjs — Generate openapi.yaml from Zod schemas at build time.
 *
 * Imports the compiled generateOpenApiDocument and writes the result
 * as JSON and YAML to dist/.
 *
 * Issue #1909.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = dirname(scriptPath);
const distDir = join(__dirname, '..', 'dist');
const rootOpenApiPath = join(__dirname, '..', 'openapi.yaml');

const operationIdOverrides = {
  'GET /v1/sessions/history': 'listSessionHistory',
  'GET /v1/sessions/health': 'getSessionsHealth',
  'POST /v1/sessions/{id}/answer': 'answerSessionQuestion',
  'GET /v1/sessions/{id}/transcript': 'getSessionTranscript',
  'GET /v1/sessions/{id}/tools': 'listSessionTools',
  'POST /v1/sessions/{id}/hooks/permission': 'handleSessionPermissionHook',
  'POST /v1/sessions/{id}/hooks/stop': 'handleSessionStopHook',
  'POST /v1/auth/keys/{id}/rotate': 'rotateApiKey',
  'GET /v1/alerts/stats': 'getAlertStats',
  'POST /v1/alerts/test': 'sendTestAlert',
  'GET /v1/analytics/costs': 'getAnalyticsCosts',
  'GET /v1/analytics/rate-limits': 'getAnalyticsRateLimits',
  'GET /v1/audit': 'getAuditLog',
};

if (isMainModule()) {
  await main();
}

function mergeWithRootContract(generatedDoc) {
  if (!existsSync(rootOpenApiPath)) return withOperationIds(generatedDoc);

  const rootDoc = loadRootOpenApiDocument();
  return mergeOpenApiDocuments(generatedDoc, rootDoc);
}

export function mergeOpenApiDocuments(generatedDoc, rootDoc) {
  const generated = withOperationIds(generatedDoc);
  if (!rootDoc) return generated;

  const merged = deepClone(rootDoc);
  merged.openapi = generated.openapi;
  merged.paths = merged.paths ?? {};

  for (const [path, generatedPathItem] of Object.entries(generated.paths ?? {})) {
    if (!merged.paths[path]) {
      merged.paths[path] = generatedPathItem;
      continue;
    }

    for (const [method, generatedOperation] of Object.entries(generatedPathItem)) {
      if (!isHttpMethod(method)) continue;
      if (!merged.paths[path][method] || operationIdOverrides[`${method.toUpperCase()} ${path}`]) {
        merged.paths[path][method] = generatedOperation;
      } else if (!merged.paths[path][method].operationId) {
        merged.paths[path][method].operationId = generatedOperation.operationId;
      }
    }
  }

  return merged;
}

async function main() {
  const args = new Set(process.argv.slice(2));

  // Ensure dist exists
  mkdirSync(distDir, { recursive: true });

  // Dynamic import of compiled JS (must run after tsc)
  const { generateOpenApiDocument } = await import('../dist/openapi.js');
  const { registerOpenApiSpec } = await import('../dist/routes/openapi.js');

  // Register all endpoint descriptors then generate the document
  registerOpenApiSpec();
  const generatedDoc = generateOpenApiDocument();
  const doc = mergeWithRootContract(generatedDoc);

  // Write JSON
  const jsonPath = join(distDir, 'openapi.json');
  writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ ${jsonPath}`);

  // Write YAML (manual serialization — no dependency needed)
  const yamlPath = join(distDir, 'openapi.yaml');
  writeFileSync(yamlPath, toYamlDocument(doc));
  console.log(`✓ ${yamlPath}`);

  if (args.has('--write-root')) {
    writeFileSync(rootOpenApiPath, toYamlDocument(doc));
    console.log(`✓ ${rootOpenApiPath}`);
  }

  if (args.has('--check-root')) {
    const rootDoc = loadRootOpenApiDocument();
    const actual = stableJson(rootDoc);
    const expected = stableJson(doc);
    if (actual !== expected) {
      console.error('openapi.yaml is out of sync with the generated OpenAPI document.');
      console.error('Run npm run openapi:sync to refresh the root contract.');
      process.exit(1);
    }
    console.log('✓ openapi.yaml is in sync with the generated OpenAPI document');
  }
}

function isMainModule() {
  return process.argv[1] ? scriptPath === resolve(process.argv[1]) : false;
}

function loadRootOpenApiDocument() {
  return YAML.parse(readFileSync(rootOpenApiPath, 'utf8'));
}

function withOperationIds(doc) {
  const clone = deepClone(doc);
  for (const [path, pathItem] of Object.entries(clone.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (isHttpMethod(method) && operation && typeof operation === 'object') {
        operation.operationId = operationIdFor(method, path);
      }
    }
  }
  return clone;
}

function operationIdFor(method, path) {
  const override = operationIdOverrides[`${method.toUpperCase()} ${path}`];
  if (override) return override;
  return `${method}${path
    .split('/')
    .filter(Boolean)
    .map((part) => toPascalCase(part.replace(/[{}]/g, '')))
    .join('')}`;
}

function isHttpMethod(value) {
  return ['get', 'post', 'put', 'delete', 'patch'].includes(value);
}

function toPascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)]),
  );
}

function toYamlDocument(value) {
  return `${jsonToYaml(value).trimEnd()}\n`;
}

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
