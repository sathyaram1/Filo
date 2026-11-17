// #2116.5 giro 2: varianti dello schermo intero (pagina ingrandita, campo a metà fuori, finestrella su Wayland).
// Lo schermo lo compone la prova dalle viste vere, come gli spec del lavoro, coi veli disegnati dove Filo li posa.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, clickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;
const ACCESSO = 'https://login.negozio-finto.it/login';
const SELETTORE = 'Una finestra o lo schermo, scelti da te nel selettore del sistema';

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
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: 'Una pagina.' };
    };
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chat.push(JSON.stringify(messages));
      n += 1;
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

// Lo schermo: le finestre di Filo affiancate, la finestrella (se c'è) sopra la prima, e i veli che Filo posa.
async function schermoFinto(app, { wayland = false } = {}) {
  await app.evaluate(({ nativeImage, screen, BrowserWindow }, { wl }) => {
    const d = screen.getPrimaryDisplay().bounds;
    const filo = BrowserWindow.getAllWindows().filter((w) => w._filoTabs && !w.isDestroyed());
    filo.forEach((w, i) => w.setBounds({ x: d.x + Math.round((i * d.width) / filo.length), y: d.y, width: Math.floor(d.width / filo.length), height: d.height }));
    const finestrella = BrowserWindow.getAllWindows().find((w) => !w._filoTabs && !w.isDestroyed() && /negozio-finto/.test(w.webContents.getURL()));
    if (finestrella) { finestrella.setBounds({ x: d.x + 40, y: d.y + 60, width: 480, height: 420 }); finestrella.showInactive(); }
    globalThis.__schermo = { catture: 0, veli: 0 };
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
    const veli = (buf, w) => {
      const c = w.getContentBounds();
      for (const v of w.contentView.children.filter((x) => x._filoVelo)) {
        globalThis.__schermo.veli += 1;
        const r = v.getBounds();
        for (let y = Math.max(0, c.y + r.y - d.y); y < Math.min(d.height, c.y + r.y + r.height - d.y); y++) {
          for (let x = Math.max(0, c.x + r.x - d.x); x < Math.min(d.width, c.x + r.x + r.width - d.x); x++) {
            const i = (y * d.width + x) * 4;
            buf[i] = 0x80; buf[i + 1] = 0x80; buf[i + 2] = 0x80; buf[i + 3] = 255;
          }
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
        veli(buf, w);
      }
      if (finestrella && !finestrella.isDestroyed()) {
        const c = finestrella.getContentBounds();
        disegna(buf, await finestrella.webContents.capturePage(), c.x, c.y, c.width, c.height);
        veli(buf, finestrella);
      }
      const foto = nativeImage.createFromBitmap(buf, { width: d.width, height: d.height });
      globalThis.__schermo.grezza = foto.toDataURL();
      return foto;
    };
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'linux',
      wayland: () => wl,
      permessoMac: () => 'granted',
      fonti: async ({ lato = 0 } = {}) => {
        if (lato > 0) globalThis.__schermo.catture += 1;
        if (wl) return lato > 0 ? [{ id: 'screen:77:0', nome: 'Scelto nel selettore', tipo: 'schermo', displayId: '', immagine: await componi() }] : [];
        return [{ id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: String(screen.getPrimaryDisplay().id), immagine: lato > 0 ? await componi() : null }];
      },
    });
  }, { wl: wayland });
}

async function guardaDopoOk(app, chat, nome) {
  await chatCheGuarda(app, nome);
  await chiedi(chat, 'guarda lo schermo e dimmi cosa vedi');
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'ok');
}

async function cassa(app, openTab, testServer, { alto = 120 } = {}) {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Cassa del negozio</title></head><body style="margin:0">
    <div style="height:${alto}px;background:${tinta(VERDE)}"></div>
    <form style="padding:20px"><input id="c" name="q" style="width:420px;font:bold 34px monospace;color:${tinta(ROSA)};background:#fff;border:1px solid #999;caret-color:transparent;outline:0"></form>
    <div style="height:3000px;background:${tinta(VERDE)}"></div>
    </body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await page.locator('#c').blur();
  return page;
}

