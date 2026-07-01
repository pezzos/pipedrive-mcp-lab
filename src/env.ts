import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const runtimeEnvKeys = {
  enableWrites: "PIPEDRIVE_ENABLE_WRITES",
  requireLabPrefix: "PIPEDRIVE_REQUIRE_LAB_PREFIX",
  requireWriteConfirmation: "PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION",
  loadDotenv: "PIPEDRIVE_LOAD_DOTENV",
} as const;

type RuntimeEnvOptions = {
  packageDir?: string;
  env?: NodeJS.ProcessEnv;
};

type RuntimeEnvDiagnostics = {
  initialized: boolean;
  dotenvLoadingEnabled: boolean;
  dotenvLocalFilePresent: boolean;
  dotenvParentFilePresent: boolean;
  dotenvLoaded: boolean;
  preexisting: Record<keyof typeof runtimeEnvKeys, boolean>;
  current: Record<keyof typeof runtimeEnvKeys, boolean>;
};

let diagnostics: RuntimeEnvDiagnostics = {
  initialized: false,
  dotenvLoadingEnabled: process.env.PIPEDRIVE_LOAD_DOTENV?.toLowerCase() !== "false",
  dotenvLocalFilePresent: false,
  dotenvParentFilePresent: false,
  dotenvLoaded: false,
  preexisting: hasRuntimeEnvKeys(process.env),
  current: hasRuntimeEnvKeys(process.env),
};

export function loadRuntimeEnv(options: RuntimeEnvOptions = {}): void {
  const env = options.env ?? process.env;
  const preexisting = hasRuntimeEnvKeys(env);
  const dotenvLoadingEnabled = env.PIPEDRIVE_LOAD_DOTENV?.toLowerCase() !== "false";
  const packageDir = options.packageDir ?? defaultPackageDir();
  const localDotenv = resolve(packageDir, ".env");
  const parentDotenv = resolve(dirname(packageDir), ".env");
  const dotenvLocalFilePresent = existsSync(localDotenv);
  const dotenvParentFilePresent = existsSync(parentDotenv);

  diagnostics = {
    initialized: true,
    dotenvLoadingEnabled,
    dotenvLocalFilePresent,
    dotenvParentFilePresent,
    dotenvLoaded: false,
    preexisting,
    current: hasRuntimeEnvKeys(env),
  };

  if (env.PIPEDRIVE_LOAD_DOTENV?.toLowerCase() === "false") {
    return;
  }

  const paths = [];
  if (dotenvLocalFilePresent) {
    paths.push(localDotenv);
  }
  if (dotenvParentFilePresent) {
    paths.push(parentDotenv);
  }

  if (paths.length === 0) {
    return;
  }

  const result = loadDotenv({
    path: paths,
    override: false,
    quiet: true,
    processEnv: env,
  });
  if (result.error) {
    throw new Error(`Failed to load runtime .env file: ${formatError(result.error)}`);
  }
  diagnostics = {
    ...diagnostics,
    dotenvLoaded: true,
    current: hasRuntimeEnvKeys(env),
  };
}

export function getRuntimeEnvDiagnostics(): RuntimeEnvDiagnostics {
  return {
    ...diagnostics,
    preexisting: { ...diagnostics.preexisting },
    current: { ...diagnostics.current },
  };
}

function defaultPackageDir(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasRuntimeEnvKeys(env: NodeJS.ProcessEnv): Record<keyof typeof runtimeEnvKeys, boolean> {
  return {
    enableWrites: hasRuntimeEnvKey(env, runtimeEnvKeys.enableWrites),
    requireLabPrefix: hasRuntimeEnvKey(env, runtimeEnvKeys.requireLabPrefix),
    requireWriteConfirmation: hasRuntimeEnvKey(env, runtimeEnvKeys.requireWriteConfirmation),
    loadDotenv: hasRuntimeEnvKey(env, runtimeEnvKeys.loadDotenv),
  };
}

function hasRuntimeEnvKey(env: NodeJS.ProcessEnv, key: string) {
  return Object.prototype.hasOwnProperty.call(env, key);
}
