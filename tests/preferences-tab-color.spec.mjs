// Spec "Colore identità delle tab" — Preferenze avanzate: i sei parametri.
//
// Criterio di fatto della spec: l'utente cambia un parametro (qui nelle
// Preferenze) e il valore finisce DAVVERO in settings.tabColor (percorso reale
// UPDATE_SETTINGS → storage), riga "personalizzata" evidenziata, ↺ e reset
// globale riportano ai predefiniti. Asserisce il comportamento (la scrittura
// persistita), non un cambio cosmetico.

import { test, expect } from './fixtures/electron.mjs';

// Parametri tabColor persistiti, letti dallo storage reale (shim chrome).
const storedTabColor = (page) =>
  page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings && r.settings.tabColor) || {};
  });

test('la sezione mostra i sei parametri coi default; modificarne uno persiste; ↺ ripristina', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tabcol-opacita_tab');

  // Default visibili e nessuna riga "personalizzata".
  await expect(page.locator('#tabcol-opacita_tab')).toHaveValue('0.6');
  await expect(page.locator('#tabcol-saturazione_tab')).toHaveValue('1');
  await expect(page.locator('.sn-token-row[data-param="opacita_tab"]')).not.toHaveClass(/sn-token-modified/);

  // Cambia opacita_tab → finisce in settings.tabColor (dopo il debounce) e la
  // riga si accende come "personalizzata".
  await page.fill('#tabcol-opacita_tab', '0.3');
  await expect.poll(() => storedTabColor(page).then((t) => t.opacita_tab)).toBe(0.3);
  await expect(page.locator('.sn-token-row[data-param="opacita_tab"]')).toHaveClass(/sn-token-modified/);

  // ↺ del singolo parametro: torna al default e la riga si spegne.
  await page.click('.sn-token-row[data-param="opacita_tab"] .sn-token-reset');
  await expect(page.locator('#tabcol-opacita_tab')).toHaveValue('0.6');
  await expect.poll(() => storedTabColor(page).then((t) => t.opacita_tab)).toBe(0.6);
  await expect(page.locator('.sn-token-row[data-param="opacita_tab"]')).not.toHaveClass(/sn-token-modified/);
});

test('valore fuori range viene clampato al massimo prima di persistere', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tabcol-opacita_tab');

  // opacita_tab ha range 0–1: un 5 deve essere riportato a 1, non scritto com'è.
  await page.fill('#tabcol-opacita_tab', '5');
  await page.locator('#tabcol-opacita_tab').blur();
  await expect.poll(() => storedTabColor(page).then((t) => t.opacita_tab)).toBe(1);
  await expect(page.locator('#tabcol-opacita_tab')).toHaveValue('1');
});

test('reset globale: riporta tutti i parametri ai predefiniti', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tabcol-opacita_tab');

  await page.fill('#tabcol-opacita_tab', '0.2');
  await page.fill('#tabcol-saturazione_tab', '0.4');
  await expect.poll(() => storedTabColor(page).then((t) => t.opacita_tab)).toBe(0.2);
  await expect.poll(() => storedTabColor(page).then((t) => t.saturazione_tab)).toBe(0.4);

  await page.click('#resetAllTabColor');

  await expect(page.locator('#tabcol-opacita_tab')).toHaveValue('0.6');
  await expect(page.locator('#tabcol-saturazione_tab')).toHaveValue('1');
  await expect.poll(() => storedTabColor(page).then((t) => t.opacita_tab)).toBe(0.6);
  await expect.poll(() => storedTabColor(page).then((t) => t.saturazione_tab)).toBe(1);
});
