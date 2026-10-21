// Verifica #1412 giro 3, rilievo 1: la tendina chiusa della durata della cache mostra la scelta di serie con la sua durata.
// Si guarda il bottone che l'utente vede, non il <select> nativo che la pagina nasconde dietro di lui.
import { test, expect } from '../../fixtures/electron.mjs';

const visibile = (sel) => sel.evaluate((el) => {
  const w = el.closest('.sn-select-wrap');
  const v = w && w.querySelector('.sn-select-value');
  return v ? v.textContent : el.options[el.selectedIndex].text;
});

test('r1 Preferenze: la tendina chiusa dice quanto vale la cache di serie', async ({ openTab }) => {
  test.setTimeout(60_000);
  const pref = await openTab('filo://preferences/preferences.html');
  const sel = pref.locator('#contestoCache');
  await expect(pref.locator('#contestoCachePredefinita')).toHaveText(/un'ora/);
  await expect.poll(() => visibile(sel), { timeout: 5_000 }).toMatch(/un'ora/);
});

test('r1 modelli predefiniti: la tendina chiusa dice quanto vale la cache del codice', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  await page.addInitScript(() => {
    const config = { apiKeysPresent: { openrouter: true }, modelRegistry: {}, models: {}, excludedProviders: [], contestoFilo: {}, contestoFiloDiSerie: { giorni: 3, token: 100000, cache: '1h' } };
    const stub = async (msg) => (msg.type === 'defaults_get' ? { ok: true, config } : { ok: true, items: [] });
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  const sel = page.locator('#contestoCache');
  await expect(page.locator('#contestoCacheDiSerie')).toHaveText(/un'ora/);
  await expect.poll(() => visibile(sel), { timeout: 5_000 }).toMatch(/un'ora/);
});
