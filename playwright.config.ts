import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for the payment widget. The Rift API is mocked per test with
 * page.route, so no backend is needed, and tests run against a production
 * build served by `vite preview` — the dev server compiles on first request
 * and made early tests timing-dependent in the console repo.
 */
const PORT = Number(process.env.PW_PORT ?? 5273);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
