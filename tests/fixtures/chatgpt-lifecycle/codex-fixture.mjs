import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROFILE_FIXTURE_FORMAT = "pipedrive-chatgpt-profile-fixture-v1";

export function applyProfileFixture(profileRoot, fixture) {
  if (fixture.format !== PROFILE_FIXTURE_FORMAT || fixture.schema_version !== 1 || !Array.isArray(fixture.files)) {
    throw new Error("Invalid ChatGPT lifecycle profile fixture");
  }
  for (const file of fixture.files) {
    if (!file.path || file.path.startsWith("/") || file.path.includes("..")) throw new Error("Fixture path escapes the generated profile");
    const target = join(profileRoot, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.content, { mode: Number.parseInt(file.mode, 8) });
    chmodSync(target, Number.parseInt(file.mode, 8));
  }
  return fixture;
}
