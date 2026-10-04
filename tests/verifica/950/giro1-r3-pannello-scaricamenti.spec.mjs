// Verifica #950, giro 1, rilievo 3: il pannello degli scaricamenti in alto (l'indicatore) elenca il file appena
// scaricato; il tasto destro su quella riga offre «Dai un nome sensato», e la scelta porta al file rinominato.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Tasto destro sulla riga e clic sulla voce del menu a comparsa (una finestra a sé, che si chiude quando perde
// il fuoco: senza gestore di finestre il fuoco a volte glielo porta via la scheda sotto, e si riprova).
async function scegli(app, riga, testo) {
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    await riga.click({ button: 'right' });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      for (const popup of app.windows().filter((w) => !w.isClosed() && w.url().startsWith('data:text/html')).reverse()) {
        const voce = popup.locator('.menu .item', { hasText: testo });
        let c = 0;
        try { c = await voce.count(); } catch (_) { c = 0; }
        if (!c) continue;
        // La scelta chiude il menu: il clic può «fallire» proprio perché è arrivato. Lo dice il disco, dopo.
        try { await voce.click({ timeout: 2000 }); } catch (_) {}
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
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
    expect(await scegli(app, riga, 'Dai un nome sensato'), 'il tasto destro sulla riga offre «Dai un nome sensato»').toBe(true);

    await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://downloads/')), { timeout: 10000 }).toBe(true);
    const pagina = app.windows().find((w) => w.url().startsWith('filo://downloads/'));
    await expect(pagina.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel marzo 2026', { timeout: 15000 });
    await pagina.locator('.sn-rinomina-ok').click();
    await expect(pagina.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Bolletta luce Enel marzo 2026.txt');
    expect(existsSync(join(rec.savePath, '..', 'Bolletta luce Enel marzo 2026.txt'))).toBe(true);

    // Dal pannello, il nome di prima si rimette.
    if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
    const rinominata = shell.locator('#dl-panel .dl-row', { hasText: 'Bolletta luce Enel marzo 2026.txt' });
    await expect(rinominata).toBeVisible({ timeout: 10000 });
    expect(await scegli(app, rinominata, 'Rimetti il nome di prima'), 'il tasto destro offre «Rimetti il nome di prima»').toBe(true);
    await expect.poll(() => existsSync(rec.savePath), { timeout: 10000 }).toBe(true);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
