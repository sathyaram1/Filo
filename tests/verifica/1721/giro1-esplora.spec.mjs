// Verifica #1721 giro 1: le coperture della foto per un modello provate fuori dal caso felice.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
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

async function chiediAllAiuto(app, shell, page) {
  await aiutoFinto(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'aiutami');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 30_000 }).toBeGreaterThan(0);
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

async function zoomScheda(app, titolo, f) {
  await app.evaluate(({ BrowserWindow }, { titolo: t, f: z }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.tabs.find((x) => x.title === t).view.webContents.setZoomFactor(z);
  }, { titolo, f });
}

test('zoom 175% e pagina scorsa: il riquadro di un altro sito resta coperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0;background:${tinta(VERDE)}">
    <div style="height:300px"></div>
    <iframe id="altro" src="${altro}" style="margin-left:137px;width:251px;height:163px;border:7px solid #fff"></iframe>
    <div style="height:2000px"></div></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await zoomScheda(app, 'Conto', 1.75);
  await page.evaluate(() => window.scrollTo(0, 230));
  await page.waitForTimeout(400);
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro si vede').toBeLessThan(20);
  expect(await pixelDelColore(app, immagine, VERDE), 'la pagina deve restare').toBeGreaterThan(20_000);
});

test('venti riquadri di altri siti (pubblicità): la foto parte e li copre tutti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">ad</body>`, { pubblico: true });
  const riquadri = Array.from({ length: 20 }, (_, i) => `<iframe src="${altro}#${i}" style="width:90px;height:60px;border:0;margin:3px"></iframe>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Notizie</title></head><body style="margin:0;background:${tinta(VERDE)}">
    <h1>Notizie</h1>${riquadri}</body></html>`);
  await expect.poll(() => page.frames().filter((f) => f.url().includes('sito-pubblico.test')).length, { timeout: 10_000 }).toBe(20);
  const t0 = Date.now();
  const { immagine } = await chiediAllAiuto(app, shell, page);
  console.log('[verifica] venti riquadri: ms', Date.now() - t0);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA)).toBeLessThan(20);
});

test('anteprima della carta con una cifra per elemento: il numero non si legge', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div id="anteprima" style="display:inline-block;padding:14px 18px;background:${tinta(ROSA)};color:#fff;font:22px monospace;width:420px;height:30px"></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      const a = document.getElementById('anteprima'); a.textContent = '';
      const cifre = e.target.value.replace(/\\D/g, '');
      [...cifre].forEach((d, i) => {
        const s = document.createElement('span'); s.textContent = d;
        s.style.cssText = 'display:inline-block;width:16px;text-align:center' + (i % 4 === 3 ? ';margin-right:14px' : '');
        a.appendChild(s);
      });
    });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#anteprima span')).toHaveCount(16);
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'l’anteprima col numero si vede').toBeLessThan(20);
});

test('anteprima della carta dentro un riquadro dello stesso sito: il numero non si legge', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const anteprima = testServer.html(`<!doctype html><body style="margin:0"><div id="a" style="padding:10px;background:${tinta(ROSA)};color:#fff;font:22px monospace">•••• •••• •••• ••••</div></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <iframe id="f" src="${anteprima}" style="width:420px;height:80px;border:0"></iframe>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      document.getElementById('f').contentDocument.getElementById('a').textContent = e.target.value;
    });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.frameLocator('#f').locator('#a')).toHaveText('4111 1111 1111 1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'l’anteprima col numero si vede').toBeLessThan(20);
});

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
    P.completeWithFallback = async ({ attempts, messages }) => {
      const parti = (messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const img = parti.find((p) => p && p.type === 'image_url');
      if (img) globalThis.__occhio.push(img.image_url.url);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: 'Una pagina.' };
    };
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
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
    await attendi(() => !prima.has(win.id) && win._filoTabs && win._filoTabs.tabs.length > 0, 'seconda finestra');
    const tm = win._filoTabs;
    const scheda = tm.openTab('filo://newtab/');
    const id = (scheda && scheda.id) || scheda;
    if (id != null && tm.activeId !== id) tm.activate(id);
    const wc = () => { const t = tm.tabs.find((x) => x.id === tm.activeId); return t && t.view && t.view.webContents; };
    await attendi(() => wc() && /^filo:\/\/newtab/.test(wc().getURL()) && !wc().isLoading(), 'chat');
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

test('finestra di Filo guardata dalla chat: il riquadro di un altro sito arriva coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Estratto conto</title></head><body style="margin:0;background:${tinta(VERDE)}">
    <h1>Conto</h1><iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const chat = await secondaFinestraConChat(app);
  await chatCheGuarda(app, 'Estratto conto');
  await chiedi(chat, 'cosa c’è nella finestra del conto?');
  await expect.poll(() => app.evaluate(() => globalThis.__occhio.length), { timeout: 30_000 }).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro si vede').toBeLessThan(20);
});
