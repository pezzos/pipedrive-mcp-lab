import { boundedText } from "../boundedBody.js";
const MAX_JWT_LENGTH = 16_384;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_JWKS_TTL_MS = 5 * 60_000;

type AccessJwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type AccessJwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  sub?: unknown;
  email?: unknown;
};

type JsonWebKeySet = {
  keys?: AccessJsonWebKey[];
};

type AccessJsonWebKey = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type CachedJwks = {
  expiresAt: number;
  keys: AccessJsonWebKey[];
};

export type AccessIdentity = {
  sub: string;
  email: string;
};

export type AccessVerifierConfig = {
  issuer: string;
  audience: string;
  previous?: { issuer: string; audience: string; validUntilMs: number };
  now?: () => number;
  fetcher?: typeof fetch;
  clockSkewSeconds?: number;
  jwksTtlMs?: number;
};

const jwksCache = new Map<string, CachedJwks>();

export function clearAccessJwksCache(): void {
  jwksCache.clear();
}

export async function verifyAccessRequest(
  request: Request,
  config: AccessVerifierConfig,
): Promise<AccessIdentity> {
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) {
    throw new Error("access_token_missing");
  }
  return verifyAccessJwt(assertion, config);
}

export async function verifyAccessJwt(
  assertion: string,
  config: AccessVerifierConfig,
): Promise<AccessIdentity> {
  if (assertion.length === 0 || assertion.length > MAX_JWT_LENGTH) {
    throw new Error("access_token_invalid");
  }

  const parts = assertion.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error("access_token_invalid");
  }

  const header = parseJsonPart<AccessJwtHeader>(parts[0]);
  const claims = parseJsonPart<AccessJwtClaims>(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
    throw new Error("access_token_invalid");
  }

  const issuer = normalizeIssuer(config.issuer);
  const nowSeconds = Math.floor((config.now?.() ?? Date.now()) / 1000);
  const skew = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const previous = config.previous && (config.now?.() ?? Date.now()) < config.previous.validUntilMs
    ? { issuer: normalizeIssuer(config.previous.issuer), audience: config.previous.audience }
    : undefined;
  const selected = selectAccessPair(claims, { issuer, audience: config.audience }, previous);
  validateClaims(claims, selected.issuer, selected.audience, nowSeconds, skew);

  const key = await findVerificationKey(header.kid, selected.issuer, config, false);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) {
    throw new Error("access_token_invalid");
  }

  return {
    sub: claims.sub as string,
    email: normalizeEmail(claims.email),
  };
}

function selectAccessPair(
  claims: AccessJwtClaims,
  current: { issuer: string; audience: string },
  previous: { issuer: string; audience: string } | undefined,
): { issuer: string; audience: string } {
  const audiences = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
  if (claims.iss === current.issuer && audiences.includes(current.audience)) return current;
  if (previous && claims.iss === previous.issuer && audiences.includes(previous.audience)) return previous;
  throw new Error("access_token_invalid");
}

function validateClaims(
  claims: AccessJwtClaims,
  issuer: string,
  audience: string,
  now: number,
  skew: number,
): void {
  const audiences =
    typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud) && claims.aud.every((item) => typeof item === "string")
        ? claims.aud
        : [];
  if (claims.iss !== issuer || !audiences.includes(audience)) {
    throw new Error("access_token_invalid");
  }
  if (
    !Number.isInteger(claims.exp) ||
    !Number.isInteger(claims.iat) ||
    (claims.nbf !== undefined && !Number.isInteger(claims.nbf)) ||
    (claims.exp as number) <= now - skew ||
    (claims.iat as number) > now + skew ||
    (claims.nbf !== undefined && (claims.nbf as number) > now + skew)
  ) {
    throw new Error("access_token_invalid");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 256) {
    throw new Error("access_token_invalid");
  }
  normalizeEmail(claims.email);
}

async function findVerificationKey(
  kid: string,
  issuer: string,
  config: AccessVerifierConfig,
  forceRefresh: boolean,
): Promise<CryptoKey> {
  const now = config.now?.() ?? Date.now();
  let cached = jwksCache.get(issuer);
  if (forceRefresh || !cached || cached.expiresAt <= now) {
    const response = await (config.fetcher ?? fetch)(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) {
      throw new Error("access_jwks_unavailable");
    }
    let parsed: JsonWebKeySet;
    try { parsed = JSON.parse(await boundedText(response, 64 * 1024)) as JsonWebKeySet; } catch { throw new Error("access_jwks_invalid"); }
    if (!Array.isArray(parsed.keys)) {
      throw new Error("access_jwks_invalid");
    }
    cached = {
      expiresAt: now + (config.jwksTtlMs ?? DEFAULT_JWKS_TTL_MS),
      keys: parsed.keys,
    };
    jwksCache.set(issuer, cached);
  }

  const jwk = cached.keys.find((candidate) =>
    candidate.kid === kid && candidate.kty === "RSA" && candidate.alg === "RS256",
  );
  if (!jwk) {
    if (!forceRefresh) {
      return findVerificationKey(kid, issuer, config, true);
    }
    throw new Error("access_token_invalid");
  }

  try {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("access_jwks_invalid");
  }
}

function parseJsonPart<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
  } catch {
    throw new Error("access_token_invalid");
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("access_token_invalid");
  }
}

function normalizeIssuer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("access_configuration_invalid");
  }
  return url.origin;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("access_token_invalid");
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !email.includes("@")) {
    throw new Error("access_token_invalid");
  }
  return email;
}
