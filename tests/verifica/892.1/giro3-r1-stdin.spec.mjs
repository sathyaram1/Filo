// #892.1 giro 3 — r1: una riga scritta nella casella «Invio testo al comando…» mentre gira un comando che non legge
// lo stdin finisce alla shell quando il comando finisce, e parte senza passare dai livelli.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
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

test.skip(process.platform === 'win32', 'la shell POSIX legge i comandi dalla stessa pipe dello stdin');

test('r1 una cancellazione scritta nella casella dello stdin non parte senza chiedere', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-1-g3-');
  const bersaglio = path.join(dir, 'da-cancellare-g3');
  mkdirSync(bersaglio);
  writeFileSync(path.join(bersaglio, 'dentro.txt'), 'x');
  // Un comando di sola lettura nella cartella personale che dura finché non gli si scrive: come `du -sh ~` su un disco grande.
  const casa = path.join(os.homedir(), `filo-892-1-g3-${process.pid}`);
  mkdirSync(casa, { recursive: true });
  const tubo = path.join(casa, 'tubo');
  if (!existsSync(tubo)) execFileSync('mkfifo', [tubo]);
  try {
    const page = await newtabPage(app);
    await page.locator('#input').fill(`/cat "${tubo}"`);
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-term-stdin')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(CONFIRM_HOST), 'una lettura parte senza domande').toHaveCount(0);

    await page.locator('.dash-term-stdin').fill(`rm -rf "${bersaglio}"`);
    await page.locator('.dash-term-stdin').press('Enter');
    writeFileSync(tubo, 'fine\n');
    await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });
    await page.waitForTimeout(2_000);
    const chiesto = await page.locator(CONFIRM_HOST).count();
    expect(existsSync(bersaglio) || chiesto > 0, 'la cartella c\'è ancora, o Filo ha chiesto prima di cancellarla').toBe(true);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
