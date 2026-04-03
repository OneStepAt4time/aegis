/**
 * template-store.ts — Session template persistence.
 *
 * Manages saving, loading, and listing session templates.
 * Templates are stored in ~/.config/aegis/templates.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface SessionTemplate {
  id: string;
  name: string;
  description?: string;
  workDir: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: 'default' | 'bypassPermissions' | 'plan' | 'acceptEdits' | 'dontAsk' | 'auto';
  autoApprove?: boolean;
  parentId?: string;
  memoryKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TemplateStore {
  templates: Record<string, SessionTemplate>;
}

const CONFIG_DIR = join(homedir(), '.config', 'aegis');
const TEMPLATES_FILE = join(CONFIG_DIR, 'templates.json');

let cachedTemplates: Record<string, SessionTemplate> = {};
let loaded = false;

/**
 * Load templates from disk, or initialize empty store.
 */
async function loadTemplates(): Promise<Record<string, SessionTemplate>> {
  if (loaded) return cachedTemplates;

  try {
    if (existsSync(TEMPLATES_FILE)) {
      const content = await readFile(TEMPLATES_FILE, 'utf-8');
      const store = JSON.parse(content) as TemplateStore;
      cachedTemplates = store.templates || {};
    } else {
      cachedTemplates = {};
    }
  } catch (err) {
    console.error(`Failed to load templates from ${TEMPLATES_FILE}:`, err);
    cachedTemplates = {};
  }

  loaded = true;
  return cachedTemplates;
}

/**
 * Persist templates to disk.
 */
async function saveTemplates(): Promise<void> {
  try {
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }
    const store: TemplateStore = { templates: cachedTemplates };
    await writeFile(TEMPLATES_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error(`Failed to save templates to ${TEMPLATES_FILE}:`, err);
    throw err;
  }
}

/**
 * Create a new template from session parameters.
 */
export async function createTemplate(input: Omit<SessionTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionTemplate> {
  await loadTemplates();

  const template: SessionTemplate = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  cachedTemplates[template.id] = template;
  await saveTemplates();

  return template;
}

/**
 * Get a template by ID.
 */
export async function getTemplate(id: string): Promise<SessionTemplate | null> {
  await loadTemplates();
  return cachedTemplates[id] ?? null;
}

/**
 * List all templates.
 */
export async function listTemplates(): Promise<SessionTemplate[]> {
  await loadTemplates();
  return Object.values(cachedTemplates).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Update a template.
 */
export async function updateTemplate(id: string, updates: Partial<Omit<SessionTemplate, 'id' | 'createdAt'>>): Promise<SessionTemplate | null> {
  await loadTemplates();

  const template = cachedTemplates[id];
  if (!template) return null;

  const updated: SessionTemplate = {
    ...template,
    ...updates,
    id: template.id,
    createdAt: template.createdAt,
    updatedAt: Date.now(),
  };

  cachedTemplates[id] = updated;
  await saveTemplates();

  return updated;
}

/**
 * Delete a template.
 */
export async function deleteTemplate(id: string): Promise<boolean> {
  await loadTemplates();

  if (!cachedTemplates[id]) return false;

  delete cachedTemplates[id];
  await saveTemplates();

  return true;
}
