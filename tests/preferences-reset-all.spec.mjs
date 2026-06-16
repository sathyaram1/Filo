// Spec "Ripristina tutte le impostazioni" (#184).
//
// Il feedback: l'utente personalizza l'aspetto (a voce o a mano), poi clicca il
// reset in Preferenze ma una personalizzazione resta appiccicata (es. la tab
// resta verdina) perché i reset erano parziali (solo token / solo colore tab).
// Criterio di fatto: UN bottone riporta DAVVERO tutte le impostazioni — token
// estetici, colore identità delle tab, tema, dimensione del testo — ai valori
// predefiniti nello storage reale; le chiavi API si preservano.

import { test, expect } from './fixtures/electron.mjs';

const storedSettings = (page) =>
  page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings) || {};
  });

test('un solo bottone riporta token, colore tab, tema e testo ai predefiniti', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#resetAllSettings');

  // Una chiave API finta, per verificare che il reset NON la cancelli.
  await page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    const s = (r && r.settings) || {};
    s.apiKeys = { ...(s.apiKeys || {}), openrouter: 'sk-test-keep-me' };
    await chrome.storage.local.set({ settings: s });
  });

  // Personalizza più aree, lungo i percorsi reali della pagina.
  await page.fill('#tok-accent', '#1a7d3a');            // token estetico (verde)
  await page.fill('#tabcol-opacita_tab', '0.2');        // colore identità tab
  await page.locator('#tok-accent').blur();
  await page.selectOption('#theme', 'dark');            // tema
  await page.selectOption('#textScale', '1.25');        // dimensione testo

  // Le personalizzazioni sono DAVVERO nello storage prima del reset.
  await expect.poll(() => storedSettings(page).then((s) => (s.themeTokens || {}).accent)).toBe('#1a7d3a');
  await expect.poll(() => storedSettings(page).then((s) => (s.tabColor || {}).opacita_tab)).toBe(0.2);
  await expect.poll(() => storedSettings(page).then((s) => s.theme)).toBe('dark');
  await expect.poll(() => storedSettings(page).then((s) => s.textScale)).toBe(1.25);

  // Ripristina tutto → conferma.
  await page.click('#resetAllSettings');
  await page.waitForSelector('.sn-confirm-btn-ok');
  await page.click('.sn-confirm-btn-ok');

  // Ogni area è tornata ai predefiniti (themeTokens svuotato, colore tab,
  // tema 'system', testo 1×), in un colpo solo.
  await expect.poll(() => storedSettings(page).then((s) => Object.keys(s.themeTokens || {}).length)).toBe(0);
  await expect.poll(() => storedSettings(page).then((s) => (s.tabColor || {}).opacita_tab)).toBe(0.6);
  await expect.poll(() => storedSettings(page).then((s) => s.theme)).toBe('system');
  await expect.poll(() => storedSettings(page).then((s) => s.textScale)).toBe(1);

  // Le credenziali NON vengono toccate dal reset estetico.
  await expect.poll(() => storedSettings(page).then((s) => (s.apiKeys || {}).openrouter)).toBe('sk-test-keep-me');
});
