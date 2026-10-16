import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/health": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("node_modules/recharts") ? "charts" : undefined,
      },
    },
  },
});
