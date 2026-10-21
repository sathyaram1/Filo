// Esplorazione della verifica #1560: altre strade verso un riquadro della stessa origine che arriva tardi.

import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { conta } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const RITARDO_MS = 1500;

const RIQUADRO = `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; padding: 10px; font: 16px/1.5 system-ui, sans-serif; }</style>
<p id="bersaglio">supercalifragilistico</p>`;

const PAGINA = (corpo) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  h1 { margin: 24px; font-size: 20px; }
  iframe { display: block; width: 560px; height: 300px; border: 1px solid #ccc; margin: 0 24px; }
</style>
<h1>Pagina con un riquadro</h1>
${corpo}`;

const PAGINE = {
  '/statico': PAGINA('<iframe id="riquadro" src="/riquadro"></iframe>'),
  '/vuoto': PAGINA('<p>niente</p>'),
  '/tocca': PAGINA(`<iframe id="riquadro" src="/riquadro"></iframe>
<script>
  const f = document.getElementById('riquadro');
  const fine = Date.now() + 2500;
  (function giro() { try { void f.contentWindow.document; void f.contentDocument; f.contentWindow.postMessage('ciao', '*'); } catch (e) {}
    if (Date.now() < fine) setTimeout(giro, 50); })();
</script>`),
};

async function server() {
  const srv = http.createServer((req, res) => {
    const invia = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
    if (req.url.startsWith('/riquadro')) { setTimeout(() => invia(RIQUADRO), RITARDO_MS); return; }
    invia(PAGINE[req.url] || PAGINE['/vuoto']);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { origine: `http://127.0.0.1:${srv.address().port}`, chiudi: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origArrivo = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origArrivo,
      streamComplete: async ({ onDelta }) => { onDelta('Una parola lunga e allegra.'); return { text: 'Una parola lunga e allegra.', usage: {} }; },
    };
  });
}

async function frameDi(page, src) {
  let frame = null;
  await expect.poll(() => {
    frame = page.frames().find((f) => f.url() === src) || null;
    return !!frame;
  }, { timeout: 8000, message: 'il riquadro non è arrivato' }).toBe(true);
  await expect.poll(() => frame.evaluate(() => !!document.getElementById('bersaglio')), { timeout: 8000 }).toBe(true);
  return frame;
}

async function spiegazioneDentro(app, page, src) {
  const frame = await frameDi(page, src);
  await frame.locator('#bersaglio').dblclick();
  await expect.poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 }).toContain('supercalifragilistico');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => {
    try { return await conta(app, page, '.sn-popup', frame); } catch (e) {
      if (/nessun mondo di Filo/.test(String(e && e.message))) return -1;
      throw e;
    }
  }, { timeout: 10_000, message: 'Alt+E dentro il riquadro non ha aperto la spiegazione (-1: Filo non c\'è)' }).toBeGreaterThan(0);
}

test('riquadro vuoto messo nella pagina e indirizzo dato dopo: dentro c\'è Filo e Alt+E spiega', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await server();
  try {
    await preparaProvider(app);
    const page = await openTab(`${s.origine}/vuoto`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.evaluate(() => {
      const f = document.createElement('iframe');
      f.id = 'riquadro';
      document.body.appendChild(f);
    });
    await page.mouse.move(100, 60, { steps: 3 });
    await page.mouse.move(200, 200, { steps: 3 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('riquadro').src = '/riquadro'; });
    await spiegazioneDentro(app, page, `${s.origine}/riquadro`);
  } finally { await s.chiudi(); }
});

test('la pagina tocca il suo riquadro mentre arriva: dentro c\'è Filo e Alt+E spiega', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await server();
  try {
    await preparaProvider(app);
    const page = await openTab(`${s.origine}/tocca`);
    await spiegazioneDentro(app, page, `${s.origine}/riquadro`);
  } finally { await s.chiudi(); }
});

test('riquadro in arrivo quando la pagina è pronta: il tasto destro lì dentro apre il menu di Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await server();
  try {
    const page = await openTab(`${s.origine}/statico`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.mouse.move(100, 60, { steps: 3 });
    await page.mouse.move(200, 200, { steps: 3 });
    await frameDi(page, `${s.origine}/riquadro`);
    const riquadro = page.frameLocator('#riquadro');
    await riquadro.locator('#bersaglio').click({ button: 'right' });
    await expect(menuDi(riquadro).locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  } finally { await s.chiudi(); }
});
