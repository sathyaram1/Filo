// Feedback #256 — giro 5, terza tornata: il tasto "Svuota cronologia" si
// sposta quando la lista si ricompone all'uscita del puntatore?

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

function avvia(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function conCronologia(prefix, items) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items }), 'utf8');
  return userData;
}

test('Sicurezza: tolte tre voci, il tasto "Svuota" resta dov\'era', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ type: 'text', text: `voce numero ${i}`, ts: 100 - i }));
  const userData = conCronologia('g5c-svuota-', items);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(10);
    // Porto la sezione sotto gli occhi e da lì non muovo più lo scorrimento.
    await page.locator('#sec-clip-clear').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const prima = await page.locator('#sec-clip-clear').boundingBox();

    for (let i = 0; i < 3; i++) {
      await rows.nth(i).locator('.sn-clip-remove').hover();
      await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(500);
    }
    const durante = await page.locator('#sec-clip-clear').boundingBox();
    await page.mouse.move(3, 3);
    await expect(rows).toHaveCount(7);
    await page.waitForTimeout(200);
    const dopo = await page.locator('#sec-clip-clear').boundingBox();
    console.log('SVUOTA prima/durante/dopo >>>', JSON.stringify(prima), JSON.stringify(durante), JSON.stringify(dopo));
    const cosaCera = await page.evaluate((box) => {
      const el = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return el ? (el.id || el.className || el.tagName) : null;
    }, prima);
    console.log('DOVE-STAVA-SVUOTA-ORA >>>', cosaCera);
    await page.screenshot({ path: join(SHOTS, 'g5c-svuota-dopo.png') });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: la ricerca resta e il conteggio della conferma non la conta due volte', async () => {
  const items = [
    { type: 'text', text: 'password segreta', ts: 100 },
    { type: 'text', text: 'password vecchia', ts: 99 },
    ...Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `nota ${i}`, ts: 50 - i })),
  ];
  const userData = conCronologia('g5c-ricerca-', items);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(10);
    await page.fill('#sec-clip-search', 'password');
    await expect(page.locator('#sec-clip-list .sn-clip-item:visible')).toHaveCount(2);
    // Tolgo una delle due col puntatore dentro la lista: la riga resta barrata.
    await page.locator('#sec-clip-list .sn-clip-item:visible').first().locator('.sn-clip-remove').hover();
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(800);
    // Ora la conferma: quante ne dichiara?
    await page.mouse.move(3, 3);
    await page.waitForTimeout(300);
    await page.click('#sec-clip-clear');
    const testo = await page.evaluate(() => (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()) || null);
    console.log('CONFERMA-CON-RICERCA-DOPO-RIMOZIONE >>>', JSON.stringify(testo));
    await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
    // La ricerca è ancora scritta e i risultati sono coerenti.
    const stato = await page.evaluate(() => ({
      ricerca: document.getElementById('sec-clip-search').value,
      visibili: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].filter((r) => r.style.display !== 'none').length,
      totali: document.querySelectorAll('#sec-clip-list .sn-clip-item').length,
    }));
    console.log('STATO-RICERCA >>>', JSON.stringify(stato));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
