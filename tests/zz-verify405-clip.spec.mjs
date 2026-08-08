// VERIFIER #405 — "dentro il riquadro … non c'è «Incolla» con la cronologia
// degli appunti". Cronologia pre-caricata su storage (come fa clipboard-history-*),
// poi confronto RIQUADRO vs PAGINA.

import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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

async function frameByUrl(page, url) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const f = page.frames().find((x) => x.url() === url && x !== page.mainFrame());
    if (f) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('frame non trovato: ' + url);
}

test('#405 cronologia degli appunti: dentro il riquadro come sulla pagina', async () => {
  const history = [];
  for (let i = 1; i <= 20; i++) {
    history.push({ type: 'text', text: `voce numero ${i} ${i === 7 ? 'ananas speciale' : 'contenuto generico'}`, ts: Date.now() - i });
  }
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip405-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  // mini server
  const pages = new Map();
  const server = createServer((req, res) => {
    const id = req.url.replace(/^\//, '').split('?')[0];
    const html = pages.get(id);
    if (!html) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const childUrl = `http://127.0.0.1:${port}/child`;
  pages.set('child', `<!doctype html><body style="margin:0;padding:20px">
    <p id="ptext">testo dentro il riquadro</p>
    <textarea id="pta" rows="4" cols="50"></textarea></body>`);
  const parentUrl = `http://127.0.0.1:${port}/parent`;
  pages.set('parent', `<!doctype html><body style="margin:0;padding:20px">
    <textarea id="mta" rows="3" cols="50"></textarea>
    <iframe id="f" src="${childUrl}" width="620" height="300"></iframe></body>`);

  const app = await electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), parentUrl);
    const page = await findTabPage(app, '127.0.0.1');
    expect(page, 'pagina di test aperta').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    // --- CONTROLLO: sulla pagina ---
    await page.locator('#mta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.locator('.sn-menu-paste-arrow').click();
    await expect(page.locator('.sn-menu-history-sub')).toBeVisible();
    const nOut = await page.locator('.sn-menu-history-sub .sn-menu-history-item').count();
    console.log('[CLIP fuori] voci=' + nOut);
    expect(nOut).toBe(20);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // --- DENTRO IL RIQUADRO ---
    const fr = await frameByUrl(page, childUrl);
    await fr.locator('#ptext').click();          // sveglia Filo nel riquadro
    await page.waitForTimeout(500);
    await fr.locator('#pta').click();
    await fr.locator('#pta').click({ button: 'right' });
    await expect(fr.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
    const arrow = fr.locator('.sn-menu-paste-arrow');
    await expect(arrow, 'nessuna freccetta cronologia nel campo dentro il riquadro').toBeVisible();
    await arrow.click();

    const sub = fr.locator('.sn-menu-history-sub');
    await expect(sub, 'la cronologia non si apre dentro il riquadro').toBeVisible({ timeout: 6000 });
    const nIn = await sub.locator('.sn-menu-history-item').count();
    console.log('[CLIP dentro] voci=' + nIn);
    expect(nIn, 'la cronologia dentro il riquadro mostra meno voci che sulla pagina').toBe(20);

    // Ricerca funzionante anche dentro il riquadro
    const input = fr.locator('.sn-menu-history-search-input');
    await expect(input).toBeVisible();
    await input.fill('ananas');
    await expect(fr.locator('.sn-menu-history-item:visible')).toHaveCount(1);

    // Incollare davvero dalla cronologia dentro il riquadro
    await fr.locator('.sn-menu-history-item:visible .sn-menu-history-paste').first().click();
    await page.waitForTimeout(900);
    const val = await fr.locator('#pta').inputValue();
    console.log('[CLIP dentro] incollato="' + val + '"');
    expect(val, 'la voce scelta non è finita nel campo dentro il riquadro').toContain('ananas');
  } finally {
    try { await app.close(); } catch (_) {}
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    rmSync(userData, { recursive: true, force: true });
  }
});
