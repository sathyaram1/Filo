// #1302 — il tetto finito tutto nel ragionamento prima di una parola: ogni superficie con «Continua» mostra la nota e il
// tasto, e il seguito riparte con un tetto doppio senza mandare al modello un suo turno vuoto.
import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const NOTA = 'La risposta si è interrotta qui: il modello ha speso quasi tutta la lunghezza massima ragionando.';

// Ogni prima risposta è vuota e fermata ragionando; il seguito chiesto da «Continua» arriva intero.
async function modelloCheRagiona(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const m = 'deepseek-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: m, [C.ACTIONS.HELP]: m, [C.ACTIONS.DECKS_CHAT]: m, [C.ACTIONS.EXPLAIN]: m, [C.ACTIONS.EXPLAIN_DEEP]: m,
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    const risposta = ({ attempts, messages, onDelta }) => {
      const fatto = (text, finishReason) => {
        try { if (text) onDelta && onDelta(text); } catch (_) {}
        return { text, finishReason, model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
      };
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((x) => x.role === 'system') || {}).content || '');
      const ultimo = JSON.stringify((messages[messages.length - 1] || {}).content || '');
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}', 'stop');
      if (/CARTE CANDIDATE/.test(ultimo)) return fatto('{"keep":[]}', 'stop');
      const seguito = ultimo.includes('Continua da dove ti sei interrotto') || ultimo.includes('ti ha chiesto di continuare');
      const vuoto = messages.some((x) => x.role === 'assistant' && !(x.tool_calls && x.tool_calls.length)
        && !String(typeof x.content === 'string' ? x.content : JSON.stringify(x.content || '')).replace(/^""$/, '').trim());
      globalThis.__chiamate.push({ seguito, maxTokens: attempts[0].maxTokens, vuoto });
      if (!seguito) return fatto('', 'tetto_ragionamento');
      if (sistema.includes('# Protocollo di risposta')) return fatto(JSON.stringify({ text: 'Ecco la risposta intera.', status: 'done' }), 'stop');
      if (sistema.includes('deck builder per Magic')) return fatto(JSON.stringify({ reply: 'Ecco la risposta intera.' }), 'stop');
      return fatto('Ecco la risposta intera.', 'stop');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => risposta(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

// Il seguito è partito col tetto doppio della prima e senza un turno vuoto del modello. Dopo, nella home, le lezioni
// rileggono lo scambio e sembrano un altro seguito: conta il primo.
async function seguitoPiuLargo(app) {
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.filter((c) => c.seguito).length), { timeout: 15_000 }).toBeGreaterThan(0);
  const c = await app.evaluate(() => globalThis.__chiamate);
  const prima = c.find((x) => !x.seguito);
  const dopo = c.find((x) => x.seguito);
  expect(prima.maxTokens).toBeGreaterThan(0);
  expect(dopo.maxTokens).toBe(prima.maxTokens * 2);
  expect(dopo.vuoto).toBe(false);
}

test('Home: la bolla vuota ha la nota e «Continua», che riparte con più spazio', async ({ app }) => {
  test.setTimeout(60_000);
  await modelloCheRagiona(app);
  const casa = await home(app);
  await casa.locator('#input').fill('scrivimi un saggio lungo');
  await casa.locator('#sendBtn').click();
  await expect(casa.locator('.dash-bubble-filo .dash-bubble-interrotta')).toHaveText(NOTA, { timeout: 15_000 });
  await casa.getByRole('button', { name: 'Continua' }).last().click();
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Ecco la risposta intera.' })).toBeVisible({ timeout: 15_000 });
  await seguitoPiuLargo(app);
});

test('Riquadro delle risposte: la nota e «Continua» anche senza testo', async ({ app }) => {
  test.setTimeout(60_000);
  await modelloCheRagiona(app);
  const page = await home(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
    anchor: { x: 120, y: 300 },
    title: 'Approfondisci',
  }));
  const nota = page.locator('.sn-popup .sn-risposta-interrotta');
  await expect(nota).toContainText(NOTA, { timeout: 8000 });
  await nota.locator('button', { hasText: 'Continua' }).click();
  await expect(page.locator('.sn-popup')).toContainText('Ecco la risposta intera.', { timeout: 8000 });
  await seguitoPiuLargo(app);
});

test('Spiega nel tasto destro: senza testo la nota e «Continua», che apre il riquadro col seguito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await modelloCheRagiona(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Prova</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce in zuccheri.</p>');
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#t').click({ button: 'right' });
  const nota = menuDi(page).locator('.sn-menu-inline-explain .sn-risposta-interrotta');
  await expect(nota).toContainText(NOTA, { timeout: 20_000 });
  await expect(menuDi(page).locator('.sn-menu-inline-explain.sn-menu-inline-error')).toHaveCount(0);
  await nota.locator('button', { hasText: 'Continua' }).click();
  await seguitoPiuLargo(app);
});

test('Aiuto: la risposta vuota ha la nota e «Continua»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloCheRagiona(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1><button>Iscriviti</button>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'come mi iscrivo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.getByText(NOTA)).toBeVisible({ timeout: 10_000 });
  await aiuto.locator('.sn-sidebar-choice', { hasText: 'Continua' }).click();
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Ecco la risposta intera.', { timeout: 10_000 });
  await seguitoPiuLargo(app);
});

test('Mazzi: la risposta vuota ha la nota e «Continua»', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await modelloCheRagiona(app);
  await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  const bolla = mazzi.locator('.dk-msg-bot').last();
  await expect(bolla.locator('.dk-msg-pending')).toHaveText(NOTA, { timeout: 15_000 });
  await bolla.locator('[data-continua]').click();
  await expect(mazzi.locator('.dk-msg-bot').last()).toContainText('Ecco la risposta intera.', { timeout: 15_000 });
  await seguitoPiuLargo(app);
});
