// Sonde del giro 3 di #941.1: avviso di via in tema scuro, home già aperta, pagina Download, due file insieme.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');
const GROSSO = 4 * 1024 * 1024;

async function apriServerLento() {
  const inCorso = new Map();
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'grosso.bin';
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': GROSSO, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.write(Buffer.alloc(64 * 1024, 1));
    inCorso.set(nome, res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    finisci(nome) { const res = inCorso.get(nome); inCorso.delete(nome); res && res.end(Buffer.alloc(GROSSO - 64 * 1024, 1)); },
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}
const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};
const via = (dove, nome) => dove.locator('.shell-notif-msg', { hasText: `Scaricamento avviato: ${nome}` });

test('tema scuro, home già aperta: «Vedi nella home» la riattiva senza aprirne una seconda', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { sender: null }));
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="a" href="${srv.base}/uno.bin">uno</a></body></html>`);
    const homePrima = await shell.locator('#tabs .tab', { hasText: 'Home' }).count();
    await page.locator('#a').click();
    const vista = await avvisi();
    await expect(via(vista, 'uno.bin')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await vista.screenshot({ path: join(SHOTS, 'g3-941.1-scuro.png') });
    await vista.locator('.shell-notif-action', { hasText: 'Vedi nella home' }).click();
    await expect(shell.locator('#tabs .tab.active')).toContainText('Home');
    expect(await shell.locator('#tabs .tab', { hasText: 'Home' }).count()).toBe(Math.max(1, homePrima));
    srv.finisci('uno.bin');
  } finally { await srv.close(); }
});

test('sulla pagina Download niente avviso di via; due file insieme da una pagina, due avvisi, uno finisce e solo il suo cambia', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="a" href="${srv.base}/due.bin">due</a><a id="b" href="${srv.base}/tre.bin">tre</a><a id="c" href="${srv.base}/quattro.bin">quattro</a></body></html>`);
    await page.locator('#a').click();
    await page.locator('#b').click();
    const vista = await avvisi();
    await expect(via(vista, 'due.bin')).toBeVisible({ timeout: 10_000 });
    await expect(via(vista, 'tre.bin')).toBeVisible({ timeout: 10_000 });
    srv.finisci('due.bin');
    await expect.poll(() => statoDi(shell, 'due.bin'), { timeout: 20_000 }).toBe('completed');
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Scaricato: due.bin' })).toHaveCount(1, { timeout: 8000 });
    await expect(via(vista, 'tre.bin')).toHaveCount(1);
    await vista.screenshot({ path: join(SHOTS, 'g3-941.1-due.png') });

    await shell.evaluate(() => window.filoShell.tabs.open('filo://downloads/downloads.html'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById('c').click());
    await expect.poll(() => statoDi(shell, 'quattro.bin'), { timeout: 20_000 }).toBe('progressing');
    await page.waitForTimeout(2000);
    await expect(via(vista, 'quattro.bin')).toHaveCount(0);
    srv.finisci('tre.bin'); srv.finisci('quattro.bin');
  } finally { await srv.close(); }
});
