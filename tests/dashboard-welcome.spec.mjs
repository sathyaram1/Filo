// Primo avvio: la prima volta in assoluto che Filo viene aperto, la dashboard
// mostra un messaggio di benvenuto come bolla di Filo (feedback alpha). Il
// messaggio NON deve ricomparire alle aperture successive (flag su storage).

import { test, expect } from './fixtures/electron.mjs';

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

test('primo avvio: compare la bolla di benvenuto di Filo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Il benvenuto appare come bolla di Filo nel thread.
  await expect(page.locator('#welcomeBubble')).toBeVisible({ timeout: 10_000 });
  const txt = await page.locator('#welcomeBubble').textContent();
  expect(txt).toContain('Ciao, sono Filo');
  expect(txt).toContain('mi configuro io');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread');
});

test('il benvenuto non ricompare alle aperture successive', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Primo avvio: benvenuto visibile (così il flag su storage viene impostato).
  await expect(page.locator('#welcomeBubble')).toBeVisible({ timeout: 10_000 });

  // Ricarico la stessa dashboard: il flag persistito impedisce la ricomparsa.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.body?.dataset?.state, null, { timeout: 8_000 });
  // Lascio completare l'init (loadDashboard + eventuale welcome).
  await page.waitForTimeout(1_500);

  await expect(page.locator('#welcomeBubble')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});
