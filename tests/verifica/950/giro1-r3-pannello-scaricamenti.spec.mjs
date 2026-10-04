// Verifica #950, giro 1, rilievo 3: il pannello degli scaricamenti in alto (l'indicatore) elenca il file appena
// scaricato; il tasto destro su quella riga deve offrire «Dai un nome sensato» come la pagina Scaricamenti.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('tasto destro su un file nel pannello degli scaricamenti → «Dai un nome sensato»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
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
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const rec = ((r && r.items) || []).find((it) => it.url === url);
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');

    if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
    await expect(shell.locator('#dl-panel')).toBeVisible({ timeout: 10000 });
    const riga = shell.locator('#dl-panel .dl-row', { hasText: 'scan_00231.txt' });
    await expect(riga).toBeVisible();
    await riga.click({ button: 'right' });
    await expect(shell.getByText('Dai un nome sensato')).toBeVisible({ timeout: 5000 });
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
