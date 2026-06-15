// Feedback alpha: «aggiungi il comando /pulisci che avvia il riordino e pulizia
// delle tab». Wiring di un nuovo comando slash della dashboard che riusa lo
// stesso flusso del bottone "🧹 Riordina e archivia le schede": conferma Filo
// (SN_CONFIRM_UI) e, su conferma, RUN_TAB_TRIAGE.
//
// Il test ASSERISCE il successo: "/pulisci" è classificato come comando Filo e
// all'invio apre il popup di conferma del riordino. Senza il comando sarebbe
// trattato come comando shell/sconosciuto e nessuna conferma comparirebbe.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('"/pulisci" è un comando Filo e apre la conferma di riordino delle schede', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Riconosciuto come comando interno di Filo (arancione), non shell/sconosciuto.
  await input.fill('/pulisci');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);

  // All'invio compare il popup di conferma Filo del riordino.
  await submit(page, '/pulisci');
  await expect(page.locator('.sn-confirm-overlay')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.sn-confirm-title')).toHaveText('Riordino delle schede');
});

test('"/pulizia" è un alias dello stesso comando', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill('/pulizia');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await submit(page, '/pulizia');
  await expect(page.locator('.sn-confirm-overlay')).toBeVisible({ timeout: 8_000 });
});
