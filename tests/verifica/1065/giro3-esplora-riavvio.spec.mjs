// Giro 3 di #1065: una domanda vera alla chat finisce in Cronologia AI e ci resta dopo un riavvio; tolta o svuotata, resta tolta.
import { expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron, test } from '@playwright/test';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const avvia = (userData) => electron.launch({
  args: [...argomentiScala, '.'], cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

async function apriCronologia(app) {
  const shell = await app.firstWindow();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://history')); return !!page; }, { timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('una domanda alla chat resta in Cronologia AI dopo il riavvio; una voce tolta resta tolta', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-1065-g3-');
  let app = await avvia(userData);
  try {
    await modelloFinto(app, [{ text: 'Risposta uno sul museo.' }]);
    let page = await home(app);
    await chiedi(page, 'Domanda-uno sul museo?');
    await expect(page.getByText('Risposta uno sul museo.')).toBeVisible({ timeout: 20_000 });
    await modelloFinto(app, [{ text: 'Risposta due sul treno.' }]);
    await chiedi(page, 'Domanda-due sul treno?');
    await expect(page.getByText('Risposta due sul treno.')).toBeVisible({ timeout: 20_000 });
    await ripristina(app);

    const h = await apriCronologia(app);
    await expect(h.locator('.sn-history-item', { hasText: 'Risposta due sul treno.' })).toHaveCount(1, { timeout: 20_000 });
    await expect(h.locator('.sn-history-item', { hasText: 'Risposta uno sul museo.' })).toHaveCount(1);
    await expect(h.locator('.sn-history-item').first()).toContainText('Risposta due sul treno.');
    await h.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'v1065-g3-cronologia.png') });
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    const s = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    expect(s.aiHistory).toBeUndefined();
  } finally {
    await chiudiApp(app);
  }

  app = await avvia(userData);
  try {
    const h = await apriCronologia(app);
    await expect(h.locator('.sn-history-item', { hasText: 'Risposta due sul treno.' })).toHaveCount(1, { timeout: 20_000 });
    const uno = h.locator('.sn-history-item', { hasText: 'Risposta uno sul museo.' });
    await expect(uno).toHaveCount(1);
    await uno.hover();
    await uno.locator('.sn-history-remove').click();
    await expect(uno).toHaveCount(0);
  } finally {
    await chiudiApp(app);
  }

  app = await avvia(userData);
  try {
    const h = await apriCronologia(app);
    await expect(h.locator('.sn-history-item', { hasText: 'Risposta due sul treno.' })).toHaveCount(1, { timeout: 20_000 });
    await expect(h.locator('.sn-history-item', { hasText: 'Risposta uno sul museo.' })).toHaveCount(0);
    await h.locator('#clear').click();
    await clickConfirm(h, 'ok');
    await expect(h.locator('.sn-history-item')).toHaveCount(0);
  } finally {
    await chiudiApp(app);
  }

  app = await avvia(userData);
  try {
    const h = await apriCronologia(app);
    await expect(h.locator('#empty')).toBeVisible({ timeout: 20_000 });
    await expect(h.locator('.sn-history-item')).toHaveCount(0);
  } finally {
    await chiudiApp(app);
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  }
});
