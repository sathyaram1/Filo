// #1489: i tasti in fondo al campo della home (microfono, invio, quadrato che ferma) stanno al centro della
// pastiglia, alla stessa distanza da sopra, da sotto e dal bordo destro; con più righe restano sull'ultima.

import { test, expect } from './fixtures/electron.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

function misura(page, selTasto) {
  return page.evaluate((sel) => {
    const r = (el) => el.getBoundingClientRect();
    const wrap = r(document.getElementById('inputForm'));
    const tasto = r(document.querySelector(sel));
    const campo = r(document.getElementById('input'));
    const mic = document.querySelector('#inputForm .sn-voce-btn:not([hidden])');
    const m = mic ? r(mic) : null;
    return {
      sopra: tasto.top - wrap.top,
      sotto: wrap.bottom - tasto.bottom,
      destra: wrap.right - tasto.right,
      centroTasto: tasto.top + tasto.height / 2,
      centroMic: m ? m.top + m.height / 2 : null,
      centroCampo: campo.top + campo.height / 2,
      centroWrap: wrap.top + wrap.height / 2,
      altezzaWrap: wrap.height,
    };
  }, selTasto);
}

test('microfono e invio stanno al centro della pastiglia, e ci restano con più righe', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#inputForm .sn-voce-btn')).toBeVisible({ timeout: 8_000 });

  const vuota = await misura(page, '#sendBtn');
  expect(Math.abs(vuota.sopra - vuota.sotto), JSON.stringify(vuota)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(vuota.destra - vuota.sotto), JSON.stringify(vuota)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(vuota.centroMic - vuota.centroTasto)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(vuota.centroCampo - vuota.centroWrap)).toBeLessThanOrEqual(0.5);

  await input.click();
  await page.keyboard.type('riga uno');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('riga due');
  const dueRighe = await misura(page, '#sendBtn');
  expect(dueRighe.altezzaWrap).toBeGreaterThan(vuota.altezzaWrap);
  expect(Math.abs(dueRighe.sotto - vuota.sotto)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(dueRighe.destra - vuota.destra)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(dueRighe.centroMic - dueRighe.centroTasto)).toBeLessThanOrEqual(0.5);

  // Il quadrato che ferma prende il posto dell'invio: stessa misura, stesso centro.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.evaluate(() => {
    document.getElementById('sendBtn').hidden = true;
    document.getElementById('stopBtn').hidden = false;
  });
  const ferma = await misura(page, '#stopBtn');
  expect(Math.abs(ferma.sopra - ferma.sotto), JSON.stringify(ferma)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(ferma.destra - ferma.sotto), JSON.stringify(ferma)).toBeLessThanOrEqual(0.5);

  await page.evaluate(() => {
    document.getElementById('sendBtn').hidden = false;
    document.getElementById('stopBtn').hidden = true;
  });
  await page.locator('#inputForm').screenshot({ path: join(SHOTS, '1489-campo-home.png') });
});
