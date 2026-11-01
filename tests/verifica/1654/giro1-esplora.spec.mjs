// Esplorazione della verifica di #1654: screenshot con l'utente altrove, download breve partito davanti e finito altrove.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { home } from '../../helpers/chatFinta.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(4096));

async function apriServer() {
  let rilascia = () => {};
  const tenuto = new Promise((r) => { rilascia = r; });
  const srv = createServer(async (req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'file.pdf';
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (!nome.startsWith('lento')) { res.end(PDF); return; }
    res.write(PDF.subarray(0, 1024));
    await tenuto;
    res.end(PDF.subarray(1024));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, rilascia: () => rilascia(), async close() { rilascia(); try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

async function modelloHome(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__home = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      if (!tutto.includes('preparare la dashboard')) throw new Error('solo la home');
      globalThis.__home.push(tutto);
      return { text: JSON.stringify({ message: 'Arrivato.', suggestions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const davanti = (app, si) => app.evaluate(({ BrowserWindow, powerMonitor }, si) => {
  BrowserWindow.getFocusedWindow = si ? () => BrowserWindow.getAllWindows().find((w) => w._filoTabs) || null : () => null;
  powerMonitor.getSystemIdleTime = () => (si ? 0 : 600);
}, si);

const statoDi = (shell, fine) => shell.evaluate(async (f) => {
  const r = await window.filoShell.downloads.list();
  return (((r && r.items) || []).find((it) => String(it.filename || '').endsWith(f)) || {}).state ?? null;
}, fine);

const chiamateHome = (app) => app.evaluate(() => (globalThis.__home || []).length);

test('screenshot finito con l\'utente altrove: Filo non scrive', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await home(app);
  await modelloHome(app);
  await testServer.openReady(openTab, '<!doctype html><html><head><title>Foto</title></head><body><h1>Una pagina</h1></body></html>');
  await davanti(app, true);
  await premiNellaBarra(app, 'screenshot');
  await davanti(app, false);
  await expect.poll(() => statoDi(shell, '.png'), { timeout: 30_000 }).toBe('completed');
  await new Promise((r) => setTimeout(r, 3_000));
  expect(await chiamateHome(app)).toBe(0);
});

test('download breve partito davanti, finito altrove: Filo non scrive; partito altrove: scrive', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    await home(app);
    await modelloHome(app);
    await davanti(app, true);
    const page = await testServer.openReady(openTab, `<!doctype html><html><body><a id="a" href="${srv.base}/lento-a.pdf">a</a><a id="b" href="${srv.base}/b.pdf">b</a></body></html>`);
    await page.locator('#a').click();
    await expect.poll(() => statoDi(shell, 'lento-a.pdf'), { timeout: 20_000 }).toBe('progressing');
    await davanti(app, false);
    srv.rilascia();
    await expect.poll(() => statoDi(shell, 'lento-a.pdf'), { timeout: 20_000 }).toBe('completed');
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await chiamateHome(app)).toBe(0);

    await page.locator('#b').click();
    await expect.poll(() => statoDi(shell, 'b.pdf'), { timeout: 20_000 }).toBe('completed');
    await expect.poll(() => chiamateHome(app), { timeout: 10_000 }).toBe(1);
  } finally {
    await srv.close();
  }
});
