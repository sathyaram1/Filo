// #1246 — a schermo intero le schede compaiono col puntatore fermo contro il bordo in alto e spariscono allontanandosi,
// come la barra laterale dal bordo sinistro. Ogni prova asserisce quello che l'utente vede: la fila delle schede scoperta.

import { test, expect } from './fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (titolo = 'Pagina a schermo intero') => `<!doctype html><html><head><title>${titolo}</title></head>
<body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>${titolo}</h1><p id="p">Testo.</p><div id="box" style="width:120px;height:80px;background:#c45a3b"></div>
</body></html>`;
const SITO = sito();

// Dove sta la scheda davanti, e quanto è alta la fila delle schede: è quello che decide cosa si vede.
const vista = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  const b = t.view.getBounds();
  return { y: b.y, alta: b.height, finestra: w.getContentSize()[1], fila: tm.tabRowHeight, schermoIntero: tm.contentFullscreen, id: tm.activeId };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.setContentFullscreen(v);
}, on);
// Dalla stessa porta delle Preferenze: la barra e le schede ricevono le regolazioni nuove senza riavvio.
const impostazioni = (app, barraLaterale) => app.evaluate(async (_e, b) => globalThis.SN_HANDLE_MESSAGE(
  { type: 'update_settings', settings: { barraLaterale: b } }, { url: 'filo://preferences/preferences.html' }), barraLaterale);

test('a schermo intero il puntatore fermo in alto scopre le schede, sopra le schede restano, sulla pagina spariscono', async ({ app, shell, openTab, testServer }) => {
  const primaPagina = await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, SITO);
  await schermoIntero(app, true);
  await expect.poll(async () => { const v = await vista(app); return v.y === 0 && v.alta === v.finestra; }).toBe(true);
  const intera = await vista(app);

  // Passarci di corsa, o arrivarci con un tasto premuto (una selezione), non le apre.
  await page.mouse.move(400, 300);
  await page.mouse.move(400, 0);
  await page.mouse.move(400, 80);
  await pausa(700);
  expect((await vista(app)).y).toBe(0);
  await page.mouse.down();
  await page.mouse.move(400, 0, { steps: 4 });
  await pausa(700);
  expect((await vista(app)).y, 'trascinando o selezionando le schede non arrivano').toBe(0);
  await page.mouse.up();
  await page.mouse.move(400, 200);

  // Fermo contro il bordo: la pagina scende sotto la fila delle schede, senza cambiare misura.
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await vista(app)).y).toBe(intera.fila);
  const giu = await vista(app);
  expect(giu.alta, 'la pagina non si ridispone: scende e basta').toBe(giu.finestra);
  expect(giu.schermoIntero).toBe(true);
  expect(await shell.locator('.tab').count()).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: 'tests/.shots/schede-a-schermo-intero-pagina.png' });

  // Sopra la fila delle schede restano, anche oltre l'attesa d'uscita; un clic su una scheda la porta davanti.
  const prima = shell.locator('.tab', { hasText: 'Prima' });
  const box = await prima.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pausa(900);
  expect((await vista(app)).y).toBe(intera.fila);
  await prima.click();
  await expect.poll(async () => (await vista(app)).id).not.toBe(giu.id);
  expect((await vista(app)).y, 'la scheda nuova arriva sotto le schede ancora scoperte').toBe(intera.fila);

  // Tornati sulla pagina, dopo l'attesa d'uscita della barra laterale le schede se ne vanno.
  await primaPagina.mouse.move(400, 300);
  await expect.poll(async () => (await vista(app)).y, { timeout: 4000 }).toBe(0);
  expect((await vista(app)).schermoIntero).toBe(true);
});

test('un clic sulla pagina le chiude subito, e uscendo dallo schermo intero tutto torna com\'era', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const normale = await vista(app);
  await schermoIntero(app, true);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 3 });
  await expect.poll(async () => (await vista(app)).y).toBe(normale.fila);
  await page.mouse.click(400, 300);
  await expect.poll(async () => (await vista(app)).y).toBe(0);

  await page.mouse.move(400, 0, { steps: 3 });
  await expect.poll(async () => (await vista(app)).y).toBe(normale.fila);
  await schermoIntero(app, false);
  await expect.poll(async () => (await vista(app)).y).toBe(normale.y);
  expect((await vista(app)).alta).toBe(normale.alta);
  // Fuori dallo schermo intero il bordo in alto è della pagina: niente cambia.
  await page.mouse.move(400, 0, { steps: 3 });
  await pausa(700);
  expect((await vista(app)).y).toBe(normale.y);
});

test('una pagina che in cima ha il riquadro di un altro sito scopre le schede lo stesso, e tornando giù spariscono (#1343)', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">App incorporata</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Con riquadro</title></head><body style="margin:0">
    <iframe src="${dentro}" style="position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await schermoIntero(app, true);
  await expect.poll(async () => (await vista(app)).y).toBe(0);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => { const v = await vista(app); return v.y === v.fila; }, { timeout: 4000 }).toBe(true);
  await page.mouse.move(400, 300, { steps: 3 });
  await expect.poll(async () => (await vista(app)).y, { timeout: 4000 }).toBe(0);
});

test('spento in Preferenze il bordo in alto non scopre le schede, e la casella lo riaccende', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await impostazioni(app, { schedeInAlto: false });
  await schermoIntero(app, true);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 3 });
  await pausa(800);
  expect((await vista(app)).y).toBe(0);
  await schermoIntero(app, false);

  const pref = await openTab('filo://preferences/preferences.html#sec-barra');
  const casella = pref.locator('#barraSchede');
  await expect(casella).not.toBeChecked();
  await casella.check();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).barraLaterale.schedeInAlto)).toBe(true);
});

test('lo schermo pieno di un video tiene per sé il bordo in alto', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await app.evaluate(({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.id === tabId);
    return tab.view.webContents.executeJavaScript('document.getElementById("box").requestFullscreen().catch(()=>{}); true', true);
  }, id);
  await expect.poll(async () => (await vista(app)).schermoIntero, { timeout: 8000 }).toBe(true);
  const page = app.windows().find((w) => { try { return /^http/.test(w.url()); } catch (_) { return false; } });
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 3 });
  await pausa(800);
  expect((await vista(app)).y).toBe(0);
});
