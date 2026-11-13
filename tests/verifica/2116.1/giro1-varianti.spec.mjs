// Verifica #2116.1, giro 1: la finestra di Filo guardata dalla chat di un'altra finestra, su casse online scritte
// in modi diversi. Il numero della carta (e il CVC) è rosa: nella foto arrivata al modello non deve restare.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
import { chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const VERDE = [0x12, 0xab, 0x34];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;
const CAMPO = `font:bold 34px monospace;color:${tinta(ROSA)};background:#fff;border:1px solid #999;caret-color:transparent;outline:0`;

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

// Riempie la cassa, guarda dalla chat dell'altra finestra e torna la foto arrivata al modello.
async function fotoDallaChat(app, openTab, testServer, titolo, html, riempi) {
  const page = await testServer.openReady(openTab, html);
  await superaAvvisoSeCe(app);
  await riempi(page);
  const chat = await secondaFinestraConChat(app);
  await chatCheGuarda(app, titolo);
  await chiedi(chat, 'guarda la finestra di Filo e dimmi cosa vedi');
  const conferma = chat.locator(CONFIRM_HOST);
  await expect.poll(async () => (await app.evaluate(() => globalThis.__occhio.length + (globalThis.__chat.length > 1 ? 1 : 0)))
    + (await conferma.isVisible().catch(() => false) ? 1 : 0), { timeout: 30_000 }).toBeGreaterThan(0);
  // Una cassa riconosciuta come delicata chiede l'OK: dopo l'OK la foto deve arrivare coperta lo stesso.
  if (await conferma.isVisible().catch(() => false)) {
    await scrollConfirmToEnd(chat);
    await clickConfirm(chat, 'ok');
    await expect.poll(() => app.evaluate(() => globalThis.__occhio.length + (globalThis.__chat.length > 1 ? 1 : 0)), { timeout: 30_000 }).toBeGreaterThan(0);
  }
  const stato = await app.evaluate(() => ({ foto: globalThis.__occhio.length, secondo: String(globalThis.__chat[1] || '').slice(-1500) }));
  expect(stato.foto, `al modello non è partita la foto: ${stato.secondo}`).toBe(1);
  const [immagine] = await app.evaluate(() => globalThis.__occhio);
  return immagine;
}

test('cassa realistica: numero con gli spazi in un campo tel, scadenza e CVC', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html><html><head><title>Cassa del negozio</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div>
    <form style="padding:20px">
      <label>Intestatario <input id="nome" style="font:20px sans-serif"></label><br>
      <input id="num" type="tel" inputmode="numeric" placeholder="1234 1234 1234 1234" style="width:460px;${CAMPO}"><br>
      <input id="scad" placeholder="MM / AA" style="width:140px;font:20px sans-serif">
      <input id="cvc" placeholder="CVC" maxlength="4" style="width:120px;${CAMPO}">
    </form>
    <script>num.addEventListener('input', () => { const d = num.value.replace(/\\D/g, '').slice(0, 16); num.value = d.replace(/(.{4})/g, '$1 ').trim(); });</script>
    </body></html>`;
  const immagine = await fotoDallaChat(app, openTab, testServer, 'Cassa del negozio', html, async (page) => {
    await page.fill('#nome', 'Mario Rossi');
    await page.locator('#num').pressSequentially('4111111111111111');
    await page.fill('#scad', '12 / 29');
    await page.fill('#cvc', '737');
    await page.locator('#cvc').blur();
    await expect(page.locator('#num')).toHaveValue('4111 1111 1111 1111');
  });
  expect(await pixelDelColore(app, immagine, VERDE), 'deve arrivare la foto della cassa').toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'numero o CVC si leggono nella foto').toBeLessThan(20);
});

test('cassa col numero diviso in quattro caselle', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const casella = (i) => `<input id="p${i}" maxlength="4" style="width:110px;${CAMPO}">`;
  const html = `<!doctype html><html><head><title>Cassa a caselle</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div>
    <form style="padding:20px"><div>${[1, 2, 3, 4].map(casella).join(' ')}</div></form></body></html>`;
  const immagine = await fotoDallaChat(app, openTab, testServer, 'Cassa a caselle', html, async (page) => {
    for (const i of [1, 2, 3, 4]) await page.fill(`#p${i}`, i === 1 ? '4111' : '1111');
    await page.locator('#p4').blur();
  });
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'le caselle della carta si leggono nella foto').toBeLessThan(20);
});

test('cassa col campo della carta in un riquadro dello stesso sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dentro = testServer.html(`<!doctype html><body style="margin:0"><input id="c" style="width:460px;${CAMPO}"></body>`);
  const html = `<!doctype html><html><head><title>Cassa con riquadro</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div>
    <iframe id="f" src="${dentro}" style="width:520px;height:90px;border:0"></iframe></body></html>`;
  const immagine = await fotoDallaChat(app, openTab, testServer, 'Cassa con riquadro', html, async (page) => {
    const f = page.frameLocator('#f');
    await f.locator('#c').fill('4111 1111 1111 1111');
    await f.locator('#c').blur();
  });
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero nel riquadro si legge nella foto').toBeLessThan(20);
});

test('cassa col campo della carta dentro un componente aperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html><html><head><title>Cassa a componenti</title></head><body style="margin:0">
    <div style="height:120px;background:${tinta(VERDE)}"></div><div id="ospite" style="padding:20px"></div>
    <script>ospite.attachShadow({ mode: 'open' }).innerHTML = '<input id="c" style="width:460px;${CAMPO}">';</script>
    </body></html>`;
  const immagine = await fotoDallaChat(app, openTab, testServer, 'Cassa a componenti', html, async (page) => {
    await page.locator('#ospite #c').fill('4111 1111 1111 1111');
    await page.locator('#ospite #c').blur();
  });
  expect(await pixelDelColore(app, immagine, VERDE)).toBeGreaterThan(20_000);
  expect(await pixelDelColore(app, immagine, ROSA), 'il numero nel componente si legge nella foto').toBeLessThan(20);
});
