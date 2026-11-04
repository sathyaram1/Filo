// Verifica #1721 giro 2: casi fuori dal cammino felice della copertura delle foto per un modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

async function aiutoFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Ok.', status: 'done' }) };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  });
}

async function chiediAllAiuto(app, shell, page) {
  await aiutoFinto(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'aiutami');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBeGreaterThan(0);
  return app.evaluate(() => {
    const utente = [...globalThis.__visti[0]].reverse().find((m) => m.role === 'user');
    const parti = Array.isArray(utente.content) ? utente.content : [{ type: 'text', text: utente.content }];
    const img = parti.find((p) => p.type === 'image_url');
    return { immagine: img ? img.image_url.url : null, testi: parti.filter((p) => p.type === 'text').map((p) => p.text) };
  });
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

test('esplora: scheda ingrandita, il riquadro di un altro sito resta coperto e quello dello stesso sito si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(VERDE)}"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe>
    <iframe id="stesso" src="${stesso}" style="width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await app.evaluate(({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) if (/127\.0\.0\.1/.test(wc.getURL())) wc.setZoomFactor(1.5);
  });
  await page.waitForTimeout(500);
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  console.log('zoom rosa', await pixelDelColore(app, immagine, ROSA), 'verde', await pixelDelColore(app, immagine, VERDE));
  expect(await pixelDelColore(app, immagine, ROSA)).toBeLessThan(20);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
});

test('esplora: riquadri nascosti di altri siti (contatori) non tolgono la foto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html('<!doctype html><body>pixel</body>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Notizie</title></head><body style="margin:0">
    <div style="width:400px;height:300px;background:${tinta(VERDE)}"></div>
    <iframe src="${altro}" style="display:none"></iframe>
    <iframe src="${altro}" width="1" height="1" style="position:absolute;left:-9999px;border:0"></iframe>
    <iframe src="${altro}" style="visibility:hidden;width:0;height:0;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().filter((f) => f.url().includes('sito-pubblico.test')).length, { timeout: 10_000 }).toBe(3);
  const { immagine, testi } = await chiediAllAiuto(app, shell, page);
  console.log('nascosti', !!immagine, testi.join('\n').slice(0, 300));
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
});

test('esplora: anteprima della carta coi gruppi distanziati sulla carta disegnata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div style="width:380px;height:220px;border-radius:14px;background:#333;padding:24px;box-sizing:border-box">
      <div id="numero" style="display:flex;justify-content:space-between;margin-top:90px;font:22px monospace">
        <span style="background:${tinta(ROSA)};color:#fff">####</span><span style="background:${tinta(ROSA)};color:#fff">####</span>
        <span style="background:${tinta(ROSA)};color:#fff">####</span><span style="background:${tinta(ROSA)};color:#fff">####</span></div></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      const g = (e.target.value.replace(/\\D/g, '') + '################').slice(0, 16).match(/.{4}/g);
      document.querySelectorAll('#numero span').forEach((s, i) => { s.textContent = g[i]; });
    });</script></body></html>`);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#numero')).toContainText('1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  const n = await pixelDelColore(app, immagine, ROSA);
  console.log('gruppi distanziati rosa', n);
  expect(n).toBeLessThan(20);
});

test('esplora: riquadro di un altro sito dentro un riquadro dello stesso sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(VERDE)}"><div style="height:60px"></div>
    <iframe src="${altro}" style="margin-left:40px;width:200px;height:120px;border:4px solid #000;padding:6px"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0;padding:30px">
    <iframe id="stesso" src="${stesso}" style="width:400px;height:300px;border:7px solid #444;padding:5px"></iframe></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url().includes('sito-pubblico.test')), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(500);
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  const n = await pixelDelColore(app, immagine, ROSA);
  console.log('annidato rosa', n, 'verde', await pixelDelColore(app, immagine, VERDE));
  expect(n).toBeLessThan(20);
});

test('esplora: campo della carta e anteprima dentro un riquadro dello stesso sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dentro = testServer.html(`<!doctype html><body>
    <div><span id="anteprima" style="display:inline-block;padding:6px 10px;background:${tinta(ROSA)};color:#fff;font:20px monospace">•••• ••••</span></div>
    <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px">
    <script>document.getElementById('c').addEventListener('input', (e) => { document.getElementById('anteprima').textContent = e.target.value; });</script></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <iframe id="pag" src="${dentro}" style="width:500px;height:200px;border:0"></iframe></body></html>`);
  const f = page.frameLocator('#pag');
  await f.locator('#c').fill('4111-1111-1111-1111');
  await expect(f.locator('#anteprima')).toHaveText('4111-1111-1111-1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  const n = await pixelDelColore(app, immagine, ROSA);
  console.log('nel riquadro rosa', n);
  expect(n).toBeLessThan(20);
});

test('esplora: pagina molto grande, la foto parte lo stesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body style="margin:0">
    <div style="width:400px;height:300px;background:${tinta(VERDE)}"></div><div id="tanti"></div>
    <script>const t = document.getElementById('tanti'); let h = '';
      for (let i = 0; i < 80000; i++) h += '<p><span>riga ' + i + '</span> <b>x</b></p>';
      t.innerHTML = h;</script></body></html>`);
  const t0 = Date.now();
  const { immagine, testi } = await chiediAllAiuto(app, shell, page);
  console.log('grande', !!immagine, Date.now() - t0, testi.join('\n').slice(0, 200));
  expect(immagine).toMatch(/^data:image\/jpeg/);
});

// --- La chat che guarda un'altra finestra di Filo su una pagina di Filo.

async function chatCheGuarda(app, finestra) {
  await app.evaluate(async (_e, nome) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.DESCRIBE_IMAGE]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry, schermo: { guarda: true },
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

test('esplora: dalla chat si guarda una finestra di Filo che mostra le Preferenze', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForLoadState('load');
  const titolo = await page.title();
  const chat = await secondaFinestraConChat(app);
  await chatCheGuarda(app, titolo);
  await chiedi(chat, 'cosa c’è nell’altra finestra?');
  await expect.poll(() => app.evaluate(() => globalThis.__chat.length), { timeout: 30_000 }).toBeGreaterThan(1);
  const secondo = await app.evaluate(() => globalThis.__chat[1]);
  console.log('preferenze titolo', titolo, 'occhio', await app.evaluate(() => globalThis.__occhio.length), secondo.slice(-700));
  expect(await app.evaluate(() => globalThis.__occhio.length)).toBe(1);
});
