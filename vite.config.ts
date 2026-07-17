import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // The same dist/ directory also contains the packaged daemon and MCP
    // adapter. Extension-only rebuilds must not delete those Node entrypoints.
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        background: resolve(__dirname, "src/background/index.ts")
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            if (id.includes("/src/shared/")) {
              return "shared";
            }
            return undefined;
          }

          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }

          if (id.includes("/@ant-design/icons/")) {
            return "vendor-icons";
          }

          if (id.includes("/@ant-design/icons-svg/")) {
            return "vendor-icons";
          }

          if (id.includes("/@ant-design/colors/")) {
            return "vendor-icons";
          }

          return undefined;
        },
        entryFileNames: (chunk) => {
          if (chunk.name === "background") {
            return "assets/background.js";
          }

          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
