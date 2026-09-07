import { test } from './fixtures/electron.mjs';
import fs from 'node:fs';
const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata.';
const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const fb = (o) => ({ _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: 'x', clientId: o.clientId || 'utente-esterno-1', createdAt: o.at, status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0 });

test('foto della scheda col menu e le date', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', clientId: 'routine:prober', notes: `R.${TURNO}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', clientId: 'owner:pino', notes: `R.${TURNO}${CRIT}${TURNO}${PASS}` }),
    fb({ id: 'c', seq: 3, at: iso(4), status: 'working', clientId: 'routine:new-work' }),
    fb({ id: 'd', seq: 4, at: iso(9), priority: 3 }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), [
    { role: 'prober', startedAt: iso(0), num: '' }, { role: 'verifier', startedAt: iso(1), num: '#1' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  fs.mkdirSync('tests/.shots', { recursive: true });

  await page.locator('#mgStTileRicevuti').click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/496g-menu-tessera.png' });

  await page.keyboard.press('Escape');
  await page.locator('.mg-st-chip[data-window="custom"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-01', '2026-09-07'));
  await page.waitForTimeout(250);
  await page.locator('.mg-st-bar').screenshot({ path: 'tests/.shots/496g-date-echo.png' });

  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.waitForTimeout(250);
  await page.locator('.mg-st-bar').screenshot({ path: 'tests/.shots/496g-date-echo-scuro.png' });
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', ''));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/.shots/496g-senza-date-scuro.png', fullPage: true });
});
