// #1509.1 giro 4: con una risposta di Filo aperta sopra un sito, il tasto laterale del mouse non clicca la pagina (r1),
// e lo screenshot del feedback mostra la risposta che l'utente ha davanti (r2).
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, neiRiquadri, statoDi, clicca, conta, scrivi, nelloStrato, paginaDelloStrato } from '../../helpers/riquadri.mjs';

// Dove arriva il mouse dell'utente sopra la risposta aperta: lo strato sopra la scheda se c'è, la scheda altrimenti.
const sottoIlMouse = async (app, p) => ((await nelloStrato(app, p, () => true)) ? paginaDelloStrato(app, p) : p);

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;background:#fff">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}</body></html>`;

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'The cat sleeps.', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
}

async function traduci(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('translate-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
}

test('r1 con la risposta aperta i tasti laterali del mouse sulla pagina non premono quello che c\'è sotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<button id="compra" onclick="window.__compra=(window.__compra||0)+1" style="margin-top:300px;width:300px;height:80px">Compra</button>'));
  await traduci(app, p);
  const dove = await sottoIlMouse(app, p);
  const cdp = await dove.context().newCDPSession(dove);
  const b = await p.locator('#compra').boundingBox();
  const x = Math.round(b.x + b.width / 2);
  const y = Math.round(b.y + b.height / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const [button, bit] of [['back', 8], ['forward', 16]]) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: bit, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
  }
  await p.waitForTimeout(800);
  expect(await p.evaluate(() => window.__compra || 0), 'il pulsante della pagina non è stato premuto').toBe(0);
  expect(await conta(app, p, '.sn-popup')).toBe(1);
});

test('r2 lo screenshot del feedback mostra la risposta di Filo aperta sulla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const risposta = await statoDi(app, p, '.sn-popup-body');
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  expect(await conta(app, p, '.sn-popup'), 'la risposta resta aperta sotto il feedback').toBe(1);
  await neiRiquadri(app, p, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'submit_feedback') { globalThis.__inviato = m.payload; return Promise.resolve({ ok: true }); }
      return orig(m, ...r);
    };
  });
  await scrivi(app, p, '.sn-fb-text', 'la traduzione è sbagliata');
  await clicca(app, p, '.sn-fb-clear');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => neiRiquadri(app, p, () => (globalThis.__inviato?.images || []).length), { timeout: 15_000 }).toBeGreaterThan(0);
  // Il colore della foto dove l'utente vedeva la risposta: la pagina sotto è bianca.
  const colore = await neiRiquadri(app, p, async (r) => {
    const imgs = globalThis.__inviato.images;
    const src = imgs[imgs.length - 1].dataUrl;
    const im = new Image();
    await new Promise((ok, ko) => { im.onload = ok; im.onerror = ko; im.src = src; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    const s = im.naturalWidth / innerWidth;
    return [...cx.getImageData(Math.round((r.x + 8) * s), Math.round((r.y + r.height / 2) * s), 1, 1).data].slice(0, 3);
  }, { x: risposta.x, y: risposta.y, height: risposta.height });
  expect(colore.every((v) => v > 250), `colore nella foto dove stava la risposta: ${colore}`).toBe(false);
});
