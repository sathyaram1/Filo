// Config Playwright per Filo (Electron).
// I test usano _electron.launch via fixtures/electron.js — questo file
// configura solo timeout/retries/output paths.

import { defineConfig } from '@playwright/test';

// Finestre invisibili per TUTTA la suite (vedi src/main/test-window-mode.js).
// Sta qui e non nella fixture perché una cinquantina di spec lancia Electron per
// conto proprio (`tests/agent/driver.mjs`, `_electron.launch` diretto) e la
// fixture non li copre: bastava uno di quelli per far comparire una finestra a
// schermo per dieci secondi in mezzo a `npm test`. Questo file lo carica ogni
// worker, e ogni lancio eredita l'ambiente del worker → nessuna via di mezzo.
// `FILO_TEST_VISIBLE=1` rimette la finestra a schermo quando la si vuole vedere.
//
// Restano visibili anche i modi in cui GUARDARE l'app È lo scopo del comando
// (`--headed`, `--ui`, `--debug`): nasconderli sarebbe un comando che promette
// una cosa e ne fa un'altra. `npm run test:headed` passa proprio di qui.
const VUOLE_VEDERE = process.env.FILO_TEST_VISIBLE === '1'
  || process.argv.some((a) => a === '--headed' || a === '--ui' || a === '--debug');
if (!VUOLE_VEDERE) process.env.FILO_HIDE_WINDOW = '1';

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
