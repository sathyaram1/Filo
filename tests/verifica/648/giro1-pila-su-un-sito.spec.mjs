// #648 (giro 1 di verifica) — la stessa pila, ma sopra un SITO.
//
// La lamentela parlava della home di Filo. Sopra un sito però la regola che
// decide di chi era l'Esc è un'altra (lì non vale «la pagina si è alleggerita»:
// la pagina è del sito), quindi il tetto va provato anche di qua. Se la pila
// reggesse solo sulle pagine di Filo, la stessa cosa riuscirebbe su una strada
// e non sull'altra.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = `<!doctype html><html><body style="margin:0;height:1200px">
<h1 id="t">un sito qualunque</h1>
<p id="a">alfa dentro una frase</p>
<p id="b">bravo dentro una frase</p>
<p id="c">charlie dentro una frase</p>
<p id="d">delta dentro una frase</p>
</body></html>`;

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !!t.contentFullscreen;
  });
}

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 30_000));
        onDelta('.');
        return { text: '.', usage: {} };
      },
    };
  });
}

// Una risposta in più, aperta come la apre l'utente: selezione + scorciatoia.
async function apriRisposta(app, page, sel) {
  await page.evaluate((q) => {
    const p = document.querySelector(q);
    const range = document.createRange();
    range.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, sel);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await new Promise((r) => setTimeout(r, 900));
}

test('sito: quattro risposte impilate — nessuno dei quattro Esc porta via la modalità', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, SITO);
  await preparaProvider(app);
  await entra(app);

  for (const sel of ['#a', '#b', '#c', '#d']) await apriRisposta(app, page, sel);
  const aperti = await page.locator('.sn-popup').count();
  // Quante se ne impilino davvero lo decide Filo: qui si giudica la modalità,
  // non il numero. Con meno di due riquadri non ci sarebbe niente da provare.
  expect(aperti, 'sul sito non si è impilato niente: la prova non direbbe nulla').toBeGreaterThan(1);

  for (let i = 1; i <= aperti; i += 1) {
    if (await page.locator('.sn-popup').count() === 0) break;
    await esc(app);
    expect(
      await schermoIntero(app),
      `l'Esc numero ${i} ha portato via la modalità con dei riquadri ancora aperti sopra il sito`,
    ).toBe(true);
  }
  expect(await page.locator('.sn-popup').count(), 'la pila si è svuotata').toBe(0);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});
