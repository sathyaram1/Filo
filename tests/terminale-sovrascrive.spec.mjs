// #892.2 — un comando che sovrascrive o svuota un file che c'è già chiede prima di partire, scritto a mano nella home
// come proposto da Filo: il contenuto di prima non torna. Sul file nuovo la copia parte come prima, senza domande.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
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

function dueFile() {
  const dir = cartellaTemporanea('filo-892-2-');
  const nuovo = path.join(dir, 'bozza.txt');
  const vecchio = path.join(dir, 'lettera.txt');
  writeFileSync(nuovo, 'testo nuovo');
  writeFileSync(vecchio, 'testo da tenere');
  return { dir, nuovo, vecchio };
}

// `cp` è anche l'alias di Copy-Item in PowerShell: lo stesso comando vale su ogni sistema.
const copia = (da, a) => `cp "${da}" "${a}"`;

test('scritto a mano: la copia sopra un file che c\'è già chiede, quella su un file nuovo parte', async ({ app }) => {
  const { dir, nuovo, vecchio } = dueFile();
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await input.fill(`/${copia(nuovo, vecchio)}`);
  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const st = await confirmState(page);
  expect(st.fuori, 'la domanda dice a parole cosa rischia').toMatch(/sovrascrive/);
  await page.screenshot({ path: 'tests/.shots/892-2-sovrascrive.png' }).catch(() => {});
  await clickConfirm(page, 'cancel');
  expect(readFileSync(vecchio, 'utf8'), 'col no il file resta com\'era').toBe('testo da tenere');

  const terzo = path.join(dir, 'copia.txt');
  await input.fill(`/${copia(nuovo, terzo)}`);
  await input.press('Enter');
  await expect.poll(() => existsSync(terzo), { timeout: 12_000 }).toBe(true);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  // Il comando sopra, col sì: sovrascrive davvero.
  await input.fill(`/${copia(nuovo, vecchio)}`);
  await input.press('Enter');
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect.poll(() => readFileSync(vecchio, 'utf8'), { timeout: 12_000 }).toBe('testo nuovo');
});

test('proposto da Filo: sovrascrivere chiede anche a compito pulito, la copia su un file nuovo no', async ({ app, openTab }) => {
  const { dir, nuovo, vecchio } = dueFile();
  await openTab('filo://newtab/');
  const esegui = (comando) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, {}), { type: 'ESEGUI_COMANDO', comando });

  const sopra = await esegui(copia(nuovo, vecchio));
  expect(sopra.executed, 'senza un sì non parte').toBe(false);
  expect(sopra.needsConfirm, 'chiede prima di partire').toBeTruthy();
  expect(JSON.stringify(sopra.parti || sopra.describe || ''), 'il popup dice perché').toMatch(/sovrascrive/);
  expect(readFileSync(vecchio, 'utf8')).toBe('testo da tenere');

  const terzo = path.join(dir, 'copia.txt');
  const nuova = await esegui(copia(nuovo, terzo));
  expect(nuova.executed, 'una copia su un file nuovo resta una modifica che si rimedia').toBe(true);
  expect(existsSync(terzo)).toBe(true);
});
