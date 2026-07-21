import assert from "node:assert/strict";
import test from "node:test";
import { TenantRegistryCore } from "../src/remote/tenantRegistry.js";

class Storage {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { return this.values.delete(key); }
  async transaction<T>(fn: (tx: Storage) => Promise<T>) { return fn(this); }
}
const id = (char: string) => char.repeat(16);
const request = (kind: "protected" | "mcp" | "tool", user = id("u"), tenant = id("t")) => ({ kind, ip: id("i"), user, ...(kind === "tool" ? { tenant } : {}) });

test("capacity enforces fixed windows and hides dimensions", async () => {
  let now = Date.UTC(2026, 6, 21);
  const core = new TenantRegistryCore(new Storage() as any, { now: () => now, randomOpaqueId: () => id("l") });
  for (let i = 0; i < 120; i++) assert.equal((await core.acquireCapacity(request("protected"))).admitted, true);
  const denied = await core.acquireCapacity(request("protected"));
  assert.deepEqual(denied, { admitted: false, code: "remote_rate_limited", retryAfter: 60 });
  now += 60_000; assert.equal((await core.acquireCapacity(request("protected"))).admitted, true);
  await assert.rejects(() => core.acquireCapacity({ ...request("mcp"), user: "raw" }), /tenant_registry_request_invalid/);
});

test("capacity daily rollovers and leases are bounded and idempotent", async () => {
  let now = Date.UTC(2026, 6, 21, 12);
  let sequence = 0;
  const core = new TenantRegistryCore(new Storage() as any, { now: () => now, randomOpaqueId: () => `${id("l").slice(0, 15)}${sequence++}` });
  const first = await core.acquireCapacity(request("tool")); assert.equal(first.admitted, true); assert.ok(first.lease);
  const second = await core.acquireCapacity(request("tool")); assert.equal(second.admitted, true);
  assert.equal((await core.acquireCapacity(request("tool"))).code, "remote_service_busy");
  await core.releaseCapacity(first.lease); await core.releaseCapacity(first.lease);
  assert.equal((await core.acquireCapacity(request("tool"))).admitted, true);
  now += 15_001; assert.equal((await core.acquireCapacity(request("tool"))).admitted, true);
});

test("capacity covers MCP, tool, tenant, global and daily dimensions", async () => {
  let now = Date.UTC(2026, 6, 21, 12);
  let sequence = 0;
  const core = new TenantRegistryCore(new Storage() as any, { now: () => now, randomOpaqueId: () => `${id("l").slice(0, 12)}${String(sequence++).padStart(4, "0")}` });
  for (let i = 0; i < 60; i++) assert.equal((await core.acquireCapacity(request("mcp", id("m")))).admitted, true);
  assert.equal((await core.acquireCapacity(request("mcp", id("m")))).code, "remote_rate_limited");
  now += 60_000;
  for (let i = 0; i < 20; i++) { const result = await core.acquireCapacity(request("tool", id("x"))); await core.releaseCapacity(result.lease); }
  assert.equal((await core.acquireCapacity(request("tool", id("x")))).code, "remote_rate_limited");
  now += 60_000;
  for (let i = 0; i < 60; i++) { const result = await core.acquireCapacity(request("tool", `${id("u").slice(0, 15)}${i % 10}`, id("t"))); await core.releaseCapacity(result.lease); }
  assert.equal((await core.acquireCapacity(request("tool", id("z"), id("t")))).code, "remote_rate_limited");
  now += 60_000;
  for (let i = 0; i < 120; i++) { const r = await core.acquireCapacity({ kind: "tool", ip: `${id("i").slice(0, 13)}${String(i).padStart(3, "0")}`, user: `${id("p").slice(0, 13)}${String(i).padStart(3, "0")}`, tenant: `${id("q").slice(0, 13)}${String(i).padStart(3, "0")}` }); await core.releaseCapacity(r.lease); }
  assert.equal((await core.acquireCapacity({ kind: "tool", ip: id("g"), user: id("g"), tenant: id("g") })).code, "remote_rate_limited");
});

