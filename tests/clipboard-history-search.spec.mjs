import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback: poter scorrere fra tutto ciò che è stato incollato e, in basso, una
// barra "Cerca…" (grigia) per cercare fra le cose incollate.
//
// Test: pre-carichiamo 20 voci nella cronologia incolla, apriamo il menu del
// tasto destro su un'area editabile, apriamo il sotto-menu della cronologia e
// verifichiamo: lista scorrevole, barra di ricerca con placeholder "Cerca…", e
// che digitando filtra le voci.

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

test('paste history submenu is scrollable and has a working search bar', async ({ testServer }) => {
  const history = [];
  for (let i = 1; i <= 20; i++) {
    history.push({
      type: 'text',
      text: `voce numero ${i} ${i === 7 ? 'ananas speciale' : 'contenuto generico'}`,
      ts: Date.now() - i,
    });
  }
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page, 'la pagina di test deve aprirsi').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    // Apri il menu sull'area editabile (vuota → nessun ramo spellcheck) e poi il
    // sotto-menu della cronologia incolla.
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const arrow = page.locator('.sn-menu-paste-arrow');
    await expect(arrow).toBeVisible();
    await arrow.click();

    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(20);

    // Scrollabilità: con 20 voci il contenuto eccede l'altezza → scrollbar.
    const scrollable = await sub
      .locator('.sn-menu-history-list')
      .evaluate((el) => el.scrollHeight > el.clientHeight + 4);
    expect(scrollable, 'la lista deve essere scorrevole').toBe(true);

    // Barra di ricerca in basso con placeholder grigio "Cerca…".
    const input = page.locator('.sn-menu-history-search-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /Cerca/);

    // Filtro: digitando "ananas" resta solo la voce 7.
    await input.fill('ananas');
    await expect(page.locator('.sn-menu-history-item:visible')).toHaveCount(1);
    await expect(page.locator('.sn-menu-history-item:visible')).toContainText('ananas');

    // Svuotando la ricerca tornano tutte.
    await input.fill('');
    await expect(page.locator('.sn-menu-history-item:visible')).toHaveCount(20);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
