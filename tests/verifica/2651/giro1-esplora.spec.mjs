// Verifica #2651, giro 1: esplorazione del Color picker dalle strade dell'utente.
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra, barraPage } from '../../helpers/barra.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const PAGINA = `<!doctype html><html><head><title>Colori</title></head><body style="margin:0">
  <div style="position:fixed;left:0;top:0;width:200px;height:100vh;background:#12ab34"></div>
  <div style="position:fixed;left:200px;top:0;right:0;height:100vh;background:#e05a2b"></div></body></html>`;

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

// Il pixel vero della scheda, letto dal main sulla sua foto, al punto CSS (x, y).
const pixelVero = (app, prefisso, x, y) => app.evaluate(async ({ webContents }, d) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(d.prefisso));
  const img = await wc.capturePage();
  const { width, height } = img.getSize();
  const b = img.toBitmap();
  const zoom = wc.getZoomFactor();
  const vw = await wc.executeJavaScript('window.innerWidth');
  const s = width / vw;
  const px = Math.floor(d.x * s), py = Math.floor(d.y * s);
  const i = (py * width + px) * 4;
  const h = (n) => n.toString(16).padStart(2, '0');
  return { hex: ('#' + h(b[i + 2]) + h(b[i + 1]) + h(b[i])).toUpperCase(), width, height, zoom };
}, { prefisso, x, y });

async function apri(app, page) {
  await premiNellaBarra(app, 'colorPicker');
  const strato = page.locator('.sn-color-overlay');
  await expect(strato).toBeVisible({ timeout: 8000 });
  return strato;
}

test('nuova scheda: il colore copiato è quello vero sotto il clic', async ({ app }) => {
  const page = await home(app);
  await page.screenshot({ path: 'tests/.shots/v2651-nuova-prima.png' });
  const atteso = await pixelVero(app, 'filo://newtab', 300, 200);
  const attesoIn = await pixelVero(app, 'filo://newtab', 640, 330);
  await scrivi(app, 'prima');
  await apri(app, page);
  await page.mouse.move(300, 200, { steps: 4 });
  await page.screenshot({ path: 'tests/.shots/v2651-nuova-lente.png' });
  await page.mouse.click(300, 200);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe(atteso.hex);
  console.log('nuova scheda', atteso, attesoIn);
});

test('fuoco: dopo il clic nella barra la tastiera va alla pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await apri(app, page);
  const f = await page.evaluate(() => ({ has: document.hasFocus(), cls: document.activeElement && document.activeElement.className }));
  const wcF = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.isFocused()).map((w) => w.getURL().slice(0, 60)));
  console.log('fuoco', f, wcF);
  await page.keyboard.press('Escape');
});

for (const url of ['filo://options/options.html', 'filo://preferences/preferences.html', 'filo://editor/editor.html', 'filo://history/history.html']) {
  test(`pagina di Filo ${url}: il contagocce si apre`, async ({ app, openTab }) => {
    const page = await openTab(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await page.mouse.move(50, 50);
    await page.waitForTimeout(500);
    const atteso = await pixelVero(app, url, 50, 50);
    const barra = await barraPage(app);
    await premiNellaBarra(app, 'colorPicker').catch((e) => console.log('premi', url, String(e).slice(0, 200)));
    const ico = barra.locator('#nav .ico[data-id="colorPicker"]');
    console.log(url, 'icona', await ico.getAttribute('class').catch(() => '?'), await ico.getAttribute('title').catch(() => '?'));
    const strato = page.locator('.sn-color-overlay');
    await expect(strato).toBeVisible({ timeout: 8000 });
    await scrivi(app, 'prima');
    await page.mouse.click(50, 50);
    await expect.poll(() => appunti(app), { timeout: 8000 }).toBe(atteso.hex);
  });
}

test('zoom 150%: il colore è quello sotto il clic, vicino al confine', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ webContents }, o) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(o)).setZoomFactor(1.5), testServer.origin);
  await page.waitForTimeout(500);
  await scrivi(app, 'prima');
  await apri(app, page);
  await page.mouse.click(195, 100);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#12AB34');
  await apri(app, page);
  await page.mouse.click(205, 100);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#E05A2B');
});

test('CSP rigida: funziona lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA, { headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  await scrivi(app, 'prima');
  await apri(app, page);
  await page.mouse.click(400, 300);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#E05A2B');
});

test('due clic svelti sull icona: uno strato solo, e poi si sceglie', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(app, 'prima');
  await apri(app, page);
  await premiNellaBarra(app, 'colorPicker');
  await page.waitForTimeout(800);
  console.log('strati', await page.locator('.sn-color-overlay').count());
  await page.mouse.click(100, 100);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#12AB34');
  await expect(page.locator('.sn-color-overlay')).toHaveCount(0);
});

test('pagina scorsa: prende il colore che si vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0">
    <div style="height:1500px;background:#112233"></div><div style="height:1500px;background:#aabbcc"></div></body>`);
  await page.evaluate(() => window.scrollTo(0, 1600));
  await scrivi(app, 'prima');
  await apri(app, page);
  await page.mouse.click(200, 200);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#AABBCC');
});
