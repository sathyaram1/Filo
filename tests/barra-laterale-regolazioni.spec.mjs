// #871 — le regolazioni della barra laterale: da Preferenze → Avanzate e a parole (la stessa strada
// dell'azione IMPOSTA_PREFERENZA). Attesa sul bordo, chiusura dopo l'uscita, striscia, apertura dal bordo.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Pagina</h1><p>Testo.</p></body></html>`;

const opzioni = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return { ...w._filoTabs.barra.opzioni };
});

test('da Preferenze: l\'attesa sul bordo, la chiusura, la striscia e l\'apertura dal bordo arrivano alla barra', async ({ app, openTab, testServer }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForSelector('#barraAttesa', { timeout: 8000 });
  await expect(pref.locator('#barraAttesa')).toHaveValue('250');
  await expect(pref.locator('#barraUscita')).toHaveValue('400');
  await expect(pref.locator('#barraSpinta')).toBeChecked();
  await expect(pref.locator('#barraStriscia')).toBeChecked();

  await pref.locator('#barraAttesa').fill('900');
  await pref.locator('#barraAttesa').blur();
  await pref.locator('#barraUscita').fill('20');
  await pref.locator('#barraUscita').blur();
  // Fuori dai limiti torna dentro, a vista: il campo dice il valore in uso.
  await expect(pref.locator('#barraUscita')).toHaveValue('100');
  await pref.locator('#barraStriscia').uncheck();
  await expect.poll(() => opzioni(app)).toEqual({ spinta: true, attesaMs: 900, uscitaMs: 100, striscia: false });

  const sito = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await expect(barra.locator('html.senza-striscia')).toHaveCount(1);
  // Con 900 ms di attesa, dopo mezzo secondo sul bordo è ancora chiusa; poco dopo si apre.
  await barra.mouse.move(1, 300);
  await pausa(500);
  expect((await statoBarra(app)).aperta).toBe(false);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(true);
  // Con 100 ms di chiusura, uscito sulla pagina si chiude subito.
  await barra.mouse.move(40, 300);
  await sito.mouse.move(600, 300);
  await sito.mouse.move(610, 305);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 1000 }).toBe(false);
});

test('a parole: «non aprire la barra spingendo sul bordo» la spegne, «striscia sì» la rimette', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  const applica = (chiave, valore) => app.evaluate(async (_e, [k, v]) => {
    const built = globalThis.SN_PREF.buildPreferencePartial(k, v);
    if (!built || built.rifiuto) return built;
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: built.partial }, { url: 'filo://preferences/preferences.html' });
    return built;
  }, [chiave, valore]);

  expect((await applica('barra_spinta', 'no')).label).toMatch(/non si apre/);
  await expect.poll(async () => (await opzioni(app)).spinta).toBe(false);
  await barra.mouse.move(1, 300);
  await pausa(700);
  expect((await statoBarra(app)).aperta).toBe(false);

  expect((await applica('barra_attesa', '10 secondi')).rifiuto).toMatch(/10000 ms/);
  expect((await opzioni(app)).attesaMs).toBe(250);

  await applica('barra_striscia', 'no');
  await expect(barra.locator('html.senza-striscia')).toHaveCount(1);
  await applica('striscia', 'sì');
  await expect(barra.locator('html.senza-striscia')).toHaveCount(0);

  // La barra si apre ancora dalla scorciatoia e dalla striscia.
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  expect((await statoBarra(app)).aperta).toBe(true);
});
