// Verifica #1721 giro 3: esplorazione delle coperture sulla foto per un modello (Aiuto e chat che guarda una finestra).

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

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

const SCRIPT_GRUPPI = `<script>document.getElementById('c').addEventListener('input', (e) => {
  const g = (e.target.value.replace(/\\D/g, '') + '################').slice(0, 16).split('');
  document.querySelectorAll('#numero span').forEach((s, i) => { s.textContent = g[i]; });
});</script>`;

test('reprova giro 2: gruppi sparsi sulla carta disegnata', async ({ app, shell, openTab, testServer }) => {
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
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#numero')).toContainText('1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA)).toBeLessThan(20);
});

test('e2 anteprima con una cifra per elemento', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const cella = `<span style="display:inline-block;width:16px;margin-right:4px;background:${tinta(ROSA)};color:#fff">#</span>`;
  const gruppo = `<span style="margin-right:22px">${cella.repeat(4)}</span>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div id="numero" style="font:22px monospace;padding:20px;background:#333">${gruppo.repeat(4)}</div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    ${SCRIPT_GRUPPI.replace("'#numero span'", "'#numero span span'")}</body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#numero')).toContainText('4');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'cifre leggibili').toBeLessThan(20);
});

test('e3 il codice di sicurezza ripetuto sul retro della carta disegnata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div style="width:380px;height:120px;background:#333;padding:20px"><span id="cvc" style="background:${tinta(ROSA)};color:#fff;font:22px monospace">•••</span></div>
    <form><label for="n">Numero della carta</label> <input id="n" autocomplete="cc-number"><br>
    <label for="c">CVC</label> <input id="c" autocomplete="cc-csc" name="cvc" style="width:80px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => { document.getElementById('cvc').textContent = e.target.value || '•••'; });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#n', '4111 1111 1111 1111');
  await page.fill('#c', '737');
  await expect(page.locator('#cvc')).toHaveText('737');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'cvc leggibile').toBeLessThan(20);
});

test('e4 anteprima in una shadow root aperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div id="ospite"></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>const sr = document.getElementById('ospite').attachShadow({ mode: 'open' });
    sr.innerHTML = '<span id="a" style="display:inline-block;padding:6px;background:${tinta(ROSA)};color:#fff;font:20px monospace">#### #### #### ####</span>';
    document.getElementById('c').addEventListener('input', (e) => { sr.getElementById('a').textContent = e.target.value; });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'anteprima leggibile').toBeLessThan(20);
});

test('e5 riquadro di un altro sito dentro un riquadro dello stesso sito ingrandito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0"><iframe id="x" src="${altro}" style="width:150px;height:100px;border:0;display:block"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0;transform:scale(2.5);transform-origin:0 0"></iframe></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede').toBeLessThan(20);
});

test('e6 zoom della scheda al 150%: riquadro di un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(VERDE)}"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe>
    <iframe id="stesso" src="${stesso}" style="width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.tabs.find((t) => t.title === 'Conto').view.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(500);
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede').toBeLessThan(20);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(10_000);
});

test('e9 copia del numero in un campo di sola lettura senza indizi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"><br><br>
    Riepilogo: <input id="r" readonly style="width:420px;font:bold 30px monospace;color:${tinta(ROSA)};border:0;background:#fff"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => { document.getElementById('r').value = e.target.value; });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#r')).toHaveValue('4111 1111 1111 1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine).toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riepilogo si legge').toBeLessThan(20);
});

// La chat della seconda finestra guarda la prima.
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

test('e7 la chat guarda una finestra con un riquadro di un altro sito e l’anteprima della carta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento con carta</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div>
    <iframe src="${altro}" style="width:300px;height:150px;border:0"></iframe>
    <div><span id="anteprima" style="display:inline-block;padding:6px 10px;background:${tinta(ROSA)};color:#fff;font:20px monospace">•••• •••• •••• ••••</span></div>
    <form><input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => { document.getElementById('anteprima').textContent = e.target.value; });</script>
    </body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await page.locator('#c').blur();
  const chat = await secondaFinestraConChat(app);
  await chatCheGuarda(app, 'Pagamento con carta');
  await chiedi(chat, 'cosa c’è nella finestra del pagamento?');
  await expect.poll(() => app.evaluate(() => globalThis.__occhio.length), { timeout: 30_000 }).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'riquadro o anteprima leggibili').toBeLessThan(20);
});
