// #1721 — la foto di una pagina che va a un modello passa per una copertura sola, qualunque strada la scatti: i riquadri
// di altri siti (#1537), il numero della carta ripetuto fuori dal campo (#810.16), la finestra di Filo guardata dalla
// chat (#810.17), lo Screenshot del menu. Ogni prova dipinge la cosa da nascondere di un colore unico e cerca quel colore nella foto arrivata al
// modello finto: senza il fix c'è.

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura } from './helpers/avvisoSito.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';
import { chiedi } from './helpers/chatFinta.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// L'Aiuto risponde subito; tutto quello che gli arriva resta in __visti.
async function aiutoFinto(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Premi «Paga».', status: 'done' }) };
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

// Una domanda all'Aiuto: torna l'ultimo messaggio dell'utente arrivato al modello (immagine e testi).
async function chiediAllAiuto(app, shell, page) {
  await preparaModelli(app);
  await aiutoFinto(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'aiutami a pagare');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBeGreaterThan(0);
  return app.evaluate(() => {
    const utente = [...globalThis.__visti[0]].reverse().find((m) => m.role === 'user');
    const parti = Array.isArray(utente.content) ? utente.content : [{ type: 'text', text: utente.content }];
    const img = parti.find((p) => p.type === 'image_url');
    return { immagine: img ? img.image_url.url : null, testi: parti.filter((p) => p.type === 'text').map((p) => p.text) };
  });
}

// Quanti pixel della foto hanno il colore `rgb`, con la tolleranza del JPEG.
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

const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

test('#1537: nella foto per l’Aiuto il riquadro di un altro sito è coperto, quello dello stesso sito resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234 €</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(VERDE)}"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe>
    <iframe id="stesso" src="${stesso}" style="width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await expect(page.frameLocator('#stesso').locator('body')).toBeAttached();

  const { immagine, testi } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede nella foto').toBeLessThan(20);
  expect(await pixelDelColore(app, immagine, VERDE), 'il riquadro dello stesso sito deve restare').toBeGreaterThan(20_000);
  expect(testi.join('\n')).not.toContain('non c\'è lo screenshot');
});

test('#1537: un riquadro di un altro sito in un componente chiuso, che non si può misurare: la foto non parte e il modello sa perché', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body>
    <h1>Il tuo conto</h1><div id="ospite"></div>
    <script>document.getElementById('ospite').attachShadow({ mode: 'closed' }).innerHTML =
      '<iframe src="${altro}" style="width:300px;height:200px;border:0"></iframe>';</script></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url().includes('sito-pubblico.test')), { timeout: 10_000 }).toBe(true);

  const { immagine, testi } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'la foto col riquadro scoperto non deve partire').toBeNull();
  expect(testi.join('\n')).toContain('non c\'è lo screenshot della pagina, perché un riquadro di un altro sito');
});

test('#810.16: il numero di carta ripetuto nell’anteprima della carta non si legge nella foto per l’Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div><span id="anteprima" style="display:inline-block;padding:6px 10px;background:${tinta(ROSA)};color:#fff;font:20px monospace">•••• •••• •••• ••••</span></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      document.getElementById('anteprima').textContent = e.target.value || '•••• •••• •••• ••••';
    });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#anteprima')).toHaveText('4111 1111 1111 1111');

  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'l’anteprima col numero si vede nella foto').toBeLessThan(20);
});

test('#810.16: l’anteprima coi gruppi di cifre sparsi sulla larghezza della carta disegnata non si legge nella foto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const gruppo = `<span style="background:${tinta(ROSA)};color:#fff">####</span>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div style="width:380px;height:220px;border-radius:14px;background:#333;padding:24px;box-sizing:border-box">
      <div id="numero" style="display:flex;justify-content:space-between;margin-top:90px;font:22px monospace">${gruppo.repeat(4)}</div></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      const g = (e.target.value.replace(/\\D/g, '') + '################').slice(0, 16).match(/.{4}/g);
      document.querySelectorAll('#numero span').forEach((s, i) => { s.textContent = g[i]; });
    });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.locator('#numero')).toContainText('4111');

  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero della carta si legge nell’anteprima').toBeLessThan(20);
});

