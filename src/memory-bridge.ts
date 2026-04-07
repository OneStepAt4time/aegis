import { existsSync, renameSync, writeFileSync, readFileSync } from "fs";
import { safeJsonParse } from './safe-json.js';

interface MemoryEntry {
  value: string;
  namespace: string;
  key: string;
  created_at: number;
  updated_at: number;
  expires_at?: number;
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.key !== 'string') return false;
  if (typeof entry.value !== 'string') return false;
  if (typeof entry.namespace !== 'string') return false;
  if (typeof entry.created_at !== 'number') return false;
  if (typeof entry.updated_at !== 'number') return false;
  if (entry.expires_at !== undefined && typeof entry.expires_at !== 'number') return false;
  return true;
}

const KEY_REGEX = /^(.+?)\/(.+)$/;
const MAX_KEY_LEN = 256;
const MAX_VALUE_SIZE = 100 * 1024; // 100KB

export class MemoryBridge {
  private store = new Map<string, MemoryEntry>();
  private persistPath: string | null = null;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistPath: string | null = null, private reaperIntervalMs = 60_000) {
    this.persistPath = persistPath;
  }

  set(key: string, value: string, ttlSeconds?: number): MemoryEntry {
    if (value.length > MAX_VALUE_SIZE) throw new Error("Value exceeds maximum size");
    const m = KEY_REGEX.exec(key);
    if (!m) throw new Error(`Invalid key format: must be namespace/key, got "${key}"`);
    const [, namespace, _keyName] = m;
    if (key.length > MAX_KEY_LEN) throw new Error("Key exceeds maximum length");
    const now = Date.now();
    const entry: MemoryEntry = {
      value, namespace, key,
      created_at: this.store.has(key) ? this.store.get(key)!.created_at : now,
      updated_at: now,
      expires_at: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
    };
    this.store.set(key, entry);
    this.scheduleSave();
    return entry;
  }

  get(key: string): MemoryEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires_at && Date.now() > entry.expires_at) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  list(prefix?: string): MemoryEntry[] {
    const now = Date.now();
    const entries = [...this.store.values()].filter(e =>
      !e.expires_at || now <= e.expires_at
    );
    if (!prefix) return entries;
    return entries.filter(e => e.key.startsWith(prefix));
  }

  resolveKeys(keys: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const k of keys) {
      const e = this.get(k);
      if (e) result.set(k, e.value);
    }
    return result;
  }

  async load(): Promise<void> {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    const parsed = safeJsonParse(readFileSync(this.persistPath, 'utf-8'), 'Memory bridge store');
    if (!parsed.ok) return;
    if (!Array.isArray(parsed.data)) return;
    for (const rawEntry of parsed.data) {
      if (!isMemoryEntry(rawEntry)) continue;
      this.store.set(rawEntry.key, rawEntry);
    }
  }

  async save(): Promise<void> {
    if (!this.persistPath) return;
    const entries = [...this.store.values()];
    const tmp = this.persistPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, this.persistPath);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.save();
    }, 1000);
  }

  startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, e] of this.store) {
        if (e.expires_at && now > e.expires_at) this.store.delete(k);
      }
    }, this.reaperIntervalMs);
  }

  stopReaper(): void {
    if (this.reaperTimer) { clearInterval(this.reaperTimer); this.reaperTimer = null; }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
  }
}
