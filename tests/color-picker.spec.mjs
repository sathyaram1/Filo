// #2651 — il Color picker della barra laterale: in Electron il contagocce di sistema risponde subito «annullato», quindi
// Filo sceglie sulla foto della pagina. Qui il contagocce di sistema non si finge: è la strada vera dell'app.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';
import { home } from './helpers/chatFinta.mjs';

// Due metà di colori noti: a sinistra di x=200 verde, a destra arancio.
const PAGINA = `<!doctype html><html><head><title>Colori</title></head><body style="margin:0">
  <div style="position:fixed;left:0;top:0;width:200px;height:100vh;background:#12ab34"></div>
  <div style="position:fixed;left:200px;top:0;right:0;height:100vh;background:#e05a2b"></div></body></html>`;

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

async function apriContagocce(app, page) {
  await premiNellaBarra(app, 'colorPicker');
  const strato = page.locator('.sn-color-overlay');
  await expect(strato).toBeVisible({ timeout: 8000 });
  return strato;
}

test('sulla pagina di un sito il clic copia il colore sotto il puntatore', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(app, 'prima');
  const strato = await apriContagocce(app, page);
  await page.mouse.move(100, 120, { steps: 3 });
  await page.mouse.click(100, 120);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#12AB34');
  await expect(strato).toHaveCount(0);

  await apriContagocce(app, page);
  await page.mouse.click(400, 300);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#E05A2B');
});

test('sulla nuova scheda il contagocce si apre e copia un colore', async ({ app }) => {
  const page = await home(app);
  await scrivi(app, 'prima');
  const strato = await apriContagocce(app, page);
  await page.mouse.click(30, 30);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toMatch(/^#[0-9A-F]{6}$/);
  await expect(strato).toHaveCount(0);
});

test('le frecce spostano di un pixel o di dieci con Maiusc, Invio prende', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(app, 'prima');
  await apriContagocce(app, page);
  await page.mouse.move(195, 100, { steps: 3 });
  // Quattro pixel del dispositivo a destra restano nel verde (anche al 125%); due passi da dieci passano nell'arancio.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#12AB34');

  await apriContagocce(app, page);
  await page.mouse.move(195, 100, { steps: 3 });
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#E05A2B');
});

test('Esc e il tasto destro rinunciano senza toccare gli appunti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await scrivi(app, 'prima');
  let strato = await apriContagocce(app, page);
  await page.mouse.move(100, 100, { steps: 3 });
  await page.keyboard.press('Escape');
  await expect(strato).toHaveCount(0);

  strato = await apriContagocce(app, page);
  await page.mouse.click(100, 100, { button: 'right' });
  await expect(strato).toHaveCount(0);
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);
  await new Promise((r) => setTimeout(r, 500));
  expect(await appunti(app)).toBe('prima');
});

test('lo script del sito non raggiunge la foto della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await apriContagocce(app, page);
  const vista = await page.evaluate(() => {
    const host = document.querySelector('.sn-color-overlay');
    return { canvas: document.querySelectorAll('canvas').length, radice: !!(host && host.shadowRoot) };
  });
  expect(vista).toEqual({ canvas: 0, radice: false });
  await page.keyboard.press('Escape');
});