// L'anteprima può stare in un componente aperto o in un riquadro dello stesso sito: la ricerca entra anche lì.
const ANTEPRIMA = `<span id="a" style="display:inline-block;padding:6px 10px;background:${tinta(ROSA)};color:#fff;font:20px monospace">#### #### #### ####</span>`;

test('#810.16: l’anteprima della carta dentro un componente aperto non si legge nella foto per l’Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <div id="ospite"></div>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>const sr = document.getElementById('ospite').attachShadow({ mode: 'open' });
    sr.innerHTML = '${ANTEPRIMA}';
    document.getElementById('c').addEventListener('input', (e) => { sr.getElementById('a').textContent = e.target.value; });</script></body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'l’anteprima col numero si vede nella foto').toBeLessThan(20);
});

test('#810.16: l’anteprima della carta in un riquadro dello stesso sito non si legge nella foto per l’Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const riquadro = testServer.html(`<!doctype html><body style="margin:0">${ANTEPRIMA}</body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <iframe id="carta" src="${riquadro}" style="width:320px;height:60px;border:0"></iframe>
    <form><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px"></form>
    <script>document.getElementById('c').addEventListener('input', (e) => {
      document.getElementById('carta').contentDocument.getElementById('a').textContent = e.target.value;
    });</script></body></html>`);
  await expect(page.frameLocator('#carta').locator('#a')).toBeAttached({ timeout: 10_000 });
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await expect(page.frameLocator('#carta').locator('#a')).toHaveText('4111 1111 1111 1111');
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'l’anteprima col numero si vede nella foto').toBeLessThan(20);
});

// Un riquadro dello stesso sito che la pagina disegna più grande (transform): le coperture di dentro vanno in scala.
test('#1537: un riquadro di un altro sito dentro un riquadro dello stesso sito ingrandito arriva coperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(VERDE)}"><iframe id="x" src="${altro}" style="width:100px;height:60px;border:0;display:block;margin:10px"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0;transform:scale(2.5);transform-origin:0 0"></iframe></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede nella foto').toBeLessThan(20);
  expect(await pixelDelColore(app, immagine, VERDE), 'il riquadro dello stesso sito resta').toBeGreaterThan(20_000);
});

test('#810.16: il numero della carta in un riquadro dello stesso sito ingrandito arriva coperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const modulo = testServer.html(`<!doctype html><body style="margin:0"><form><input id="c" name="q" style="width:150px;font:bold 16px monospace;color:${tinta(ROSA)};background:#fff;border:0;outline:0;caret-color:transparent"></form></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body style="margin:0">
    <h1>Pagamento</h1>
    <iframe id="modulo" src="${modulo}" style="width:160px;height:40px;border:0;transform:scale(2.5);transform-origin:0 0"></iframe></body></html>`);
  await superaAvvisoSeCe(app);
  const campo = page.frameLocator('#modulo').locator('#c');
  await campo.fill('4111 1111 1111 1111');
  await campo.blur();
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero della carta si legge nella foto').toBeLessThan(20);
});

// Ruotato, la scala non basta: il riquadro dello stesso sito si copre intero.
test('#1537: un riquadro dello stesso sito ruotato, con dentro uno di un altro sito, arriva coperto intero', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0"><iframe id="x" src="${altro}" style="width:150px;height:100px;border:0;display:block"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0;padding:80px">
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0;transform:rotate(30deg) scale(2)"></iframe></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const { immagine } = await chiediAllAiuto(app, shell, page);
  expect(immagine, 'al modello deve arrivare la foto della pagina').toMatch(/^data:image\/jpeg/);
  expect(await pixelDelColore(app, immagine, ROSA), 'il riquadro dell’altro sito si vede nella foto').toBeLessThan(20);
});

// La chat della seconda finestra: un giro chiede di guardare la prima, il secondo risponde. Il modello che legge
// l'immagine tiene da parte quello che vede.
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
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop', text: 'Una pagina di pagamento.' };
    };
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chat.push(JSON.stringify(messages));
      n += 1;
      const calls = n === 1 ? [{ id: 'v1', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: nome }) }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = n === 1 ? '' : 'Ho guardato la finestra.';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, finestra);
}

// La seconda finestra, con la chat in vista: la si riconosce dal segno che il main le mette. Può ripristinare le
// schede della prima: la chat si apre a parte, davanti.
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

test('#810.17: guardando dalla chat un’altra finestra di Filo, il numero scritto nel campo della carta arriva coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento con carta</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div>
    <form style="padding:20px"><input id="c" name="q" style="width:420px;font:bold 34px monospace;color:${tinta(ROSA)};background:#fff;border:1px solid #999;caret-color:transparent;outline:0"></form>
    </body></html>`);
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await page.locator('#c').blur();

  const chat = await secondaFinestraConChat(app);

  await chatCheGuarda(app, 'Pagamento con carta');
  await chiedi(chat, 'cosa c’è nella finestra del pagamento?');
  await expect.poll(() => app.evaluate(() => globalThis.__occhio.length), { timeout: 30_000 }).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  expect(await pixelDelColore(app, immagine, VERDE), 'deve arrivare la foto della finestra del pagamento').toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero della carta si legge nella foto').toBeLessThan(20);
});

