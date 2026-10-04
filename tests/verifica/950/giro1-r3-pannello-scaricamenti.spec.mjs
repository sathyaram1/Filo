// Verifica #950, giro 1, rilievo 3: il pannello degli scaricamenti in alto (l'indicatore) elenca il file appena
// scaricato; il tasto destro su quella riga offre «Dai un nome sensato», e la scelta porta al file rinominato.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function voceDelMenu(app, testo) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      const voce = popup.locator('.menu .item', { hasText: testo });
      try { if (await voce.count()) return voce; } catch (_) { /* popup che si sta chiudendo */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('tasto destro su un file nel pannello degli scaricamenti → «Dai un nome sensato» → file rinominato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => (
      { text: 'Bolletta luce Enel marzo 2026', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
  const corpo = Buffer.from('Bolletta luce Enel marzo 2026\nTotale 54,20 euro\n');
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': corpo.length, 'Content-Disposition': 'attachment; filename="scan_00231.txt"' });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/scan_00231.txt`;
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      rec = ((r && r.items) || []).find((it) => it.url === url) || null;
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');

    if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
    await expect(shell.locator('#dl-panel')).toBeVisible({ timeout: 10000 });
    const riga = shell.locator('#dl-panel .dl-row', { hasText: 'scan_00231.txt' });
    await expect(riga).toBeVisible();
    await riga.click({ button: 'right' });
    const voce = await voceDelMenu(app, 'Dai un nome sensato');
    expect(voce, 'il tasto destro sulla riga offre «Dai un nome sensato»').not.toBeNull();
    await voce.click();

    const dl = app.windows().find((w) => w.url().startsWith('filo://downloads/'))
      || await app.waitForEvent('window', { predicate: (w) => w.url().startsWith('filo://downloads/'), timeout: 10000 }).catch(() => null);
    let pagina = dl;
    if (!pagina) {
      await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://downloads/')), { timeout: 10000 }).toBe(true);
      pagina = app.windows().find((w) => w.url().startsWith('filo://downloads/'));
    }
    await expect(pagina.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel marzo 2026', { timeout: 15000 });
    await pagina.locator('.sn-rinomina-ok').click();
    await expect(pagina.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Bolletta luce Enel marzo 2026.txt');
    expect(existsSync(join(rec.savePath, '..', 'Bolletta luce Enel marzo 2026.txt'))).toBe(true);

    // Dal pannello, il nome di prima si rimette.
    if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
    const rinominata = shell.locator('#dl-panel .dl-row', { hasText: 'Bolletta luce Enel marzo 2026.txt' });
    await expect(rinominata).toBeVisible({ timeout: 10000 });
    await rinominata.click({ button: 'right' });
    const rimetti = await voceDelMenu(app, 'Rimetti il nome di prima');
    expect(rimetti, 'il tasto destro offre «Rimetti il nome di prima»').not.toBeNull();
    await rimetti.click();
    await expect.poll(() => existsSync(rec.savePath), { timeout: 10000 }).toBe(true);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
