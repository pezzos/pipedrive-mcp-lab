import { performance } from "node:perf_hooks";

import { buildServer } from "../dist/tools.js";

const warmupIterations = 20;
const measuredIterations = 200;
const p95LimitMs = 20;
const config = {
  baseUrl: "",
  baseUrlSource: "missing",
  allowMockBaseUrl: false,
  enableWrites: false,
  enableDeleteTools: false,
  enableMailboxTools: false,
  requestTimeoutMs: 10_000,
};

function measureConstruction() {
  const startedAt = performance.now();
  buildServer(config);
  return performance.now() - startedAt;
}

for (let index = 0; index < warmupIterations; index += 1) {
  measureConstruction();
}

const samples = Array.from({ length: measuredIterations }, measureConstruction).sort(
  (left, right) => left - right,
);
const p95Index = Math.ceil(samples.length * 0.95) - 1;
const p95Ms = samples[p95Index];
const meanMs = samples.reduce((total, sample) => total + sample, 0) / samples.length;

console.log(
  JSON.stringify({
    benchmark: "buildServer",
    warmup_iterations: warmupIterations,
    measured_iterations: measuredIterations,
    p95_limit_ms: p95LimitMs,
    p95_ms: Number(p95Ms.toFixed(3)),
    mean_ms: Number(meanMs.toFixed(3)),
    status: p95Ms <= p95LimitMs ? "pass" : "fail",
  }),
);

if (p95Ms > p95LimitMs) {
  process.exitCode = 1;
}
