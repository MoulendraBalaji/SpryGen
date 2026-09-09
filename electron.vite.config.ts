import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: "electron/main.ts",
        formats: ["es"]
      },
      outDir: "dist-electron",
      emptyOutDir: true,
      rollupOptions: {
        external: ["better-sqlite3", "keytar"]
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: "electron/preload.ts",
        formats: ["cjs"]
      },
      outDir: "dist-electron",
      emptyOutDir: false,
      rollupOptions: {
        output: {
          entryFileNames: "preload.cjs"
        }
      }
    }
  },
  renderer: {
    root: ".",
    build: {
      outDir: "dist",
      rollupOptions: {
        input: "index.html"
      }
    },
    plugins: [react()]
  }
});
