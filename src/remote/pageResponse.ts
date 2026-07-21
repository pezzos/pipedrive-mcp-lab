/** Shared security envelope for every server-rendered local page. */
export function htmlResponse(body: string, status = 200, nonce?: string): Response {
  return new Response(body, { status, headers: pageHeaders(nonce) });
}

export function noStoreRedirect(url: URL | string, status: 302 | 303 = 303): Response {
  const headers = pageHeaders();
  headers.set("location", String(url));
  return new Response(null, { status, headers });
}

function pageHeaders(nonce?: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; style-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });
}
