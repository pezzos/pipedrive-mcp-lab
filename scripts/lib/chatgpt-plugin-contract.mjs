import { readFileSync } from "node:fs";

export const CHATGPT_PLUGIN_SLUG = "pipedrive-sandbox";
export const CHATGPT_PLUGIN_NAME = "Pipedrive Sandbox";
export const CHATGPT_PLUGIN_DESCRIPTION = "Private sandbox for seven controlled Pipedrive workflows. Read-only by default.";
export const CHATGPT_MCP_URL = "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp";
export const CHATGPT_REMOTE_PLUGIN_ID = "plugin_asdk_app_6a5f066a2b788191b7694a13343b6da0";
export const CHATGPT_APP_ID = "asdk_app_6a5f066a2b788191b7694a13343b6da0";
export const CHATGPT_SKILLS = [
  "pipedrive-add-activity",
  "pipedrive-add-note",
  "pipedrive-complete-activity",
  "pipedrive-dictation-aliases",
  "pipedrive-email-activity",
  "pipedrive-next-action",
  "pipedrive-update-record",
];

const remotePluginIdPattern = /^plugin_asdk_app_[A-Za-z0-9_-]+$/;
const appIdPattern = /^asdk_app_[A-Za-z0-9_-]+$/;
const forbiddenReferencePattern = /(?:placeholder|fake|todo|connector|process\.env|\benv\b)/i;

export function loadChatgptPluginSource(path) {
  return validateChatgptPluginSource(JSON.parse(readFileSync(path, "utf8")));
}

export function validateChatgptPluginSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("ChatGPT plugin source must be an object");
  }
  const requiredStrings = {
    name: CHATGPT_PLUGIN_NAME,
    description: CHATGPT_PLUGIN_DESCRIPTION,
    mcp_url: CHATGPT_MCP_URL,
    remote_plugin_id: CHATGPT_REMOTE_PLUGIN_ID,
    app_id: CHATGPT_APP_ID,
  };
  for (const [key, expected] of Object.entries(requiredStrings)) {
    if (source[key] !== expected) {
      throw new Error(`ChatGPT plugin source ${key} must equal the frozen contract`);
    }
  }
  if (!remotePluginIdPattern.test(source.remote_plugin_id) || forbiddenReferencePattern.test(source.remote_plugin_id)) {
    throw new Error("ChatGPT plugin source remote_plugin_id must be a real plugin_asdk_app install ID");
  }
  if (!appIdPattern.test(source.app_id) || forbiddenReferencePattern.test(source.app_id)) {
    throw new Error("ChatGPT plugin source app_id must be a real asdk_app resource ID");
  }
  if (source.required !== true) {
    throw new Error("ChatGPT plugin source must require the Pipedrive Sandbox app");
  }
  const listing = source.listing;
  if (!listing || listing.private !== true || listing.visual !== "Controlled Pipeline") {
    throw new Error("ChatGPT plugin listing must remain a private Controlled Pipeline listing");
  }
  if (JSON.stringify(listing.safety_labels) !== JSON.stringify(["Private sandbox", "Read-only by default"])) {
    throw new Error("ChatGPT plugin safety labels must preserve their frozen order");
  }
  if (!Array.isArray(listing.starter_prompts) || listing.starter_prompts.length !== 3 || listing.starter_prompts.some((prompt) => typeof prompt !== "string" || !prompt.trim())) {
    throw new Error("ChatGPT plugin listing must contain exactly three starter prompts");
  }
  if (!source.marketplace || source.marketplace.name !== CHATGPT_PLUGIN_SLUG || typeof source.marketplace.description !== "string") {
    throw new Error("ChatGPT plugin marketplace metadata is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(source, "version")) {
    throw new Error("ChatGPT plugin version belongs only in package.json");
  }
  return source;
}

export function expectedAppManifest(source) {
  return { apps: { [CHATGPT_PLUGIN_SLUG]: { id: source.app_id, required: true } } };
}
