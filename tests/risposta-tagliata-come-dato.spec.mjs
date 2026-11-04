// #1302 — una risposta fermata dal tetto non passa mai per intera: la spiegazione nel menu del tasto destro lo dice e
// offre «Continua» (e non torna uguale al tasto destro dopo), e chi la usa come dato (riassunto, riordino della memoria,
// ricerca della Gestione) riceve un errore che lo dice invece di un pezzo.
import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Prova</title>'
  + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce in zuccheri.</p>';
const seleziona = (page) => page.evaluate(() => {
  const r = document.createRange();
  r.selectNodeContents(document.querySelector('#t'));
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
});

// Ogni chiamata al modello qui finisce al tetto, salvo il seguito chiesto con le parole di «Continua».
async function modelloCheSiFerma(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.MANAGE_SEARCH]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    const risposta = ({ attempts, messages, onDelta }) => {
      const ultimo = JSON.stringify(messages[messages.length - 1].content || '');
      const seguito = ultimo.includes('Continua da dove ti sei interrotto');
      globalThis.__chiamate.push({ seguito });
      const text = seguito ? ' e ossigeno.' : 'La pianta usa la luce per fare zuccheri';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, finishReason: seguito ? 'stop' : 'length', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => risposta(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

test('Spiega nel menu del tasto destro: la spiegazione interrotta lo dice, «Continua» chiede il resto, e non torna uguale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await modelloCheSiFerma(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await seleziona(page);
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page);
  const spiegazione = menu.locator('.sn-menu-inline-explain');
  await expect(spiegazione).toContainText('La pianta usa la luce', { timeout: 20_000 });
  await expect(spiegazione.locator('.sn-risposta-interrotta')).toContainText('La risposta si è interrotta qui');
  await page.screenshot({ path: 'tests/.shots/1302-spiega-menu-interrotta.png' });
  const prima = await app.evaluate(() => globalThis.__chiamate.length);

  // Il tasto destro dopo sulla stessa selezione non rimostra la stessa metà: chiede di nuovo.
  await page.keyboard.press('Escape');
  await seleziona(page);
  await page.locator('#t').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu-inline-explain .sn-risposta-interrotta')).toBeVisible({ timeout: 20_000 });
  expect(await app.evaluate(() => globalThis.__chiamate.length)).toBeGreaterThan(prima);

  await menuDi(page).locator('.sn-menu-inline-explain .sn-risposta-interrotta button', { hasText: 'Continua' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.filter((c) => c.seguito).length), { timeout: 15_000 }).toBe(1);
});

test('chi usa la risposta come dato riceve un errore che nomina il tetto, mai un pezzo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await modelloCheSiFerma(app);
  const esiti = await app.evaluate(async () => {
    const M = globalThis.SN_MSG.MSG;
    const C = globalThis.SN_CONST;
    // Come la risposta che arriva alla pagina dal canale (src/main/ipc.js): un errore diventa ok:false col suo codice.
    const chiedi = (action, extra = {}) => Promise.resolve(globalThis.SN_HANDLE_MESSAGE(
      { type: M.AI_REQUEST, action, payload: { messages: [{ role: 'user', content: 'riassumi' }] }, ...extra },
      { url: 'filo://editor/editor.html' },
    )).catch((e) => ({ ok: false, error: e.message, code: e.code, ...globalThis.SN_CHAT_ERRORS.dettagliDelTetto(e) }));
    const intero = await chiedi(C.ACTIONS.EDITOR_SUMMARY, { intera: true });
    const mostrato = await chiedi(C.ACTIONS.EDITOR_SUMMARY);
    await globalThis.SN_FILO_MEMORY.appendLesson('Preferisce risposte brevi');
    const riordino = await globalThis.SN_HANDLE_MESSAGE({ type: M.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' });
    return { intero, mostrato, riordino };
  });
  expect(esiti.intero.ok).toBe(false);
  expect(esiti.intero.code).toBe('RISPOSTA_TAGLIATA');
  expect(esiti.intero.error).toMatch(/lunghezza massima/);
  // Chi la mostra a una persona la riceve, con il motivo per dirlo.
  expect(esiti.mostrato.ok).toBe(true);
  expect(esiti.mostrato.finishReason).toBe('length');
  // Il riordino della memoria chiesto a mano non finisce in silenzio.
  expect(esiti.riordino.ok).toBe(false);
  expect(esiti.riordino.code).toBe('RISPOSTA_TAGLIATA');
});
