type BodySource = Pick<Response, "headers" | "body">;
export async function boundedBody(response: BodySource, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new Error("body_too_large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximum) { await reader.cancel(); throw new Error("body_too_large"); } parts.push(next.value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.byteLength; } return result;
}
export async function boundedText(response: BodySource, maximum: number): Promise<string> { return new TextDecoder().decode(await boundedBody(response, maximum)); }
