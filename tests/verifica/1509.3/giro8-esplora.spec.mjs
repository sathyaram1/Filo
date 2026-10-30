// Verifica #1509.3 giro 8: esplorazione (markup nello strato, tema scuro, zoom, testo lungo).
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Titolo</h1><p style="height:1600px">corpo</p>
  <script>window.__letti=[];document.addEventListener('selectionchange',()=>{const s=String(getSelection());if(s)window.__letti.push(s)},true);</script></body></html>`;

async function prepara(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__risposte = risposte.slice();
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{}');
      return fatto(JSON.stringify(globalThis.__risposte.shift() || { text: 'Fine.', status: 'done' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, risposte);
}

async function apri(app, shell, openTab, testServer) {
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  return { sito, strato, id };
}

test('markup nella domanda e nella risposta resta testo nello strato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, [{ text: 'Ecco <img src=x onerror="window.__xss=1"> e **grassetto** <script>window.__xss=2</script>', status: 'done' }]);
  const { sito, strato } = await apri(app, shell, openTab, testServer);
  await strato.locator('.sn-sidebar-input textarea').fill('<img src=y onerror="window.__xss=3"> 😀 domanda');
  await strato.locator('.sn-sidebar-input textarea').press('Enter');
  await expect(strato.locator('.sn-sidebar')).toContainText('grassetto', { timeout: 15_000 });
  await strato.waitForTimeout(800);
  expect(await strato.evaluate(() => window.__xss)).toBeUndefined();
  expect(await strato.locator('.sn-sidebar img[src="x"], .sn-sidebar img[src="y"]').count()).toBe(0);
  await strato.screenshot({ path: 'tests/.shots/1509-giro8-chiaro.png' });
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await strato.waitForTimeout(1200);
  await strato.screenshot({ path: 'tests/.shots/1509-giro8-scuro.png' });
  expect(await sito.evaluate(() => window.__letti.join('|'))).not.toContain('domanda');
});

test('zoom della pagina e ridimensionamento: il pannello resta dentro la scheda e ci si scrive', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { sito, strato, id } = await apri(app, shell, openTab, testServer);
  await strato.locator('.sn-sidebar-input textarea').fill('x'.repeat(12000));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId) || w._filoTabs.tabs.at(-1);
    t.view.webContents.setZoomFactor(1.5);
    w.setSize(900, 650);
  });
  await strato.waitForTimeout(1500);
  const box = await strato.locator('.sn-sidebar').boundingBox();
  const vista = await strato.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log('ZOOM', JSON.stringify({ box, vista }));
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vista.w + 1);
  expect(box.y + Math.min(box.height, 100)).toBeLessThanOrEqual(vista.h);
  expect((await strato.locator('.sn-sidebar-input textarea').inputValue()).length).toBe(12000);
  await strato.screenshot({ path: 'tests/.shots/1509-giro8-zoom.png' });
  void sito; void id;
});
