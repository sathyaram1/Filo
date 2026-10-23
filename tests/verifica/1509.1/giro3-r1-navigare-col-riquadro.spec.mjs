// #1509.1 giro 3, r1 — Con un riquadro di Filo aperto (o appena chiuso) su un sito, seguire un collegamento della
// pagina o tornarci sopra col mouse dopo un minuto non deve bloccare Filo: niente errori del processo principale, la
// pagina va dove l'utente ha chiesto e Filo continua a rispondere.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
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
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
}

// Un errore non preso nel processo principale apre una finestra d'errore che blocca Filo: qui si annota invece.
const annotaErrori = (app) => app.evaluate(() => {
  globalThis.__errori1509 = [];
  process.prependListener('uncaughtException', (e) => { globalThis.__errori1509.push(String((e && e.stack) || e).slice(0, 400)); });
});
const errori = (app) => Promise.race([
  app.evaluate(() => globalThis.__errori1509),
  new Promise((ok) => setTimeout(() => ok(['Filo non risponde']), 5000)),
]);

async function traduci(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
}

// Il mouse vero arriva allo strato, che sta sopra la pagina: come lo manda il sistema.
const mouseSulloStrato = (app, eventi) => app.evaluate(({ webContents }, ev) => {
  const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
  for (const e of ev) f.sendInputEvent(e);
}, eventi);

test('r1 con la risposta aperta un clic su un collegamento della pagina la apre e Filo resta vivo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  await annotaErrori(app);
  const b = await p.locator('#vai').boundingBox();
  const x = Math.round(b.x + 10);
  const y = Math.round(b.y + 10);
  await mouseSulloStrato(app, [
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
  ]);
  await expect.poll(() => p.url(), { timeout: 10_000 }).toBe(dest);
  await p.waitForTimeout(1500);
  expect(await errori(app)).toEqual([]);
  // Filo risponde ancora: una scheda nuova si apre.
  const altra = await testServer.openReady(openTab, pagina());
  expect(altra.url()).toContain('127.0.0.1');
});

test('r1 un minuto dopo aver chiuso la risposta, passare sopra un collegamento non blocca Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<p><a id="vai" href="#altrove" style="font-size:30px">vai</a></p>'));
  await traduci(app, p);
  await annotaErrori(app);
  // Il mouse passa sulla pagina mentre la risposta è aperta, poi Esc la chiude.
  await mouseSulloStrato(app, [{ type: 'mouseMove', x: 900, y: 600 }, { type: 'mouseMove', x: 905, y: 605 }]);
  const strato = await paginaDelloStrato(app, p);
  await strato.keyboard.press('Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
  // Si continua a leggere la pagina; dopo un minuto il mouse passa sopra un collegamento.
  await p.waitForTimeout(63_000);
  const b = await p.locator('#vai').boundingBox();
  await app.evaluate(({ BrowserWindow }, { u, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs);
    const wc = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 });
    wc.sendInputEvent({ type: 'mouseMove', x, y });
  }, { u: p.url(), x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
  await p.waitForTimeout(1500);
  expect(await errori(app)).toEqual([]);
});
