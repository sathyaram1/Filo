import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Audit: la cronologia degli appunti non ha un modo per rimuovere singole voci.
// L'utente può aprire la cronologia, cercare, e incollare una voce — ma non
// cancellarla. Unico handler disponibile è CLEAR_CLIPBOARD_HISTORY (tutto o
// niente), e non è accessibile da nessuna parte dell'UI.
//
// Questo test verifica lo stato ATTUALE: nella cronologia non c'è né un bottone
// di rimozione né un'azione alternativa per eliminare una singola voce.

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

test('clipboard history has no way to remove a single entry', async ({ testServer }) => {
  // Pre-carichiamo 3 voci nella cronologia (simula: l'utente ha copiato testi
  // in precedenza, tra cui uno potenzialmente sensibile).
  const history = [
    { type: 'text', text: 'testo sensibile che vorrei rimuovere', ts: Date.now() - 3000 },
    { type: 'text', text: 'secondo testo generico', ts: Date.now() - 2000 },
    { type: 'text', text: 'terzo testo normale', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-audit-clip-'));
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

    // Apri il menu contestuale sull'area editabile e poi il sotto-menu cronologia.
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const arrow = page.locator('.sn-menu-paste-arrow');
    await expect(arrow).toBeVisible();
    await arrow.click();

    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();

    // Le 3 voci devono essere presenti.
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);

    // VERIFICA DEL PROBLEMA: non esiste nessun pulsante o elemento per
    // rimuovere una singola voce dalla cronologia. Ci sono solo bottoni
    // per incollarla (click sul testo) — nessun "×", "rimuovi", trash icon ecc.
    const removeButtons = sub.locator('[data-remove], .sn-remove, .sn-delete, [aria-label*="rimuovi"], [aria-label*="remove"], [aria-label*="elimina"]');
    await expect(removeButtons).toHaveCount(0);

    // Verifica aggiuntiva: nessun contesto di tasto destro sulle singole voci
    // offre la rimozione — non lo testiamo interattivamente ma verifichiamo che
    // i bottoni history non abbiano handler 'contextmenu' personalizzati registrati
    // (indicatore assenza feature).
    const hasContextMenu = await sub.locator('.sn-menu-history-item').first().evaluate((el) => {
      // In mancanza di handler esplicito, il contextmenu bubbles al default.
      // Se c'è un handler specifico per rimozione, sarebbe registrato nell'element.
      const listeners = el._snContextMenu || el.dataset.snRemovable;
      return !!listeners;
    });
    expect(hasContextMenu, 'nessun handler di rimozione registrato sulle voci').toBe(false);

    // Screenshot come prova visiva.
    await page.screenshot({ path: 'tests/.shots/audit-clipboard-no-remove.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
