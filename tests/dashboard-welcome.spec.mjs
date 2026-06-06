// Primo avvio: la prima volta in assoluto che Filo viene aperto, la dashboard
// mostra un messaggio di benvenuto di Filo al centro della home (feedback alpha).
// Il messaggio NON deve ricomparire alle aperture successive (flag su storage).

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

test('primo avvio: la home mostra il messaggio di benvenuto di Filo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  const msg = page.locator('#homeMessage');
  await expect(msg).toBeVisible({ timeout: 10_000 });
  await expect(msg).toHaveAttribute('data-welcome', '1', { timeout: 10_000 });
  const txt = await msg.textContent();
  expect(txt).toContain('Ciao, sono Filo');
  expect(txt).toContain('mi configuro io');
  // Resta in stato home: il benvenuto non deve far saltare la dashboard nel thread.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});

test('il benvenuto non ricompare alle aperture successive', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Primo avvio: benvenuto visibile (così il flag su storage viene impostato).
  await expect(page.locator('#homeMessage')).toHaveAttribute('data-welcome', '1', { timeout: 10_000 });

  // Ricarico la stessa dashboard: il flag persistito impedisce la ricomparsa.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => document.getElementById('homeMessage')
      && !document.getElementById('homeMessage').classList.contains('dash-home-msg-loading'),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);

  const msg = page.locator('#homeMessage');
  await expect(msg).not.toHaveAttribute('data-welcome', '1');
  const txt = (await msg.textContent()) || '';
  expect(txt).not.toContain('Ciao, sono Filo');
});
