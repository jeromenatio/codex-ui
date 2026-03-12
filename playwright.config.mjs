import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT ?? 4180);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    launchOptions: {
      args: ["--no-sandbox"]
    },
    viewport: {
      width: 1024,
      height: 1366
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium"
      }
    }
  ],
  webServer: {
    command: `PORT=${port} npm start`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000
  }
});
