import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRM_HOST } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function openHistorySubmenu(page) {
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const arrow = page.locator('.sn-menu-paste-arrow');
  await expect(arrow).toBeVisible();
  await arrow.click();
  const sub = page.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  return sub;
}

test('stress: XSS non esegue, rimuovere ultima voce mostra stato vuoto, annulla svuota mantiene', async ({ testServer }) => {
  const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=1<\/script>';
  const LONG = 'A'.repeat(10000);
  const history = [
    { type: 'text', text: XSS, ts: Date.now() - 4000 },
    { type: 'text', text: LONG, ts: Date.now() - 3000 },
    { type: 'image', dataUrl: 'data:image/png;base64,AAAA', description: 'immagine test', ts: Date.now() - 2000 },
    { type: 'text', text: 'ultima', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-stress-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page).toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    let sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);

    // XSS: nessuno script eseguito, nessun <img> vero iniettato nel sotto-menu.
    expect(await page.evaluate(() => window.__xss)).toBeFalsy();
    expect(await sub.locator('img').count()).toBe(0);
    // Il testo XSS è mostrato come testo letterale (troncato), non interpretato.
    await expect(sub).toContainText('<img');

    // Rimuovi le 4 voci una per una; all'ultima compare lo stato "vuoto".
    for (let i = 0; i < 4; i++) {
      await sub.locator('.sn-menu-history-remove').first().click();
    }
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(0);
    await expect(sub.locator('.sn-menu-empty')).toBeVisible();
    // La barra di ricerca e "Svuota" spariscono quando non c'è più nulla.
    await expect(sub.locator('.sn-menu-history-clear-btn')).toHaveCount(0);

    // Persistenza: riaprendo, la cronologia è davvero vuota.
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-empty')).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('stress: annulla nel dialogo "Svuota" NON cancella la cronologia', async ({ testServer }) => {
  const history = [
    { type: 'text', text: 'resta-1', ts: Date.now() - 2000 },
    { type: 'text', text: 'resta-2', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-cancel-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');
  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;
  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    let sub = await openHistorySubmenu(page);
    await sub.locator('.sn-menu-history-clear-btn').click();
    const confirm = page.locator(CONFIRM_HOST);
    await expect(confirm).toBeVisible();
    // Annulla.
    await page.locator(`${CONFIRM_HOST} button`, { hasText: 'Annulla' }).click();
    // La cronologia resta intatta: riapri e conta 2.
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
