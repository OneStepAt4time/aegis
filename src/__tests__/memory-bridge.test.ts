import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryBridge } from "../memory-bridge.js";
import { existsSync, unlinkSync, writeFileSync } from "fs";

describe("MemoryBridge", () => {
  const tmpPath = "/tmp/aegis-memory-test.json";
  let bridge: MemoryBridge;

  beforeEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    bridge = new MemoryBridge(tmpPath);
  });

  afterEach(() => {
    bridge.stopReaper();
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it("stores and retrieves a value", () => {
    const entry = bridge.set("session/test/key", "hello world");
    expect(entry.value).toBe("hello world");
    expect(entry.namespace).toBe("session");
    expect(entry.key).toBe("session/test/key");
    const retrieved = bridge.get("session/test/key");
    expect(retrieved?.value).toBe("hello world");
  });

  it("returns null for missing key", () => {
    expect(bridge.get("session/missing")).toBeNull();
  });

  it("overwrites existing key preserving created_at", async () => {
    const e1 = bridge.set("ns/k", "v1");
    await new Promise(r => setTimeout(r, 1));
    const e2 = bridge.set("ns/k", "v2");
    expect(e2.value).toBe("v2");
    expect(e2.created_at).toBe(e1.created_at);
    expect(e2.updated_at).toBeGreaterThanOrEqual(e1.updated_at);
  });

  it("deletes a key", () => {
    bridge.set("ns/k", "v");
    expect(bridge.delete("ns/k")).toBe(true);
    expect(bridge.get("ns/k")).toBeNull();
    expect(bridge.delete("ns/k")).toBe(false);
  });

  it("lists all entries", () => {
    bridge.set("ns1/k1", "v1");
    bridge.set("ns2/k2", "v2");
    const entries = bridge.list();
    expect(entries).toHaveLength(2);
  });

  it("lists entries by prefix", () => {
    bridge.set("ns1/k1", "v1");
    bridge.set("ns1/k2", "v2");
    bridge.set("ns2/k1", "v3");
    const filtered = bridge.list("ns1/");
    expect(filtered).toHaveLength(2);
    expect(filtered.map(e => e.value).sort()).toEqual(["v1", "v2"]);
  });

  it("respects TTL expiry", async () => {
    const b = new MemoryBridge(null);
    b.set("ns/k", "v", 1); // 1 second TTL
    expect(b.get("ns/k")?.value).toBe("v");
    await new Promise(r => setTimeout(r, 1100));
    expect(b.get("ns/k")).toBeNull();
  });

  it("rejects invalid key format", () => {
    expect(() => bridge.set("invalid-no-separator", "v")).toThrow();
    // multiple slashes allowed: first / splits namespace, rest is key
    expect(() => bridge.set("", "v")).toThrow();
  });

  it("rejects value exceeding max size", () => {
    const huge = "x".repeat(100 * 1024 + 1);
    expect(() => bridge.set("ns/k", huge)).toThrow("Value exceeds maximum size");
  });

  it("resolves keys", () => {
    bridge.set("ns/k1", "v1");
    bridge.set("ns/k2", "v2");
    const resolved = bridge.resolveKeys(["ns/k1", "ns/k2", "ns/missing"]);
    expect(resolved.get("ns/k1")).toBe("v1");
    expect(resolved.get("ns/k2")).toBe("v2");
    expect(resolved.has("ns/missing")).toBe(false);
  });

  it("persists to disk", async () => {
    bridge.set("ns/k", "v");
    await bridge.save();
    const bridge2 = new MemoryBridge(tmpPath);
    await bridge2.load();
    expect(bridge2.get("ns/k")?.value).toBe("v");
  });

  it("ignores malformed persisted JSON", async () => {
    writeFileSync(tmpPath, '{not-json');

    await bridge.load();

    expect(bridge.list()).toEqual([]);
  });

  it("ignores persisted entries with invalid structure", async () => {
    writeFileSync(tmpPath, JSON.stringify([
      { key: 'ok/key', value: 'v', namespace: 'ok', created_at: 1, updated_at: 2 },
      { key: 'bad/key', value: 123, namespace: 'bad', created_at: 1, updated_at: 2 },
      { key: 99, value: 'v', namespace: 'bad', created_at: 1, updated_at: 2 },
    ]));

    await bridge.load();

    expect(bridge.get('ok/key')?.value).toBe('v');
    expect(bridge.get('bad/key')).toBeNull();
    expect(bridge.list()).toHaveLength(1);
  });
});