async function esito(app) {
  await expect.poll(() => app.evaluate(() => globalThis.__occhio.length), { timeout: 30_000 }).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  const grezza = await app.evaluate(() => globalThis.__schermo.grezza);
  return { immagine, grezza };
}

test('schermo intero con la cassa ingrandita al 150%: il numero arriva coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await cassa(app, openTab, testServer);
  await app.evaluate(({ BrowserWindow }) => {
    const tab = BrowserWindow.getAllWindows().filter((w) => w._filoTabs)
      .map((w) => w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId)).find((t) => t && t.title === 'Cassa del negozio');
    tab.view.webContents.setZoomFactor(1.5);
  });
  await new Promise((r) => setTimeout(r, 600));
  const chat = await secondaFinestraConChat(app);
  await schermoFinto(app);
  await guardaDopoOk(app, chat, 'Schermo intero');
  const { immagine, grezza } = await esito(app);
  expect(await pixelDelColore(app, grezza, ROSA), 'lo schermo finto mostra il numero').toBeGreaterThan(200);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero si legge nella foto').toBeLessThan(20);
});

test('schermo intero con la cassa scorsa e il campo a metà sopra il bordo: il numero arriva coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await cassa(app, openTab, testServer, { alto: 400 });
  await page.evaluate(() => window.scrollTo(0, 440));
  await new Promise((r) => setTimeout(r, 300));
  const chat = await secondaFinestraConChat(app);
  await schermoFinto(app);
  await guardaDopoOk(app, chat, 'Schermo intero');
  const { immagine, grezza } = await esito(app);
  expect(await pixelDelColore(app, grezza, ROSA), 'lo schermo finto mostra il numero').toBeGreaterThan(50);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero si legge nella foto').toBeLessThan(20);
});

test('Wayland: la password resa visibile nella finestrella di accesso arriva coperta in quello scelto nel selettore', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
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
  }, {
    'login.negozio-finto.it/login': `<!doctype html><html><head><title>Accedi</title></head><body style="margin:0">
      <div style="height:90px;background:${tinta(VERDE)}"></div>
      <form style="padding:16px"><div>Hasło</div><input id="c" name="haslo" type="password" style="width:380px;font:bold 34px monospace;color:${tinta(ROSA)};background:#fff;border:1px solid #999;caret-color:transparent;outline:0">
      <button type="button" id="occhio" onclick="c.type = c.type === 'password' ? 'text' : 'password'">Mostra</button></form>
      </body></html>`,
  });
  const negozio = await testServer.openReady(openTab, `<!doctype html><html><head><title>Negozio</title></head><body style="margin:0;background:${tinta(VERDE)}">
    <button id="b" style="width:220px;height:60px" onclick="window.open('${ACCESSO}','login','width=480,height=420')">Accedi con…</button></body></html>`);
  await superaAvvisoSeCe(app);
  await negozio.click('#b');
  let accesso = null;
  await expect.poll(async () => {
    accesso = app.windows().find((w) => w.url().startsWith(ACCESSO)) || null;
    return !!accesso;
  }, { timeout: 15_000 }).toBe(true);
  await accesso.waitForSelector('#c');
  await accesso.fill('#c', 'Gatto.Rosso.77');
  await accesso.click('#occhio');
  await expect(accesso.locator('#c')).toHaveAttribute('type', 'text');
  await accesso.locator('#c').blur();
  const chat = await secondaFinestraConChat(app);
  await schermoFinto(app, { wayland: true });
  await guardaDopoOk(app, chat, SELETTORE);
  const { immagine, grezza } = await esito(app);
  expect(await app.evaluate(() => globalThis.__schermo.veli), 'la finestrella deve avere il suo velo').toBeGreaterThan(0);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'la password della finestrella si legge').toBeLessThan(20);
  void grezza;
});
