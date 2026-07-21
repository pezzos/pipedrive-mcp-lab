import assert from "node:assert/strict";
import test from "node:test";
import { boundedBody } from "../src/boundedBody.js";

test("bounded reader rejects declared and streamed overflow but accepts exact limit", async () => {
  await assert.rejects(() => boundedBody(new Response("x", { headers: { "content-length": "9" } }), 8), /body_too_large/);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBody(new Response(stream), 8), /body_too_large/);
  assert.equal(cancelled, true);
  assert.equal((await boundedBody(new Response(new Uint8Array(8)), 8)).byteLength, 8);
});
