// @ts-check
import fs from 'fs';
import path from 'path';
import { defineConfig } from '@playwright/test';

const envExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  process.env.CHROMIUM_PATH;

const browserCacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || './.cache/ms-playwright';
let cachedExecutable;

if (!envExecutable) {
  try {
    const cacheEntries = fs.readdirSync(browserCacheRoot, { withFileTypes: true });
    for (const entry of cacheEntries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(browserCacheRoot, entry.name, 'chrome-linux', 'chrome');
      if (fs.existsSync(candidate)) {
        cachedExecutable = candidate;
        break;
      }
    }
  } catch {
    // Cache location not present or unreadable; fall back to default Playwright behavior.
  }
}

const useOptions = {
  baseURL: 'http://127.0.0.1:4173',
  headless: true,
};

if (envExecutable || cachedExecutable) {
  useOptions.browserName = 'chromium';
  useOptions.channel = undefined;
  useOptions.executablePath = envExecutable || cachedExecutable;
  useOptions.launchOptions = { args: ['--no-sandbox'] };
}

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev -- --host --port 4173',
    port: 4173,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
  use: useOptions,
});
