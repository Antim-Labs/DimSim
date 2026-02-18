import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@sparkjsdev/spark", "@dimforge/rapier3d-compat"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    proxy: {
      "/vlm": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
