import { defineConfig } from "@playwright/test";

// Run a separate local app with synthetic credentials; never reuse a logged-in server.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 390, height: 844 },
    actionTimeout: 10_000,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4319",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser_regression_fixture",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "browser-regression-fixture",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
