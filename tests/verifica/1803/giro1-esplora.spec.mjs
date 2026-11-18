// Verifica #1803 giro 1: esplorazione della barra dei siti e della chat ripiegata.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const scatta = async (page, nome) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `v1803-${nome}.png`) });
};
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const attiva = (shell, id) => shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
const imposta = (page, settings) => page.evaluate((s) => new Promise((ok) => chrome.runtime.sendMessage(
  { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: s }, ok)), settings);
const salvate = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti || []);

async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
}
async function puntoInPagina(app, page, selettore) {
  const r = await page.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}
async function lasciaSullaBarra(app, shell, page, idScheda) {
  const verso = await puntoInPagina(app, page, '#barraRiga');
  const da = await linguetta(shell, idScheda);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
}

const CINQUE = [
  { id: 'a', tipo: 'sito', url: 'https://www.wikipedia.org/', nome: 'Wikipedia', icona: '' },
  { id: 'b', tipo: 'sito', url: 'https://www.youtube.com/', nome: 'YouTube', icona: '' },
  { id: 'c', tipo: 'sito', url: 'https://maps.example.org/', nome: 'Mappe', icona: '' },
  { id: 'd', tipo: 'sito', url: 'https://mail.example.org/', nome: 'Posta 📬', icona: '' },
  { id: 'e', tipo: 'sito', url: 'https://news.example.org/', nome: 'Un nome lunghissimo '.repeat(10), icona: '' },
];

test('foto: vuota e piena, aperta e ripiegata, chiara e scura', async ({ app }) => {
  test.setTimeout(90_000);
  let p = await home(app);
  await scatta(p, 'vuota-aperta');
  await p.locator('#ripiegaChat').click();
  await expect(p.locator('#threadView')).toBeHidden();
  await scatta(p, 'vuota-ripiegata');
  await p.locator('#ripiegaChat').click();
  await app.evaluate(async (_e, v) => { await chrome.storage.local.set({ filo_barra_siti: v }); }, CINQUE);
  await p.reload();
  p = await home(app);
  await expect(p.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(5);
  await scatta(p, 'piena-aperta');
  await p.locator('#barraSiti .dash-barra-voce[aria-label="YouTube"]').hover();
  await scatta(p, 'piena-aperta-hover');
  await p.locator('#ripiegaChat').click();
  await scatta(p, 'piena-ripiegata');
  await imposta(p, { theme: 'dark' });
  await expect(p.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await scatta(p, 'piena-ripiegata-scura');
  await p.locator('#ripiegaChat').click();
  await scatta(p, 'piena-aperta-scura');
  await imposta(p, { theme: 'light', barraSiti: { visibile: false } });
  await scatta(p, 'nascosta-aperta');
  await p.locator('#ripiegaChat').click();
  await scatta(p, 'nascosta-ripiegata');
  console.log('RIPIEGATA-NASCOSTA thread visibile?', await p.locator('#threadView').isVisible(), 'freccia', await p.locator('#ripiegaChat').isVisible());
});

test('una scheda di Filo trascinata sulla barra', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://history/');
  const t = (await schede(shell)).find((x) => String(x.url).startsWith('filo://history'));
  const casa = (await schede(shell)).find((x) => String(x.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  await lasciaSullaBarra(app, shell, page, t.id);
  await page.waitForTimeout(1500);
  console.log('FILO-TAB voci', JSON.stringify(await salvate(app)), 'flash', await page.locator('#dashFlash').textContent().catch(() => ''));
  await scatta(page, 'scheda-filo');
});

test('lo stesso sito due volte, e un indirizzo scritto male', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html('<title>Doppio</title><p>x</p>');
  await openTab(url);
  const t = (await schede(shell)).find((x) => x.url === url);
  const casa = (await schede(shell)).find((x) => String(x.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  await lasciaSullaBarra(app, shell, page, t.id);
  await expect(page.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1);
  await page.waitForTimeout(500);
  await lasciaSullaBarra(app, shell, page, t.id);
  await page.waitForTimeout(800);
  console.log('DOPPIO conta', await page.locator('#barraSiti .dash-barra-voce[data-tipo]').count(), 'flash', await page.locator('#dashFlash').textContent().catch(() => ''), 'visibile', await page.locator('#dashFlash').isVisible().catch(() => false));
  await scatta(page, 'doppio');
  for (const scritto of ['youtube', 'www.youtube.com/watch?v=abc', '  wikipedia.org  ', 'http://localhost:3000']) {
    await page.locator('#barraSiti .dash-barra-piu').click();
    await page.locator('.dash-barra-campo input').fill(scritto);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    console.log('SCRITTO', JSON.stringify(scritto), '->', JSON.stringify((await salvate(app)).map((v) => v.url)), 'flash', await page.locator('#dashFlash').textContent().catch(() => ''));
  }
});

test('due nuove schede restano allineate', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const a = await home(app);
  await openTab('filo://newtab/');
  const tutte = (await schede(shell)).filter((x) => String(x.url).startsWith('filo://newtab'));
  expect(tutte.length).toBeGreaterThan(1);
  const b = await home(app, { scheda: tutte[tutte.length - 1].id });
  await b.locator('#barraSiti .dash-barra-piu').click();
  await b.locator('.dash-barra-campo input').fill('wikipedia.org');
  await b.keyboard.press('Enter');
  await expect(b.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1);
  await expect(a.locator('#barraSiti .dash-barra-voce[data-tipo]')).toHaveCount(1, { timeout: 5000 });
  await b.locator('#ripiegaChat').click();
  await expect(b.locator('#threadView')).toBeHidden();
  await a.waitForTimeout(1000);
  console.log('RIPIEGA-ALTRA thread A visibile?', await a.locator('#threadView').isVisible());
});

test('il tasto destro sulla riga della barra vuota, a chat aperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const r = await page.locator('#barraRiga').boundingBox();
  const b = await page.locator('#barraSiti').boundingBox();
  console.log('RIGA', JSON.stringify(r), 'BARRA', JSON.stringify(b));
  await page.mouse.click(r.x + r.width - 20, r.y + r.height / 2, { button: 'right' });
  await page.waitForTimeout(400);
  console.log('MENU DESTRA', JSON.stringify(await page.locator('.dash-menu .dash-menu-voce').allTextContents()));
  await scatta(page, 'destro-riga-vuota');
});
