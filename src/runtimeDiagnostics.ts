export type RuntimeEnvKeyPresence = {
  enableWrites: boolean;
  enableDeleteTools: boolean;
  enableMailboxTools: boolean;
  loadDotenv: boolean;
};

export type RuntimeEnvDiagnostics = {
  initialized: boolean;
  dotenvLoadingEnabled: boolean;
  dotenvLocalFilePresent: boolean;
  dotenvLoaded: boolean;
  dotenvLoadFailed: boolean;
  preexisting: RuntimeEnvKeyPresence;
  current: RuntimeEnvKeyPresence;
};

export function unavailableRuntimeEnvDiagnostics(): RuntimeEnvDiagnostics {
  const keys = {
    enableWrites: false,
    enableDeleteTools: false,
    enableMailboxTools: false,
    loadDotenv: false,
  };
  return {
    initialized: false,
    dotenvLoadingEnabled: false,
    dotenvLocalFilePresent: false,
    dotenvLoaded: false,
    dotenvLoadFailed: false,
    preexisting: { ...keys },
    current: { ...keys },
  };
}