// Lo Screenshot dal menu della scheda «Conto»: torna la foto che l'utente scarica.
async function scattaScreenshot(app, page) {
  let utente = null;
  await expect.poll(async () => {
    await page.mouse.click(5, 5);
    utente = await app.evaluate(async ({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
      const tab = tm.tabs.find((t) => t.title === 'Conto');
      return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(async () => {
        HTMLAnchorElement.prototype.click = function () { window.__foto = this.href; };
        window.__foto = null;
        await SN_ACTIONS.takeScreenshot();
        return window.__foto;
      })()` }], true);
    });
    return Boolean(utente);
  }, { timeout: 20_000 }).toBe(true);
  return utente;
}

// Lo Screenshot dal menu: l'utente tiene la foto intera, il modello che sceglie il nome del file la riceve coperta.
test('#1537: nello Screenshot il modello che sceglie il nome vede il riquadro di un altro sito coperto, l’utente intero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1><iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models }, modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
  });
  await aiutoFinto(app);

  const utente = await scattaScreenshot(app, page);
  const alModello = await app.evaluate(() => {
    const parte = globalThis.__visti.flatMap((m) => m).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((p) => p.type === 'image_url');
    return parte ? parte.image_url.url : null;
  });
  expect(alModello, 'la foto deve arrivare al modello del nome').toMatch(/^data:image\//);
  expect(await pixelDelColore(app, alModello, ROSA), 'il riquadro dell’altro sito si vede nella foto per il modello').toBeLessThan(20);
  expect(await pixelDelColore(app, utente, ROSA), 'lo screenshot dell’utente resta intero').toBeGreaterThan(20_000);
});

// Lo Screenshot di una zona scelta col mouse: il modello del nome riceve lo stesso pezzo che tiene l'utente, coperto.
test('#1537: nello Screenshot di una zona il modello del nome riceve lo stesso pezzo, col riquadro di un altro sito coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <div style="display:flex"><div style="width:300px;height:200px;background:${tinta(VERDE)}"></div>
    <iframe id="altro" src="${altro}" style="width:300px;height:200px;border:0"></iframe></div></body></html>`);
  await expect(page.frameLocator('#altro').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models }, modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
  });
  await aiutoFinto(app);
  const nelMondo = (code) => app.evaluate(({ BrowserWindow }, c) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return tm.tabs.find((t) => t.title === 'Conto').view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }], true);
  }, code);
  await nelMondo(`HTMLAnchorElement.prototype.click = function () { window.__foto = this.href; };
    window.__foto = null; SN_ACTIONS.takePartialScreenshot(); true`);
  await expect(page.locator('.sn-region-overlay')).toBeAttached({ timeout: 10_000 });
  await page.mouse.move(20, 20);
  await page.mouse.down();
  await page.mouse.move(300, 100, { steps: 5 });
  await page.mouse.move(580, 180, { steps: 5 });
  await page.mouse.up();
  let utente = null;
  await expect.poll(async () => (utente = await nelMondo('window.__foto')), { timeout: 20_000 }).toBeTruthy();
  const alModello = await app.evaluate(() => {
    const parte = globalThis.__visti.flatMap((m) => m).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((p) => p.type === 'image_url');
    return parte ? parte.image_url.url : null;
  });
  expect(alModello, 'il pezzo deve arrivare al modello del nome').toMatch(/^data:image\//);
  expect(await pixelDelColore(app, utente, ROSA), 'lo screenshot dell’utente tiene il riquadro').toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, alModello, ROSA), 'il riquadro dell’altro sito si vede nel pezzo per il modello').toBeLessThan(20);
  const [verdeUtente, verdeModello] = [await pixelDelColore(app, utente, VERDE), await pixelDelColore(app, alModello, VERDE)];
  expect(verdeUtente).toBeGreaterThan(20_000);
  expect(Math.abs(verdeModello - verdeUtente), 'il modello riceve un altro pezzo della pagina').toBeLessThan(verdeUtente * 0.05);
});

