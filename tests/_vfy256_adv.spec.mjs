import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verifier adversariale #256: cronologia appunti gestibile.
// Copre i buchi non coperti dallo spec committato: stato "vuoto" dopo aver
// rimosso l'ultima voce, sicurezza XSS del testo mostrato, troncamento del
// testo lungo, e rimozione di una voce immagine.

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

test('cronologia appunti: XSS-safe, troncamento, immagine, stato vuoto finale', async ({ testServer }) => {
  const XSS = '<img src=x onerror="window.__pwned=1">payload';
  const LONG = 'A'.repeat(10000);
  const EMOJI = '🔥ciao😀 secret 中文';
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const history = [
    { type: 'text', text: XSS, ts: Date.now() - 4000 },
    { type: 'text', text: LONG, ts: Date.now() - 3000 },
    { type: 'text', text: EMOJI, ts: Date.now() - 2000 },
    { type: 'image', dataUrl: TINY_PNG, description: 'foto privata', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-vfy256-'));
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
    expect(page, 'la pagina di test deve aprirsi').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    let sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);

    // (A) XSS: il testo ostile è mostrato come testo, non interpretato: nessun
    // <img> figlio della lista e nessun onerror eseguito.
    await expect(sub.locator('.sn-menu-history-list img')).toHaveCount(0);
    const pwned = await page.evaluate(() => window.__pwned || null);
    expect(pwned, 'lo script della voce ostile NON deve eseguirsi').toBe(null);
    // Il markup ostile è mostrato come testo letterale (le parentesi angolari
    // compaiono nell'etichetta, non vengono interpretate come tag).
    await expect(sub).toContainText('<img src=x');

    // (B) Troncamento: la voce lunga 10k non deborda; l'etichetta mostra "…" e
    // resta corta.
    const longLabelLen = await sub
      .locator('.sn-menu-history-paste .sn-menu-label')
      .nth(1)
      .evaluate((el) => el.textContent.length);
    expect(longLabelLen).toBeLessThanOrEqual(41); // 40 char + ellissi

    // (C) L'immagine ha la sua "×" (4 voci → 4 pulsanti di rimozione).
    await expect(sub.locator('.sn-menu-history-remove')).toHaveCount(4);
    // Rimuovi la voce immagine: sparisce e resta rimossa (riletta dallo storage).
    const imgRow = sub.locator('.sn-menu-history-item', { hasText: 'foto privata' });
    await expect(imgRow).toHaveCount(1);
    await imgRow.locator('.sn-menu-history-remove').click();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);

    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);
    await expect(sub).not.toContainText('foto privata');

    // (D) Rimuovi TUTTE le voci rimaste una a una: alla fine compare lo stato
    // "vuoto" e spariscono ricerca + "Svuota cronologia".
    for (let i = 0; i < 3; i++) {
      await sub.locator('.sn-menu-history-remove').first().click();
    }
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(0);
    await expect(sub.getByText('Cronologia appunti vuota')).toBeVisible();
    await expect(sub.locator('.sn-menu-history-search')).toBeHidden();
    await expect(sub.locator('.sn-menu-history-clear')).toBeHidden();

    // (E) Persistenza dello svuotamento a mano: riaprendo, cronologia vuota.
    // Quando è vuota il sotto-menu mostra solo lo stato "vuoto" (senza lista),
    // quindi apriamo genericamente e verifichiamo il messaggio.
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.locator('.sn-menu-paste-arrow').click();
    await expect(page.locator('.sn-menu-sub')).toBeVisible();
    await expect(page.locator('.sn-menu-sub .sn-menu-history-item')).toHaveCount(0);
    await expect(page.locator('.sn-menu-sub').getByText('Cronologia appunti vuota')).toBeVisible();

    await page.screenshot({ path: 'tests/.shots/vfy256-adv.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
