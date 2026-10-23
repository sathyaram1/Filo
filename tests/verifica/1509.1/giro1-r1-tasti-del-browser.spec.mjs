// Verifica #1509.1 giro 1, rilievo 1: con la tastiera in un riquadro di Filo sopra un sito i tasti del browser
// (chiudi scheda, indietro) devono funzionare come quando il riquadro stava nella pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body style="padding:40px;font:20px sans-serif">'
  + '<p>Il <span id="parola">gatto</span> dorme.</p></body></html>';

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

// La finestra davanti e la scheda a fuoco, come quando l'utente ci ha appena cliccato.
const aFuoco = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  w.show(); w.focus();
  w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
}, url);

// Il tasto arriva dove sta la tastiera, come una pressione vera.
const premi = (app, keyCode, modifiers) => app.evaluate(async ({ BrowserWindow, webContents }, { k, m }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const f = webContents.getFocusedWebContents();
  f.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
  f.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
  await new Promise((ok) => setTimeout(ok, 800));
  return { dove: f.getURL(), schede: w._filoTabs.tabs.map((t) => t.view.webContents.getURL()) };
}, { k: keyCode, m: modifiers });

async function rispostaAperta(app, p) {
  await aFuoco(app, p.url());
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await p.waitForTimeout(300);
}

test('r1 con la traduzione aperta su un sito, Ctrl+W chiude la scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina);
  const url = p.url();
  await rispostaAperta(app, p);
  const r = await premi(app, 'W', ['control']);
  expect(r.schede, `tasto arrivato a ${r.dove}`).not.toContain(url);
});

test('r1 con la traduzione aperta su un sito, Alt+Sinistra torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, '<h1>prima</h1>');
  const prima = p.url();
  await p.goto(testServer.html(pagina));
  await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await rispostaAperta(app, p);
  await premi(app, 'Left', ['alt']);
  await expect.poll(() => p.url(), { timeout: 5000 }).toBe(prima);
});
