import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Frontend for the Peakly Mac app (Tauri). Reuses src/core and src/components from the web app. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Share the web app's static assets (logo) instead of duplicating them.
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  clearScreen: false,
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: { outDir: fileURLToPath(new URL("../dist-desktop", import.meta.url)), emptyOutDir: true, target: "safari16" },
});
