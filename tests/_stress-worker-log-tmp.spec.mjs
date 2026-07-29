import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';

test('stress: XSS/emoji/huge/malformed non rompono e non eseguono script', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);

  let dialogFired = false;
  page.on('dialog', (d) => { dialogFired = true; d.dismiss().catch(() => {}); });

  const entries = [
    { role: '<script>window.__xss=1;alert(1)</script>', startedAt: '2026-07-29T10:00:00.000Z', num: '<img src=x onerror=alert(2)>' },
    { role: 'verifier', startedAt: 'not-a-date', num: '374' },
    { role: 'fixer', startedAt: '', num: '' },
    { role: '😀🔥 '.repeat(20), startedAt: '2026-07-29T09:00:00.000Z', num: '9'.repeat(500) },
    { role: '   ', startedAt: '2026-07-29T08:00:00.000Z', num: '' },
  ];
  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate((e) => window.__mgTest.renderWorkerLog(e), entries);

  const rows = page.locator('#mgLogList .mg-log-row');
  await expect(rows).toHaveCount(5);

  // Nessuno script iniettato è stato eseguito.
  const xss = await page.evaluate(() => window.__xss || false);
  expect(xss).toBeFalsy();
  expect(dialogFired).toBeFalsy();
  // Nessun <script>/<img> reale creato dentro le righe (tutto testo escapato).
  const injected = await page.locator('#mgLogList script, #mgLogList img').count();
  expect(injected).toBe(0);
  // Lo script XSS compare come TESTO nel ruolo.
  await expect(rows.nth(0).locator('.mg-log-role')).toContainText('<script>');

  // startedAt malformato → tempo "—", nessuna data assoluta (title vuoto o —).
  const when1 = await rows.nth(1).locator('.mg-log-when').textContent();
  expect((when1 || '').trim()).toContain('—');

  // Ruolo di soli spazi → non vuoto (ripiego "Sconosciuto").
  const role4 = (await rows.nth(4).locator('.mg-log-role').textContent() || '').trim();
  expect(role4.length).toBeGreaterThan(0);

  // Riapertura rapida della tab non rompe (ricarica idempotente).
  for (let i = 0; i < 4; i++) {
    await page.click('.mg-tab[data-tab="inbox"]');
    await page.click('.mg-tab[data-tab="log"]');
  }
  await expect(page.locator('#panel-log')).toHaveClass(/mg-panel--active/);

  await page.evaluate((e) => window.__mgTest.renderWorkerLog(e), entries);
  await page.screenshot({ path: 'tests/.shots/worker-log-stress.png' });
});
