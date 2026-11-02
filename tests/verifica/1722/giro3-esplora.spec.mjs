// Esplorazione del giro 3: il lucchetto con le strade comuni (scheda nuova, cambio scheda, ridimensiona, incognito), e l'aspetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = (t) => `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif"><h1>${t}</h1></body></html>`;

const attiva = (app, incog = false) => app.evaluate(({ BrowserWindow }, inc) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === inc);
  if (!w) return null;
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { b: t.view.getBounds(), larga: w.getContentSize()[0], url: t.url };
}, incog);

test('lucchetto: scheda nuova, cambio scheda, ridimensiona, home', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('Uno'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#testa .lucchetto').click();
  await expect.poll(async () => (await attiva(app)).b.x).toBe(56);
  await barra.screenshot({ path: 'tests/.shots/1722-g3-barra-chiaro.png' }).catch(() => {});

  // Scheda nuova
  await testServer.openReady(openTab, SITO('Due'));
  await pausa(600);
  const dopoNuova = await attiva(app);
  console.log('nuova', JSON.stringify(dopoNuova));
  expect(dopoNuova.b.x).toBe(56);
  expect(dopoNuova.b.width).toBe(dopoNuova.larga - 56);

  // Ridimensiona
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).setContentSize(900, 700));
  await pausa(800);
  const dopoRid = await attiva(app);
  console.log('rid', JSON.stringify(dopoRid));
  expect(dopoRid.b.x).toBe(56);
  expect(dopoRid.b.width).toBe(dopoRid.larga - 56);

  // Cambio scheda con Ctrl+Tab
  await premi(app, 'scheda', 'Tab', ['control']);
  await pausa(600);
  const dopoCambio = await attiva(app);
  console.log('cambio', JSON.stringify(dopoCambio));
  expect(dopoCambio.b.x).toBe(56);

  // Home
  await premi(app, 'scheda', 'T', ['control']);
  await pausa(1200);
  const home = await attiva(app);
  console.log('home', JSON.stringify(home));
  expect(home.b.x).toBe(56);
  expect((await statoBarra(app)).aperta).toBe(true);
});

test('lucchetto: tema scuro', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await testServer.openReady(openTab, SITO('Uno'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#testa .lucchetto').click();
  await pausa(800);
  await barra.screenshot({ path: 'tests/.shots/1722-g3-barra-scuro.png' }).catch(() => {});
});

test('lucchetto: incognito', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('Uno'));
  await premi(app, 'scheda', 'B', ['control', 'alt', 'shift']);
  await expect.poll(async () => (await attiva(app)).b.x).toBe(56);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => attiva(app, true).then((a) => !!a), { timeout: 20000 }).toBe(true);
  await pausa(2500);
  const inc = await attiva(app, true);
  console.log('incognito', JSON.stringify(inc));
  expect(inc.b.x).toBe(56);
});
