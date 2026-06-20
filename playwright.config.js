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
  // La suite lancia+chiude Electron ~465 volte in serie (~11 min). Sotto questo
  // carico prolungato, una manciata di spec sensibili al timing falliscono in
  // modo NON deterministico (stile computato non ancora applicato, page chiusa
  // durante un evaluate, suggestion spellcheck lente): ogni spec passa quando
  // gira da sola, ma il blip cambia run-per-run. Con retries:0 un singolo blip
  // tingeva di rosso l'intera `npm test` delle routine cloud (falsi "main rotto",
  // feedback errati). Con 2 retry il blip occasionale viene assorbito al re-run,
  // mentre una regressione VERA continua a fallire tutti e 3 i tentativi → resta
  // rossa. I retry rigirano solo gli spec falliti, non l'intera suite.
  retries: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/.report' }]],
  use: {
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
});
