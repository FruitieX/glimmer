import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The CSP allows fonts and images only from the app itself, not data: URLs.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 3110,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3111", ws: true },
      "/auth": "http://127.0.0.1:3111",
    },
  },
});
