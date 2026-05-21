// Config Playwright per Filo (Electron).
// I test usano _electron.launch via fixtures/electron.js — questo file
// configura solo timeout/retries/output paths.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.(js|mjs)$/,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // 1 worker: Electron + globalShortcut non amano la concorrenza
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/.report' }]],
  use: {
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
});
