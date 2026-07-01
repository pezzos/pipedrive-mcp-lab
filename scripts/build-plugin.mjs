import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/plugin-server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["node:*"],
  banner: {
    js: 'import { createRequire as __pipedriveCreateRequire } from "node:module";\nconst require = __pipedriveCreateRequire(import.meta.url);',
  },
});
