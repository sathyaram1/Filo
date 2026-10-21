// #1460 — su una finestra bassa (1280×720, il portatile da 1920×1080 al 150%) la colonna destra della home scorre e
// l'orologio, appoggiato al fondo, tagliava a metà le voci di «altro»: restava un pezzo d'icona sopra l'ora. Adesso
// quello che sta sotto sfuma, la sfumatura sparisce in fondo alla colonna e non c'è quando la colonna non scorre.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join('tests', '.shots');

const misura = (page) => page.evaluate(() => {
  const col = document.getElementById('right');
  const sis = document.getElementById('sistema');
  const sfuma = getComputedStyle(sis, '::before');
  const s = sis.getBoundingClientRect();
  const voci = [...document.querySelectorAll('#altro .dash-altro-app')].map((v) => v.getBoundingClientRect());
  return {
    scorre: col.scrollHeight > col.clientHeight + 1,
    inFondo: col.scrollTop + col.clientHeight >= col.scrollHeight - 1,
    // Uno pseudo-elemento che non c'è risponde comunque opacità 1: conta solo se ha un contenuto.
    opacita: sfuma.content === 'none' ? 0 : Number(sfuma.opacity),
    altezza: parseFloat(sfuma.height) || 0,
    // Le voci sotto l'orologio quando la colonna è in fondo: devono stare tutte sopra di lui.
    copertaInFondo: voci.some((r) => r.bottom > s.top + 1 && r.top < s.bottom),
  };
});

async function finestra(app, page, w, h) {
  await app.evaluate(({ BrowserWindow }, d) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(d.w, d.h), { w, h });
  // La home sta sotto la fila delle schede (40 punti): si aspetta che la pagina abbia preso la misura nuova.
  await expect.poll(() => page.evaluate((alta) => Math.abs(window.innerHeight - alta) <= 4, h - 40), { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(300);
}

test('finestra bassa: sotto l\'orologio la colonna sfuma finché c\'è altro, e in fondo si legge tutto', async ({ app, shell }) => {
  const page = await home(app);
  await expect(page.locator('#sistema')).toBeVisible();
  await expect(page.locator('#altro .dash-altro-app').first()).toBeVisible();
  await finestra(app, page, 1280, 720);

  const inCima = await misura(page);
  expect(inCima.scorre, 'a 1280×720 la colonna destra della home deve scorrere: senza, la prova non prova niente').toBe(true);
  expect(inCima.opacita, 'con altro più giù, sopra l\'orologio ci vuole la sfumatura').toBeGreaterThan(0.9);
  expect(inCima.altezza).toBeGreaterThanOrEqual(24);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'home-colonna-bassa-cima.png') });

  await page.locator('#right').evaluate((c) => { c.scrollTop = c.scrollHeight; });
  await expect.poll(async () => (await misura(page)).opacita, { message: 'in fondo alla colonna la sfumatura deve sparire' }).toBeLessThan(0.05);
  const inFondo = await misura(page);
  expect(inFondo.inFondo).toBe(true);
  expect(inFondo.copertaInFondo, 'in fondo alla colonna nessuna voce di «altro» resta sotto l\'orologio').toBe(false);
  await page.screenshot({ path: join(SHOTS, 'home-colonna-bassa-fondo.png') });

  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await page.locator('#right').evaluate((c) => { c.scrollTop = 0; });
  await expect.poll(async () => (await misura(page)).opacita).toBeGreaterThan(0.9);
  await page.screenshot({ path: join(SHOTS, 'home-colonna-bassa-scuro.png') });
});

test('finestra alta: la colonna non scorre e sopra l\'orologio non c\'è nessuna sfumatura', async ({ app }) => {
  const page = await home(app);
  await expect(page.locator('#sistema')).toBeVisible();
  await finestra(app, page, 1280, 960);
  const m = await misura(page);
  expect(m.scorre, 'a 1280×960 la colonna destra sta tutta nella finestra').toBe(false);
  expect(m.opacita, 'senza niente sotto, la sfumatura coprirebbe l\'ultima voce per niente').toBeLessThan(0.05);
});
