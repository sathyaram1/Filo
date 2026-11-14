// Verifica #2116.5, giro 1: una finestra di Filo che mostra un PDF, o un sito con un riquadro di un altro sito, non deve
// far mancare a Filo tutto lo schermo, né (Wayland) la finestra di un'altra app scelta nel selettore del sistema.
// Il contenitore non fotografa lo schermo: la foto la compone la prova dalle schede vere, ognuna al suo posto.

import { test, expect } from '../../fixtures/electron.mjs';
import { copertura, vistaAvviso } from '../../helpers/avvisoSito.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, clickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const VERDE = [0x12, 0xab, 0x34];
const SELETTORE = 'Una finestra o lo schermo, scelti da te nel selettore del sistema';

async function servi(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const p = pg[u.hostname + u.pathname];
      if (p) return new Response(p.corpo, { headers: { 'content-type': p.tipo } });
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

async function chatCheGuarda(app, finestra) {
  await app.evaluate(async (_e, nome) => {
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
    globalThis.__chat = [];
    P.completeWithFallback = async ({ attempts, messages }) => {
      const parti = (messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const img = parti.find((p) => p && p.type === 'image_url');
      if (img) globalThis.__occhio.push(img.image_url.url);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: 'Uno schermo.' };
    };
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      n += 1;
      globalThis.__chat.push(JSON.stringify(messages).slice(-600));
      const calls = n === 1 ? [{ id: 'v1', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: nome }) }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = n === 1 ? '' : 'Ho guardato.';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, finestra);
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

// Windows: lo schermo come lo fotograferebbe il sistema, con le due finestre di Filo affiancate.
async function schermoFinto(app) {
  await app.evaluate(({ nativeImage, screen, BrowserWindow }) => {
    const d = screen.getPrimaryDisplay().bounds;
    const filo = BrowserWindow.getAllWindows().filter((w) => w._filoTabs && !w.isDestroyed());
    filo.forEach((w, i) => w.setBounds({ x: d.x + Math.round((i * d.width) / filo.length), y: d.y, width: Math.floor(d.width / filo.length), height: d.height }));
    const componi = () => {
      const buf = Buffer.alloc(d.width * d.height * 4);
      for (let i = 0; i < buf.length; i += 4) { buf[i] = VERDE_B; buf[i + 1] = VERDE_G; buf[i + 2] = VERDE_R; buf[i + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: d.width, height: d.height });
    };
    const [VERDE_R, VERDE_G, VERDE_B] = [0x12, 0xab, 0x34];
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'win32',
      wayland: () => false,
      permessoMac: () => 'granted',
      fonti: async ({ lato = 0 } = {}) => [{ id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: String(screen.getPrimaryDisplay().id), immagine: lato > 0 ? componi() : null }],
    });
  });
}

// Wayland: nel selettore del sistema l'utente sceglie la finestra del terminale, un'altra app.
async function selettoreFinto(app) {
  await app.evaluate(({ nativeImage }) => {
    const terminale = () => {
      const w = 800, h = 600, buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < buf.length; i += 4) { buf[i] = 0x34; buf[i + 1] = 0xab; buf[i + 2] = 0x12; buf[i + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h });
    };
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'linux',
      wayland: () => true,
      fonti: async ({ lato = 0 } = {}) => (lato > 0 ? [{ id: 'window:77:0', nome: 'Terminale', tipo: 'finestra', displayId: '', immagine: terminale() }] : []),
    });
  });
}

async function guardaEdAspetta(app, chat, finestra) {
  await chatCheGuarda(app, finestra);
  await chiedi(chat, 'guarda e dimmi cosa vedi');
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__chat.length), { timeout: 30_000 }).toBe(2);
  const occhio = await app.evaluate(() => globalThis.__occhio);
  expect(occhio.length, `la foto deve arrivare al modello; esito: ${(await app.evaluate(() => globalThis.__chat))[1]}`).toBe(1);
  expect(await pixelDelColore(app, occhio[0], VERDE), 'deve arrivare quello che si è scelto').toBeGreaterThan(20_000);
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

test('r1 guardando lo schermo intero con un PDF aperto in una finestra di Filo, la foto arriva', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await servi(app, { 'documenti-finti.it/bolletta.pdf': { corpo: PDF, tipo: 'application/pdf' } });
  await openTab('https://documenti-finti.it/bolletta.pdf').catch(() => null);
  await superaAvvisoSeCe(app);
  await new Promise((r) => setTimeout(r, 3_000));
  const url = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL();
  });
  expect(url, 'la scheda del PDF deve essere in vista').toContain('documenti-finti.it');
  const chat = await secondaFinestraConChat(app);
  await schermoFinto(app);
  await guardaEdAspetta(app, chat, 'Schermo intero');
});

test('r1 su Wayland, con un sito che incorpora un video in una finestra di Filo, la finestra del terminale scelta nel selettore arriva', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await servi(app, { 'video-finti.it/embed': { corpo: '<!doctype html><body style="margin:0;background:#000;color:#fff">video</body>', tipo: 'text/html; charset=utf-8' } });
  await testServer.openReady(openTab, `<!doctype html><html><head><title>Ricetta</title></head><body style="margin:0">
    <h1>Ricetta della torta</h1><iframe src="https://video-finti.it/embed" style="width:560px;height:315px;border:0"></iframe></body></html>`);
  await superaAvvisoSeCe(app);
  const chat = await secondaFinestraConChat(app);
  await selettoreFinto(app);
  await guardaEdAspetta(app, chat, SELETTORE);
});
