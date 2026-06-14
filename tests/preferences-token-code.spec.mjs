// #146.3 — Sezione "token estetici" a codice nelle Preferenze.
//
// Criterio di fatto della spec: la sezione mostra TUTTI i token coi valori
// predefiniti; modificando un token dalla sezione l'aspetto cambia (live, senza
// riavvio) e l'override si persiste; un valore non valido è rifiutato con un
// errore puntuale SENZA perdere gli altri override; il reset (singolo e globale)
// riporta ai predefiniti.
//
// I test asseriscono il COMPORTAMENTO: la variabile CSS effettiva sul <html>
// della pagina cambia, e gli override finiscono davvero in settings.themeTokens
// (percorso reale UPDATE_SETTINGS → storage), non solo un cambio cosmetico.

import { test, expect } from './fixtures/electron.mjs';

const ACCENT_DEFAULT = '#c45a3b';

// Computed value di una variabile CSS sul <html> della pagina.
const cssVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// Override persistiti, letti dallo storage reale dalla pagina (ha lo shim chrome).
const storedTokens = (page) =>
  page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings && r.settings.themeTokens) || {};
  });

test('la sezione mostra i default; modificare un token applica live e persiste; ↺ ripristina', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tok-accent');

  // Stato iniziale: tutti i token coi predefiniti, nessuno "personalizzato".
  await expect(page.locator('#tok-accent')).toHaveValue(ACCENT_DEFAULT);
  await expect(page.locator('.sn-token-row[data-token="accent"]')).not.toHaveClass(/sn-token-modified/);
  expect(await cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);

  // Marker per provare che NON c'è stato reload (l'override è live).
  await page.evaluate(() => { window.__snNoReload = true; });

  // Modifica accent → l'aspetto cambia subito e la riga diventa "personalizzata".
  await page.fill('#tok-accent', '#00cc44');
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe('#00cc44');
  await expect(page.locator('.sn-token-row[data-token="accent"]')).toHaveClass(/sn-token-modified/);
  expect(await page.evaluate(() => window.__snNoReload)).toBe(true);

  // …e l'override è persistito davvero (dopo il debounce).
  await expect.poll(() => storedTokens(page).then((t) => t.accent)).toBe('#00cc44');

  // ↺ del singolo token: torna al predefinito ovunque e la riga si "spegne".
  await page.click('.sn-token-row[data-token="accent"] .sn-token-reset');
  await expect.poll(() => cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);
  await expect(page.locator('#tok-accent')).toHaveValue(ACCENT_DEFAULT);
  await expect(page.locator('.sn-token-row[data-token="accent"]')).not.toHaveClass(/sn-token-modified/);
  await expect.poll(() => storedTokens(page).then((t) => t.accent)).toBeUndefined();
});

test('valore non valido: errore puntuale, gli altri override restano intatti', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tok-accent');

  // Due override validi che NON devono andare persi quando uno diventa invalido.
  await page.fill('#tok-accent', '#0044cc');
  await page.fill('#tok-radius', '12px');
  await expect.poll(() => storedTokens(page).then((t) => t.accent)).toBe('#0044cc');
  await expect.poll(() => storedTokens(page).then((t) => t.radius)).toBe('12px');

  // Ora un colore malformato su accent: errore mostrato, riga in stato invalido.
  await page.fill('#tok-accent', 'non-un-colore');
  const errLoc = page.locator('.sn-token-row[data-token="accent"] .sn-token-error');
  await expect(errLoc).toBeVisible();
  await expect(errLoc).toContainText('Colore non valido');
  await expect(page.locator('.sn-token-row[data-token="accent"]')).toHaveClass(/sn-token-invalid/);

  // Il valore invalido NON è stato applicato né persistito: accent resta l'ultimo
  // valido, e l'override di radius è intatto.
  expect(await cssVar(page, '--sn-accent')).toBe('#0044cc');
  expect((await storedTokens(page)).accent).toBe('#0044cc');
  expect((await storedTokens(page)).radius).toBe('12px');
});

test('reset globale: riporta tutti i token ai predefiniti', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tok-accent');

  await page.fill('#tok-accent', '#9911aa');
  await page.fill('#tok-radius', '14px');
  await expect.poll(() => storedTokens(page).then((t) => t.accent)).toBe('#9911aa');
  await expect.poll(() => storedTokens(page).then((t) => t.radius)).toBe('14px');

  await page.click('#resetAllTokens');

  await expect.poll(() => cssVar(page, '--sn-accent')).toBe(ACCENT_DEFAULT);
  await expect(page.locator('#tok-accent')).toHaveValue(ACCENT_DEFAULT);
  await expect(page.locator('.sn-token-row[data-token="accent"]')).not.toHaveClass(/sn-token-modified/);
  await expect.poll(() => storedTokens(page).then((t) => Object.keys(t).length)).toBe(0);
});
