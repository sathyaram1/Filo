// Feedback #256 — giro 5: il puntatore lasciato FERMO sulla lista mentre si
// cambia scheda. La lista si congela per non muoversi sotto la mano: tornando
// sulla scheda, l'utente capisce che sta guardando una lista vecchia?

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const SHOTS = join(APP_ROOT, 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

async function findTabPage(app, hostname, timeout = 20000) {
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

test('Sicurezza: puntatore fermo sulla lista, la voce nuova aspetta ma lo dice', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'g5e-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    clipboardHistory: Array.from({ length: 6 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i })),
  }), 'utf8');
  const app = await electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);
    // Il puntatore resta fermo sulla lista.
    await page.locator('#sec-clip-list .sn-clip-item').nth(1).hover();
    await page.waitForTimeout(200);
    // Copia fatta altrove.
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'password-nuova-XYZ' },
    }));
    await page.waitForTimeout(800);
    const stato = await page.evaluate(() => ({
      righe: document.querySelectorAll('#sec-clip-list .sn-clip-item').length,
      contieneNuova: document.getElementById('sec-clip-list').textContent.includes('password-nuova-XYZ'),
      avviso: (() => { const e = document.getElementById('sec-clip-pending'); return e.style.display !== 'none' ? e.textContent : null; })(),
    }));
    console.log('PUNTATORE-FERMO >>>', JSON.stringify(stato));
    expect(stato.avviso).toBeTruthy();
    await page.screenshot({ path: join(SHOTS, 'g5e-avviso-in-attesa.png') });

    // Ora l'utente esce dalla lista SENZA muovere il mouse: cambia scheda.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await page.waitForTimeout(700);
    await shell.evaluate(async () => {
      const st = await window.filoShell.tabs.getState();
      const sec = st.tabs.find((t) => String(t.url).includes('security'));
      if (sec) window.filoShell.tabs.activate(sec.id);
    });
    await page.waitForTimeout(1200);
    const dopo = await page.evaluate(() => ({
      righe: document.querySelectorAll('#sec-clip-list .sn-clip-item').length,
      contieneNuova: document.getElementById('sec-clip-list').textContent.includes('password-nuova-XYZ'),
      avviso: (() => { const e = document.getElementById('sec-clip-pending'); return e.style.display !== 'none' ? e.textContent : null; })(),
    }));
    console.log('DOPO-RITORNO-SCHEDA >>>', JSON.stringify(dopo));
    await page.screenshot({ path: join(SHOTS, 'g5e-dopo-ritorno.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
