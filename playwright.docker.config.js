// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Use the Go server that serves the built SPA
  use: {
    baseURL: 'http://host.docker.internal:8080',
    headless: true,
  },
});
