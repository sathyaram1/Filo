// openTab torna la pagina della scheda appena aperta anche quando un'altra pagina sta già sullo stesso host (#877):
// una scheda di prima, la stessa pagina aperta due volte, una finestra nascosta come quelle del controllo sui link
// (#553), la home già pronta. La regola sta in tests/helpers/schede.mjs.
import { test, expect } from './fixtures/electron.mjs';

// Quello che l'utente ha davanti è la scheda attiva: il segno lasciato sulla pagina tornata deve leggersi lì.
const segnoDellaSchedaAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.executeJavaScript('window.__segno || null');
});
const segna = (page, s) => page.evaluate((v) => { window.__segno = v; }, s);

test('due pagine dello stesso server: torna la seconda, quella davanti', async ({ app, openTab, testServer }) => {
  const prima = await openTab(testServer.html('<title>Prima</title><h1>prima</h1>'));
  const url = testServer.html('<title>Seconda</title><h1>seconda</h1>');
  const seconda = await openTab(url);
  expect(seconda).not.toBe(prima);
  expect(seconda.url()).toBe(url);
  await expect(seconda.locator('h1')).toHaveText('seconda');
  await segna(seconda, 'seconda');
  expect(await segnoDellaSchedaAttiva(app)).toBe('seconda');
});

test('la stessa pagina aperta due volte: torna la scheda nuova, non la vecchia', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<h1>doppia</h1>');
  const vecchia = await openTab(url);
  await segna(vecchia, 'vecchia');
  const nuova = await openTab(url);
  expect(nuova).not.toBe(vecchia);
  await segna(nuova, 'nuova');
  expect(await segnoDellaSchedaAttiva(app)).toBe('nuova');
  expect(await vecchia.evaluate(() => window.__segno)).toBe('vecchia');
});

test('una finestra nascosta sullo stesso host non passa per la scheda', async ({ app, openTab, testServer }) => {
  const esca = testServer.html('<h1>nascosta</h1>');
  // Come il controllo sui link: una finestra che non si vede, nella sua sessione, su un indirizzo del sito.
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = new BrowserWindow({ show: false, webPreferences: { partition: 'prova-877', sandbox: true } });
    return w.loadURL(u);
  }, esca);
  await expect.poll(() => app.windows().some((w) => w.url() === esca)).toBe(true);
  const page = await openTab(testServer.html('<h1>scheda</h1>'));
  await expect(page.locator('h1')).toHaveText('scheda');
  await segna(page, 'scheda');
  expect(await segnoDellaSchedaAttiva(app)).toBe('scheda');
});

test('una pagina interna già aperta: torna quella, senza aspettare una scheda che non nasce', async ({ app, openTab }) => {
  const prima = await openTab('filo://history/history.html');
  const ancora = await openTab('filo://history/history.html');
  expect(ancora).toBe(prima);
  await segna(ancora, 'cronologia');
  expect(await segnoDellaSchedaAttiva(app)).toBe('cronologia');
});

test.describe('con la home già pronta', () => {
  test.use({ riservaNuovaScheda: true });

  test('una scheda nuova: torna la home appena aperta, non quella dell\'avvio né la riserva', async ({ app, openTab }) => {
    // La riserva caricata è una Page che c'era già prima dell'apertura: diventa la scheda, e openTab deve tornare lei.
    const riservaPronta = () => app.evaluate(({ BrowserWindow }) => {
      const r = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riserva;
      const wc = r && r.webContents();
      return wc && wc.getURL() === 'filo://newtab/' && !wc.isLoading() ? r.id : null;
    });
    let riserva = null;
    await expect.poll(async () => (riserva = await riservaPronta()), { timeout: 20_000, message: 'la riserva non è pronta' }).toBeTruthy();
    const home = await openTab('filo://newtab/');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId)).toBe(riserva);
    await segna(home, 'home nuova');
    expect(await segnoDellaSchedaAttiva(app)).toBe('home nuova');
    const altra = await openTab('filo://newtab/');
    expect(altra).not.toBe(home);
    await segna(altra, 'altra home');
    expect(await segnoDellaSchedaAttiva(app)).toBe('altra home');
  });
});
