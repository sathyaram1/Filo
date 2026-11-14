// Verifica #2116.5, giro 1: la cassa con la pagina ingrandita, il campo della carta nel riquadro del servizio di
// pagamento e la finestra che esce in parte dallo schermo: nella foto dello schermo intero il numero arriva coperto.
// Il contenitore non fotografa lo schermo: la foto la compone la prova dalle schede vere, scoperte, ognuna al suo posto.

import { test, expect } from '../../fixtures/electron.mjs';
import { copertura, vistaAvviso } from '../../helpers/avvisoSito.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, clickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;
const CAMPO = 'https://pagamenti-finti.it/campo';

async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

async function superaAvvisoSeCe(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  await (await vistaAvviso(app)).getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

async function pixelDelColore(app, dataUrl, rgb, tol = 40) {
  return app.evaluate(({ nativeImage }, { u, c, tol: t }) => {
    const b = nativeImage.createFromDataURL(u).toBitmap();
    let n = 0;
    for (let i = 0; i < b.length; i += 4) {
      if (Math.abs(b[i + 2] - c[0]) <= t && Math.abs(b[i + 1] - c[1]) <= t && Math.abs(b[i] - c[2]) <= t) n++;
    }
    return n;
  }, { u: dataUrl, c: rgb, tol });
}

async function chatCheGuarda(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.DESCRIBE_IMAGE]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      schermo: { guarda: true },
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__occhio = [];
    P.completeWithFallback = async ({ attempts, messages }) => {
      const parti = (messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const img = parti.find((p) => p && p.type === 'image_url');
      if (img) globalThis.__occhio.push(img.image_url.url);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: 'Una cassa.' };
    };
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const calls = n === 1 ? [{ id: 'v1', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: 'Schermo intero' }) }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = n === 1 ? '' : 'Ho guardato lo schermo.';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });
}

async function secondaFinestraConChat(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const rq = process.mainModule.require;
    const prima = new Set(BrowserWindow.getAllWindows().map((w) => w.id));
    const win = rq(rq('node:path').join(process.cwd(), 'src/main/window.js')).createMainWindow();
    const attendi = async (cond, cosa) => {
      const fine = Date.now() + 15_000;
      while (!cond()) {
        if (Date.now() > fine) throw new Error(cosa);
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    await attendi(() => !prima.has(win.id) && win._filoTabs && win._filoTabs.tabs.length > 0, 'la seconda finestra non ha schede');
    const tm = win._filoTabs;
    const scheda = tm.openTab('filo://newtab/');
    const id = (scheda && scheda.id) || scheda;
    if (id != null && tm.activeId !== id) tm.activate(id);
    const wc = () => { const t = tm.tabs.find((x) => x.id === tm.activeId); return t && t.view && t.view.webContents; };
    await attendi(() => wc() && /^filo:\/\/newtab/.test(wc().getURL()) && !wc().isLoading(), 'la seconda finestra non ha aperto la chat');
    await wc().executeJavaScript('window.__secondaFinestra = true');
  });
  let chat = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      if (!w.url().startsWith('filo://newtab')) continue;
      if (await w.evaluate(() => window.__secondaFinestra === true).catch(() => false)) { chat = w; return true; }
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  await expect(chat.locator('#input')).toBeVisible({ timeout: 8_000 });
  return chat;
}

// La prima finestra esce di 150 punti a sinistra dello schermo; la seconda le sta accanto.
async function schermoFinto(app) {
  await app.evaluate(({ nativeImage, screen, BrowserWindow }) => {
    const d = screen.getPrimaryDisplay().bounds;
    const filo = BrowserWindow.getAllWindows().filter((w) => w._filoTabs && !w.isDestroyed());
    const meta = Math.floor(d.width / 2);
    filo[0].setBounds({ x: d.x - 150, y: d.y, width: meta + 150, height: d.height });
    filo[1].setBounds({ x: d.x + meta, y: d.y, width: d.width - meta, height: d.height });
    globalThis.__schermo = {};
    const disegna = (buf, img, x0, y0, w, h) => {
      const src = img.resize({ width: w, height: h }).toBitmap();
      for (let y = 0; y < h; y++) {
        const ty = y0 + y - d.y;
        if (ty < 0 || ty >= d.height) continue;
        for (let x = 0; x < w; x++) {
          const tx = x0 + x - d.x;
          if (tx < 0 || tx >= d.width) continue;
          src.copy(buf, (ty * d.width + tx) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
        }
      }
    };
    const componi = async () => {
      const buf = Buffer.alloc(d.width * d.height * 4);
      for (let i = 0; i < buf.length; i += 4) { buf[i] = 0x30; buf[i + 1] = 0x30; buf[i + 2] = 0x30; buf[i + 3] = 255; }
      for (const w of BrowserWindow.getAllWindows().filter((x) => x._filoTabs && !x.isDestroyed())) {
        const tm = w._filoTabs;
        const tab = tm.tabs.find((t) => t.id === tm.activeId);
        const c = w.getContentBounds();
        const b = tab.view.getBounds();
        disegna(buf, await tab.view.webContents.capturePage(), c.x + b.x, c.y + b.y, b.width, b.height);
      }
      const foto = nativeImage.createFromBitmap(buf, { width: d.width, height: d.height });
      globalThis.__schermo.grezza = foto.toDataURL();
      return foto;
    };
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'win32',
      wayland: () => false,
      permessoMac: () => 'granted',
      fonti: async ({ lato = 0 } = {}) => [{ id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: String(screen.getPrimaryDisplay().id), immagine: lato > 0 ? await componi() : null }],
    });
  });
}

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 40 100 Td (Bolletta) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

test('guardando lo schermo intero con un PDF aperto in una finestra di Filo, la foto arriva', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await app.evaluate(({ session, net }, pdf) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => (new URL(req.url).hostname === 'documenti-finti.it'
      ? new Response(pdf, { headers: { 'content-type': 'application/pdf' } })
      : net.fetch(req, { bypassCustomProtocolHandlers: true })));
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, PDF);
  await openTab('https://documenti-finti.it/bolletta.pdf').catch(() => null);
  await superaAvvisoSeCe(app);
  await new Promise((r) => setTimeout(r, 3_000));
  const url = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL();
  });
  expect(url, 'la scheda del PDF deve essere in vista').toContain('documenti-finti.it');

  const chat = await secondaFinestraConChat(app);
  await schermoFinto(app);
  await chatCheGuarda(app);
  await chiedi(chat, 'guarda lo schermo e dimmi cosa vedi');
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__occhio.length), { timeout: 30_000 }).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  const grezza = await app.evaluate(() => globalThis.__schermo.grezza);
  expect(await pixelDelColore(app, grezza, ROSA), 'lo schermo del sistema finto deve mostrare la carta scoperta').toBeGreaterThan(200);
  expect(await pixelDelColore(app, immagine, VERDE), 'deve arrivare lo schermo').toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero della carta si legge nella foto dello schermo').toBeLessThan(20);
});
