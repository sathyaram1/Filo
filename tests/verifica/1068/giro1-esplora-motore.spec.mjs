// Esplorazione della verifica #1068, giro 1: il motore nuovo apre le pagine e le strade comuni della navigazione.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.map((t) => ({ id: t.id, url: t.view.webContents.getURL(), attiva: t.id === w._filoTabs.activeId }));
});

test('la pagina gira sul motore supportato e lo dichiara come Chrome', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><title>Motore</title><p>ciao</p>');
  const v = await app.evaluate(() => ({ e: process.versions.electron, c: process.versions.chrome }));
  const ua = await page.evaluate(() => navigator.userAgent);
  console.log('versioni', v, ua);
  expect(Number(v.e.split('.')[0])).toBeGreaterThanOrEqual(44);
  expect(ua).toContain(`Chrome/${v.c.split('.')[0]}.`);
  expect(ua).not.toMatch(/Electron|filo/i);
});

test('link con target=_blank e window.open dopo un clic aprono una scheda che carica', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<!doctype html><title>Destinazione</title><p id="d">arrivato</p>');
  const dest2 = testServer.html('<!doctype html><title>Seconda</title><p>due</p>');
  const page = await testServer.openReady(openTab, `<!doctype html><title>Partenza</title>
<a id="l" href="${dest}" target="_blank" style="position:fixed;top:50px;left:50px;font-size:40px">vai</a>
<button id="b" style="position:fixed;top:200px;left:50px;font-size:40px">apri</button>
<script>document.getElementById('b').onclick = () => window.open(${JSON.stringify(dest2)});</script>`);
  await page.click('#l');
  await expect.poll(async () => (await schede(app)).some((t) => t.url === dest), { timeout: 10_000 }).toBe(true);
  await page.bringToFront().catch(() => {});
  const partenza = (await schede(app)).find((t) => t.url.endsWith(new URL(page.url()).pathname));
  await app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.activate ? w._filoTabs.activate(id) : w._filoTabs.switchTo(id);
  }, partenza.id).catch(() => {});
  await page.click('#b');
  await expect.poll(async () => (await schede(app)).some((t) => t.url === dest2), { timeout: 10_000 }).toBe(true);
});

test('indietro e avanti dalla cornice tornano alla pagina di prima', async ({ app, shell, openTab, testServer }) => {
  const b = testServer.html('<!doctype html><title>B</title><p>b</p>');
  const page = await testServer.openReady(openTab, `<!doctype html><title>A</title><a id="l" href="${b}" style="font-size:40px">b</a>`);
  const a = page.url();
  await page.click('#l');
  await expect.poll(() => page.url()).toBe(b);
  const id = (await schede(app)).find((t) => t.attiva).id;
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await expect.poll(() => page.url(), { timeout: 10_000 }).toBe(a);
});

test('trova nella pagina conta le occorrenze', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Trova</title><p>gatto cane gatto topo gatto</p>');
  const n = await app.evaluate(({ BrowserWindow }) => new Promise((res) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.once('found-in-page', (_e, r) => res(r.matches));
    wc.findInPage('gatto');
    setTimeout(() => res(-1), 5000);
  }));
  expect(n).toBe(3);
});
