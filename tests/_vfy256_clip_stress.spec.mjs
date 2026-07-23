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

test('VFY256 stress: clear-through vuota davvero, stato vuoto, XSS reso come testo, testo lungo troncato', async ({ testServer }) => {
  const XSS = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">';
  const LONG = 'A'.repeat(10000);
  const history = [
    { type: 'text', text: XSS, ts: Date.now() - 4000 },
    { type: 'text', text: LONG, ts: Date.now() - 3000 },
    { type: 'text', text: 'voce normale', ts: Date.now() - 2000 },
    { type: 'text', text: '   ', ts: Date.now() - 1000 }, // soli spazi
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-vfy-'));
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

    // (A) XSS: la voce con <script> non deve eseguire codice: il flag resta undefined.
    let sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);
    const pwned = await page.evaluate(() => window.__pwned);
    expect(pwned, 'nessuno script della cronologia deve eseguirsi').toBeFalsy();
    // e non deve esserci un vero <script>/<img> iniettato dentro il menu
    const injected = await sub.locator('script, img[src="x"]').count();
    expect(injected).toBe(0);

    // (B) Testo lungo: la riga esiste ma l'etichetta è troncata (non 10000 char a schermo).
    const longRow = sub.locator('.sn-menu-history-item .sn-menu-label').filter({ hasText: 'AAAA' });
    const shown = await longRow.first().textContent();
    expect(shown.length, 'il testo lungo deve essere troncato').toBeLessThan(60);

    // (C) Rimuovi voci fino all'ultima → deve comparire lo STATO VUOTO.
    let removes = sub.locator('.sn-menu-history-remove');
    let n = await removes.count();
    for (let i = 0; i < n; i++) {
      await sub.locator('.sn-menu-history-remove').first().click();
    }
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(0);
    // Stato vuoto: la riga "Cronologia appunti vuota" è visibile (non un riquadro vuoto).
    await expect(sub.locator('.sn-menu-empty:visible')).toHaveText(/vuota/i);

    // Persistenza: riaprendo, la cronologia è vuota (le rimozioni sono state salvate).
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    let stored = await shell.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'get_clipboard_history' });
      return r.items.length;
    });
    expect(stored, 'dopo aver rimosso tutte le voci lo storage è vuoto').toBe(0);

    // (D) Ricarica cronologia e verifica il CLEAR completo (conferma → svuota davvero).
    await shell.evaluate(async (h) => {
      for (const e of h) await chrome.runtime.sendMessage({ type: 'push_clipboard_entry', entry: e });
    }, [{ type: 'text', text: 'uno' }, { type: 'text', text: 'due' }, { type: 'text', text: 'tre' }]);

    sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);
    const clearBtn = sub.locator('.sn-menu-history-clear-btn');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    // Azione distruttiva: DEVE comparire il dialogo di conferma (guardia anti-perdita).
    const confirmHost = page.locator(CONFIRM_HOST);
    await expect(confirmHost).toBeVisible();
    // (Il dialogo è in shadow DOM chiuso, non cliccabile dalla pagina web: la
    // conferma→clear end-to-end la copre lo spec interno. Qui verifico che
    // l'operazione di svuotamento, una volta confermata, azzeri DAVVERO lo storage
    // — è la cosa che l'utente voleva: la cronologia sparisce sul serio.)
    await page.keyboard.press('Escape');
    const clearedLen = await shell.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'clear_clipboard_history' });
      const r = await chrome.runtime.sendMessage({ type: 'get_clipboard_history' });
      return r.items.length;
    });
    expect(clearedLen, 'svuota cronologia azzera davvero lo storage').toBe(0);

    await page.screenshot({ path: 'tests/.shots/vfy256-clip-stress.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
