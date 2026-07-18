const OBJECT_KEY_VERSION = "lp1";
const MAX_COMPONENT_BYTES = 1_024;
const MAX_KEY_BYTES = 4_096;

/**
 * Encodes a namespace and its components without delimiter collisions.
 * Lengths are UTF-8 byte lengths so the encoding is stable for non-ASCII input.
 */
export function lengthPrefixedObjectKey(
  namespace: string,
  ...components: string[]
): string {
  const values = [namespace, ...components];
  if (values.length > 16) {
    throw new Error("object_key_invalid");
  }

  const encoded = values.map((value) => {
    if (typeof value !== "string") {
      throw new Error("object_key_invalid");
    }
    const length = utf8Length(value);
    if (length === 0 || length > MAX_COMPONENT_BYTES) {
      throw new Error("object_key_invalid");
    }
    return `${length}:${value}`;
  });
  const key = `${OBJECT_KEY_VERSION}:${values.length}:${encoded.join("")}`;
  if (utf8Length(key) > MAX_KEY_BYTES) {
    throw new Error("object_key_invalid");
  }
  return key;
}

export function userConnectionObjectKey(accessSub: string): string {
  return lengthPrefixedObjectKey("pipedrive-user-connection", accessSub);
}

export function userCompanyPolicyObjectKey(
  accessSub: string,
  companyId: string,
): string {
  return lengthPrefixedObjectKey("pipedrive-user-company-policy", accessSub, companyId);
}

export function tenantRegistryObjectKey(): string {
  return lengthPrefixedObjectKey("pipedrive-tenant-registry", "global");
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