test("capacity warns at 800, caps at 1000, rolls UTC day, and leases tenant/global", async () => {
  let now = Date.UTC(2026, 6, 21, 12);
  let sequence = 0;
  const core = new TenantRegistryCore(new Storage() as any, { now: () => now, randomOpaqueId: () => `${id("l").slice(0, 12)}${String(sequence++).padStart(4, "0")}` });
  for (let i = 0; i < 799; i++) { if (i > 0 && i % 120 === 0) now += 60_000; const r = await core.acquireCapacity({ kind: "tool", ip: `${id("i").slice(0, 13)}${String(i).padStart(3, "0")}`, user: `${id("u").slice(0, 13)}${String(i).padStart(3, "0")}`, tenant: `${id("t").slice(0, 13)}${String(i).padStart(3, "0")}` }); await core.releaseCapacity(r.lease); }
  const warning = await core.acquireCapacity({ kind: "tool", ip: id("w"), user: id("w"), tenant: id("w") }); assert.equal(warning.admitted, true, JSON.stringify(warning)); assert.equal(warning.warning, true, JSON.stringify(warning)); await core.releaseCapacity(warning.lease);
  for (let i = 800; i < 1000; i++) { if (i % 120 === 0) now += 60_000; const r = await core.acquireCapacity({ kind: "tool", ip: `${id("i").slice(0, 13)}${String(i).padStart(3, "0")}`, user: `${id("u").slice(0, 13)}${String(i).padStart(3, "0")}`, tenant: `${id("t").slice(0, 13)}${String(i).padStart(3, "0")}` }); assert.equal(r.admitted, true); await core.releaseCapacity(r.lease); }
  assert.equal((await core.acquireCapacity({ kind: "tool", ip: id("h"), user: id("h"), tenant: id("h") })).code, "pilot_daily_capacity_exceeded");
  // Move the clock across the UTC boundary: the daily budget resets.
  now = Date.UTC(2026, 6, 22); const reset = await core.acquireCapacity(request("tool")); assert.equal(reset.admitted, true); assert.ok(reset.lease); await core.releaseCapacity(reset.lease);
  // Tenant and global lease ceilings use distinct opaque users/tenants.
  const tenant = id("q"); const leases = [] as string[];
  for (let i = 0; i < 4; i++) { const r = await core.acquireCapacity({ kind: "tool", ip: `${id("a").slice(0, 15)}${i}`, user: `${id("b").slice(0, 15)}${i}`, tenant }); assert.equal(r.admitted, true); assert.ok(r.lease); leases.push(r.lease); }
  assert.equal((await core.acquireCapacity({ kind: "tool", ip: id("c"), user: id("c"), tenant })).code, "remote_service_busy");
  for (const lease of leases) await core.releaseCapacity(lease);
  const global: string[] = [];
  for (let i = 0; i < 8; i++) { const r = await core.acquireCapacity({ kind: "tool", ip: `${id("d").slice(0, 15)}${i}`, user: `${id("e").slice(0, 15)}${i}`, tenant: `${id("f").slice(0, 15)}${i}` }); assert.equal(r.admitted, true); assert.ok(r.lease); global.push(r.lease); }
  assert.equal((await core.acquireCapacity({ kind: "tool", ip: id("x"), user: id("x"), tenant: id("x") })).code, "remote_service_busy");
  for (const lease of global) await core.releaseCapacity(lease);
});

test("capacity persists only intended dimensions and prunes stale windows", async () => {
  let now = Date.UTC(2026, 6, 21, 12); const storage = new Storage(); const core = new TenantRegistryCore(storage as any, { now: () => now, randomOpaqueId: () => id("l") });
  await core.acquireCapacity(request("protected")); await core.acquireCapacity(request("mcp")); const tool = await core.acquireCapacity(request("tool")); await core.releaseCapacity(tool.lease);
  const state = storage.values.get("capacity:v1") as any; assert.deepEqual(Object.keys(state.windows).sort(), [`global`, `ip:${id("i")}`, `mcp:${id("u")}`, `tool-tenant:${id("t")}`, `tool-user:${id("u")}`].sort());
  now += 60_000; await core.acquireCapacity({ kind: "protected", ip: id("z"), user: id("z") }); assert.deepEqual(Object.keys((storage.values.get("capacity:v1") as any).windows), [`ip:${id("z")}`]);
});

test("capacity refuses malformed persisted state without overwriting it", async () => {
  const storage = new Storage(); storage.values.set("capacity:v1", { windows: { bad: { start: 0, count: 0 } }, daily: { day: "bad", count: -1 }, leases: {} });
  const core = new TenantRegistryCore(storage as any); await assert.rejects(() => core.acquireCapacity(request("protected")), /tenant_registry_internal_error/);
  assert.equal((storage.values.get("capacity:v1") as any).daily.day, "bad");
});

test("capacity refuses new dimensions once the current window map is full", async () => {
  const now = Date.UTC(2026, 6, 21, 12); const storage = new Storage(); const windows: Record<string, { start: number; count: number }> = {};
  for (let i = 0; i < 256; i++) windows[`ip:${`${id("x").slice(0, 13)}${String(i).padStart(3, "0")}`}`] = { start: now, count: 1 };
  storage.values.set("capacity:v1", { windows, daily: { day: "2026-07-21", count: 0 }, leases: {} });
  const core = new TenantRegistryCore(storage as any, { now: () => now }); const result = await core.acquireCapacity({ kind: "protected", ip: id("z"), user: id("u") });
  assert.deepEqual(result, { admitted: false, code: "remote_service_busy", retryAfter: 1 }); assert.equal(Object.keys((storage.values.get("capacity:v1") as any).windows).length, 256); assert.equal((storage.values.get("capacity:v1") as any).windows[`ip:${id("z")}`], undefined);
});
