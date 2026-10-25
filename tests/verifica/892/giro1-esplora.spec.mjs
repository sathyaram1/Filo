// Verifica #892.1, giro 1: esplorazione delle porte dei comandi scritti a mano nella home.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

async function home(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

function bersaglio() {
  const dir = cartellaTemporanea('filo-v892-');
  const b = path.join(dir, 'da-cancellare');
  mkdirSync(b);
  writeFileSync(path.join(b, 'dentro.txt'), 'x');
  return b;
}

test('esplora: varianti di cancellazione passano dai livelli', async ({ app }) => {
  const page = await home(app);
  const b = bersaglio();
  const varianti = [
    `rm -rf "${b}"`,
    `echo ok && rm -rf "${b}"`,
    `echo ok; rm -rf "${b}"`,
    `echo ok\nrm -rf "${b}"`,
    `echo "${b}" | xargs rm -rf`,
    `find "${b}" -delete`,
    `sh -c 'rm -rf "${b}"'`,
    `bash -c "rm -rf ${b}"`,
    `$(echo rm) -rf "${b}"`,
    `echo ciao`,
  ];
  const esiti = [];
  for (const command of varianti) {
    const v = await page.evaluate((c) => window.filo.shellVaglia({ command: c, cwd: '', shell: window.SN_DASH_TERMINALE.getShell() }), command);
    esiti.push({ command, risposta: v && v.risposta, digita: v && v.digita });
  }
  console.log(JSON.stringify(esiti, null, 1));
});

test('esplora: doppio Invio su un comando incollato', async ({ app }) => {
  const page = await home(app);
  const dir = cartellaTemporanea('filo-v892-');
  const f = path.join(dir, 'conta.txt');
  writeFileSync(f, '');
  const input = page.locator('#input');
  await input.fill(`/echo riga >> "${f}"`);
  await input.press('Enter');
  await input.press('Enter');
  await page.waitForTimeout(4000);
  const righe = readFileSync(f, 'utf8').split('\n').filter(Boolean).length;
  const bolle = await page.locator('.dash-term-cmd').count();
  const popup = await page.locator(CONFIRM_HOST).count();
  console.log(JSON.stringify({ righe, bolle, popup }));
});

test('esplora: popup di conferma in tema chiaro e scuro', async ({ app }) => {
  const page = await home(app);
  const b = bersaglio();
  await page.locator('#input').fill(`/rm -rf "${b}"`);
  await page.locator('#input').press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  console.log(JSON.stringify(await confirmState(page)));
  await page.screenshot({ path: 'tests/.shots/v892-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v892-scuro.png' });
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
});
