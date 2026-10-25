import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// El escritorio corre en :5173 y habla con el core en :4000.
// En produccion el core puede servir el bundle generado en dist/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolver @wtm/shared directo al codigo fuente, sin depender del
      // symlink de workspaces (que es fragil en Windows / unidades de red).
      "@wtm/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
  },
});
