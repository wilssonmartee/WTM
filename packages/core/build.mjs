// Build del core con esbuild.
//
// Empaqueta @wtm/shared (TypeScript puro, sin dependencias) DENTRO del bundle,
// para que el core no dependa del enlace simbolico de workspaces en tiempo de
// ejecucion (ese symlink es fragil en Windows y en unidades de red).
//
// Las dependencias de node/nativas se dejan como externas: better-sqlite3
// tiene binarios nativos y no se puede empaquetar; el resto se resuelve desde
// node_modules normalmente.
import { build } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// Externalizamos todas las dependencias declaradas EXCEPTO @wtm/shared,
// que si queremos incrustar en el bundle.
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (d) => d !== "@wtm/shared",
);

// Dependencias de MODULOS instaladas dinamicamente (ref-counting). No estan en
// package.json al compilar, pero los modulos las importan con import() en
// runtime. Las marcamos external para que esbuild no intente resolverlas aqui.
const MODULE_DEPS_EXTERNAL = ["@marsaud/smb2"];
for (const d of MODULE_DEPS_EXTERNAL) {
  if (!external.includes(d)) external.push(d);
}

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/index.js",
  external,
  banner: {
    // Shim para que __dirname / require funcionen en ESM bundlado.
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

console.log("[core] bundle generado en dist/index.js");
