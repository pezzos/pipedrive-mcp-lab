const pipedriveHostname = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*pipedrive\.com$/i;

export function normalizePipedriveApiDomain(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new Error("invalid_pipedrive_api_domain");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_pipedrive_api_domain");
  }

  const hasUnexpectedPort = url.port !== "" && url.port !== "443";
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    hasUnexpectedPort ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !pipedriveHostname.test(url.hostname)
  ) {
    throw new Error("invalid_pipedrive_api_domain");
  }

  return `https://${url.hostname.toLowerCase()}`;
}
