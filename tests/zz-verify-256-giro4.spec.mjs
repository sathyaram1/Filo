// Sonda avversariale del verificatore — feedback #256 (giro 4).
// Temporanea: va tolta prima di chiudere il giro.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { CONFIRM_HOST, clickConfirm, confirmText } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';

try { mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true }); } catch (_) {}

async function findTabPage(app, hostname, timeout = 15000) {
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

async function launch(userData) {
  return electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function seed(userData, extra) {
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(extra), 'utf8');
}

async function serve(html) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

// ── 1. Il cammino della segnalazione, dalla pagina che prima non esisteva ────
test('#256 pagina Sicurezza: vedo, cerco, tolgo una voce, svuoto', async () => {
  const SENS = 'password-Hunter2-!@#';
  const LUNGA = 'L'.repeat(10000);
  const items = [
    { type: 'text', text: SENS, ts: 5 },
    { type: 'text', text: '<script>window.__pwn=1</script><img src=x onerror="window.__pwn=2">', ts: 4 },
    { type: 'text', text: 'javascript:window.__pwn=3', ts: 3 },
    { type: 'text', text: '   \n\t   ', ts: 2 },
    { type: 'text', text: '', ts: 1 },
    { type: 'text', text: 'emoji 🐦‍🔥 àèìòù 中文', ts: 6 },
    { type: 'text', text: LUNGA, ts: 7 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'v256-a-'));
  seed(userData, { clipboardHistory: items });
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    expect(page, 'pagina Sicurezza aperta').toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(7);
    await expect(page.locator('#sec-clip-list')).toContainText(SENS);

    // Niente esecuzione di HTML/JS incollato.
    expect(await page.evaluate(() => window.__pwn ?? null)).toBe(null);
    expect(await page.locator('#sec-clip-list').evaluate((n) => n.querySelectorAll('script,img[onerror]').length)).toBe(0);

    // Voce di soli spazi e voce vuota: si capisce cosa sono.
    const testi = await page.locator('#sec-clip-list .sn-clip-text').allInnerTexts();
    expect(testi.some((t) => /spazi/i.test(t)), `etichetta soli-spazi fra: ${JSON.stringify(testi.slice(0, 9))}`).toBe(true);

    // Nessuno sfondamento orizzontale con la voce da 10.000 caratteri.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'la pagina non scorre di lato').toBeLessThanOrEqual(1);

    // Ricerca.
    await page.fill('#sec-clip-search', 'Hunter2');
    await expect(rows.locator('visible=true')).toHaveCount(1);
    await page.fill('#sec-clip-search', 'zzz-non-esiste');
    await expect(page.locator('#sec-clip-noresults')).toBeVisible();
    await page.fill('#sec-clip-search', '');
    await expect(rows.locator('visible=true')).toHaveCount(7);

    // Rimozione puntuale della voce sensibile.
    await rows.filter({ hasText: SENS }).locator('.sn-clip-remove').click();
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#sec-clip-list')).not.toContainText(SENS);

    // Persistenza: ricarica.
    await page.reload();
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);
    await expect(page.locator('#sec-clip-list')).not.toContainText(SENS);

    // Svuota: conferma prima di agire; annullando non cancella niente.
    await page.click('#sec-clip-clear');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    expect(await confirmText(page)).toMatch(/svuot/i);
    await clickConfirm(page, 'cancel');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(6);

    await page.click('#sec-clip-clear');
    await clickConfirm(page, 'ok');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(0);
    await expect(page.locator('#sec-clip-empty')).toBeVisible();
    await expect(page.locator('#sec-clip-clear')).toBeHidden();
    await page.reload();
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(0);
    await expect(page.locator('#sec-clip-empty')).toBeVisible();
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 2. Aggiornamento dal vivo nelle due direzioni (rilievo [1] del giro 3) ───
test('#256 la pagina aperta si riallinea da sola nelle due direzioni', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'v256-b-'));
  seed(userData, { clipboardHistory: [{ type: 'text', text: 'vecchia-voce-A', ts: 1 }] });
  const srv = await serve('<!doctype html><html><body style="padding:40px"><p id="p">testo qualsiasi</p><textarea id="ta" rows="4" cols="40"></textarea></body></html>');
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const sec = await findTabPage(app, 'security');
    await sec.waitForLoadState('domcontentloaded');
    await expect(sec.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1);

    // Seconda scheda su una pagina web: la Sicurezza passa in secondo piano.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });

    // Copia davvero, dal menu del tasto destro sulla selezione.
    await web.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('p'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await web.locator('#p').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    const copia = web.locator('.sn-menu-item', { hasText: /^Copia$/ }).first();
    await copia.click();
    await expect(web.locator('.sn-menu')).toHaveCount(0);

    // La pagina Sicurezza, rimasta aperta in secondo piano, lo mostra da sola.
    await expect(sec.locator('#sec-clip-list')).toContainText('testo qualsiasi', { timeout: 8000 });

    // Direzione opposta: tolgo dal menu "Incolla" e sparisce anche dalla pagina.
    await web.locator('#ta').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await sub.locator('.sn-menu-history-item', { hasText: 'vecchia-voce-A' })
      .locator('.sn-menu-history-remove').click();
    await expect(sec.locator('#sec-clip-list')).not.toContainText('vecchia-voce-A', { timeout: 8000 });

    // E lo svuotamento dal menu lascia la pagina già aperta nello stato vuoto.
    const clearBtn = sub.locator('.sn-menu-history-clear-btn');
    await clearBtn.click();
    await expect(web.locator(CONFIRM_HOST)).toBeVisible();
    await web.evaluate(() => {
      const host = document.querySelector('.sn-confirm-host');
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }).catch(() => {});
    // se l'Enter non basta, chiudi via API interna della pagina non disponibile:
    // in quel caso lo stato resta com'è e l'assert sotto lo dirà.
    await expect(sec.locator('#sec-clip-empty')).toBeVisible({ timeout: 10000 });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── 3. Stress: cronologia piena, doppio clic, tema scuro ─────────────────────
test('#256 cronologia piena, doppio clic, tema scuro', async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ type: 'text', text: `voce numero ${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-c-'));
  seed(userData, { clipboardHistory: many, settings: { theme: 'dark' } });
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(50);

    // La lista scorre dentro il suo riquadro, non allunga la pagina all'infinito.
    const box = await page.locator('#sec-clip-list').evaluate((n) => ({ h: n.clientHeight, s: n.scrollHeight }));
    expect(box.s, 'lista scorrevole').toBeGreaterThan(box.h);

    // Doppio clic rapido sul "Rimuovi": porta via UNA sola voce.
    const target = rows.filter({ hasText: 'voce numero 7' }).first();
    await target.locator('.sn-clip-remove').dblclick({ delay: 10 }).catch(() => {});
    await page.waitForTimeout(1200);
    await expect(rows).toHaveCount(49);

    // Tema scuro: i tasti non devono restare bianchi di serie.
    const colori = await page.evaluate(() => {
      const g = (el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color };
      };
      return {
        tema: document.documentElement.dataset.snTheme || document.documentElement.getAttribute('data-sn-theme'),
        pagina: getComputedStyle(document.body).backgroundColor,
        rimuovi: g(document.querySelector('.sn-clip-remove')),
        svuota: g(document.getElementById('sec-clip-clear')),
        esporta: g(document.getElementById('sec-export-btn')),
        importa: g(document.getElementById('sec-import-btn')),
        ricerca: g(document.getElementById('sec-clip-search')),
      };
    });
    console.log('COLORI TEMA SCURO', JSON.stringify(colori, null, 1));
    await page.screenshot({ path: 'tests/.shots/v256-g4-scuro.png', fullPage: false });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
