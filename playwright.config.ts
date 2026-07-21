import { defineConfig } from "playwright/test";
import { existsSync } from "node:fs";

const executablePath = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find(existsSync);

export default defineConfig({
  testDir: "tests/browser",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    executablePath,
    headless: true,
    baseURL: "http://127.0.0.1:4173",
  },
  outputDir: "dist/ui-test-results",
  webServer: { command: "node --import tsx scripts/ui-browser-fixtures.ts", url: "http://127.0.0.1:4173", reuseExistingServer: false },
});
