import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python apps/web/e2e/start_backend.py",
      cwd: root,
      url: "http://127.0.0.1:8010/ready",
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      cwd: fileURLToPath(new URL("./", import.meta.url)),
      env: { API_PROXY_TARGET: "http://127.0.0.1:8010" },
      url: "http://127.0.0.1:5174",
      timeout: 60_000,
    },
  ],
});
