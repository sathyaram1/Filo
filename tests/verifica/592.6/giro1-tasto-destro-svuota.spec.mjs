// Verifica #592.6 — giro 1: il tasto destro su una pagina, «Svuota cronologia» degli appunti, fino in fondo.
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confermaSopraPagina } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function apriSotto(page) {
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu-paste-arrow').click();
  const sub = page.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  return sub;
}

test('tasto destro → Svuota cronologia: Annulla lascia tutto, OK svuota davvero', async ({ testServer }) => {
  const history = [
    { type: 'text', text: 'uno', ts: Date.now() - 3000 },
    { type: 'text', text: 'due', ts: Date.now() - 2000 },
  ];
  const userData = cartellaTemporanea('filo-v5926-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');
  const url = testServer.html('<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>');
  const host = new URL(url).hostname;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((p) => { try { return new URL(p.url()).hostname === host; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    let sub = await apriSotto(page);
    await sub.locator('.sn-menu-history-clear-btn').click();
    let vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 700));
    let p = await vista.evaluate(() => window.SN_CONFIRM_UI._test.point('cancel'));
    await vista.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 500));
    expect(await page.locator('.sn-menu').count()).toBeGreaterThan(0);
    if (await page.locator('.sn-menu').count() === 0) sub = await apriSotto(page);
    else if (!(await sub.isVisible())) sub = await apriSotto(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);
    await sub.locator('.sn-menu-history-clear-btn').click();
    vista = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 700));
    p = await vista.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
    await vista.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 800));
    await page.keyboard.press('Escape');
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const frecce = await page.locator('.sn-menu-paste-arrow').count();
    let voci = 0;
    if (frecce) { await page.locator('.sn-menu-paste-arrow').click(); voci = await page.locator('.sn-menu-history-item').count(); }
    expect(voci).toBe(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