// Un riquadro di un altro sito in un componente chiuso non si può coprire: le altre due strade non ripiegano sulla
// foto intera.
const CONTO_CHIUSO = (altro, titolo) => `<!doctype html><html><head><title>${titolo}</title></head><body style="margin:0">
  <h1>Il tuo conto</h1><div id="ospite"></div>
  <script>document.getElementById('ospite').attachShadow({ mode: 'closed' }).innerHTML =
    '<iframe src="${altro}" style="width:300px;height:200px;border:0"></iframe>';</script></body></html>`;

test('#810.17: la finestra guardata dalla chat con un riquadro che non si può coprire: al modello solo il perché', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, CONTO_CHIUSO(altro, 'Estratto conto'));
  await expect.poll(() => page.frames().some((f) => f.url().includes('sito-pubblico.test')), { timeout: 10_000 }).toBe(true);
  const chat = await secondaFinestraConChat(app);
  await chatCheGuarda(app, 'Estratto conto');
  await chiedi(chat, 'cosa c’è nella finestra del conto?');
  await expect.poll(() => app.evaluate(() => globalThis.__chat.length), { timeout: 30_000 }).toBeGreaterThan(1);
  expect(await app.evaluate(() => globalThis.__occhio.length), 'la foto col riquadro scoperto non deve partire').toBe(0);
  const secondo = await app.evaluate(() => globalThis.__chat[1]);
  expect(secondo).toContain('la foto non è partita: un riquadro di un altro sito');
});

test('#1537: nello Screenshot con un riquadro che non si può coprire il modello del nome resta senza foto, l’utente la tiene', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, CONTO_CHIUSO(altro, 'Conto'));
  await expect.poll(() => page.frames().some((f) => f.url().includes('sito-pubblico.test')), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models }, modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
  });
  await aiutoFinto(app);
  const utente = await scattaScreenshot(app, page);
  expect(await pixelDelColore(app, utente, ROSA), 'lo screenshot dell’utente resta intero').toBeGreaterThan(20_000);
  const immagini = await app.evaluate(() => globalThis.__visti.flatMap((m) => m)
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length);
  expect(immagini, 'la foto scoperta è arrivata al modello del nome').toBe(0);
});
