// #871 — le regolazioni della barra laterale: da Preferenze → Avanzate e a parole (la stessa strada
// dell'azione IMPOSTA_PREFERENZA). Attesa sul bordo, chiusura dopo l'uscita, striscia, apertura dal bordo.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, puntatoreCheSegue } from './helpers/barra.mjs';

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
  // Le schede che scendono dal bordo alto a schermo intero (#1246) hanno lo stesso posto e la stessa strada.
  await expect(pref.locator('#barraSchede')).toBeChecked();
  await pref.locator('#barraSchede').uncheck();
  await expect.poll(() => opzioni(app)).toEqual({ spinta: true, attesaMs: 900, uscitaMs: 100, striscia: false, schede: false, bloccata: false });

  const sito = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await expect(barra.locator('html.senza-striscia')).toHaveCount(1);
  // Con 900 ms di attesa, dopo mezzo secondo sul bordo è ancora chiusa; poco dopo si apre, e resta aperta
  // anche dove il pannello dice «dentro» in ritardo (una macchina carica: #1216.2).
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra;
    const m = b._messaggio.bind(b);
    b._messaggio = (c, d) => (c === 'barra:dentro' ? setTimeout(() => m(c, d), 300) : m(c, d));
  });
  await puntatoreCheSegue(app);
  await barra.mouse.move(1, 300);
  await pausa(500);
  expect((await statoBarra(app)).aperta).toBe(false);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(true);
  await pausa(400);
  expect(await statoBarra(app)).toMatchObject({ aperta: true, motivo: 'spinta' });
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

  expect((await applica('barra_attesa', '10 secondi')).rifiuto).toMatch(/10\.000 ms è fuori dai limiti/);
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

// #871.6 (D-11, opzione 1): col video a tutto schermo la striscia non resta sopra il film; il bordo e il tasto aprono ancora.
test('a tutto schermo la striscia del bordo è spenta, e la barra si apre lo stesso dal bordo e col tasto', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><title>Film</title><body style="margin:0;background:#000"><div id="v" style="width:100vw;height:100vh;background:#050505"></div><script>document.getElementById("v").addEventListener("click",()=>document.getElementById("v").requestFullscreen())</script></body>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  const accesa = () => barra.evaluate(() => {
    const s = document.getElementById('striscia');
    return s.getBoundingClientRect().width > 0 && Number(getComputedStyle(s, '::before').opacity) > 0;
  });
  expect(await accesa()).toBe(true);
  await page.locator('#v').click();
  await expect.poll(async () => (await statoBarra(app)).schermoIntero, { timeout: 8000 }).toBe(true);
  await expect.poll(accesa, { timeout: 3000 }).toBe(false);

  await puntatoreCheSegue(app);
  await barra.mouse.move(1, 300);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(true);
  expect((await statoBarra(app)).motivo).toBe('spinta');
  await comandaBarra(app, 'chiudi');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control', 'shift'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['control', 'shift'] });
  });
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await comandaBarra(app, 'chiudi');

  // Uscendo dallo schermo intero la striscia torna.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(async () => (await statoBarra(app)).schermoIntero, { timeout: 8000 }).toBe(false);
  await expect.poll(accesa, { timeout: 3000 }).toBe(true);
});
