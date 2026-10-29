// #1097.3 giro 1 — una risposta fermata a metà si riprende con «Continua» in ogni chat: Mazzi, Aiuto (che dal #1433 è
// anche la chat dell'Editor) e home, e la riga che lo dice si legge da nota, non come parole del modello.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

// Primo giro fermato dal tetto; il seguito chiesto con le parole di «Continua» arriva intero.
async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP]: 'deepseek-flash',
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__seguiti = [];
    const risposta = ({ attempts, messages }) => {
      const fatto = (text, finishReason = 'stop') => ({ text, finishReason, model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const ultimo = JSON.stringify((messages[messages.length - 1] || {}).content || '');
      const seguito = ultimo.includes('Continua da dove ti sei interrotto');
      if (seguito) globalThis.__seguiti.push(sistema.slice(0, 40));
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (/CARTE CANDIDATE/.test(ultimo)) return fatto('{"keep":[]}');
      if (sistema.includes('# Protocollo di risposta')) {
        return seguito ? fatto(JSON.stringify({ text: 'poi premi Invia.', status: 'done' }))
          // Tagliata dal tetto a metà dell'involucro, come arriva davvero: senza la chiusura.
          : fatto('{"text": "Per iscriverti apri il modulo e', 'length');
      }
      if (sistema.includes('deck builder per Magic')) {
        return seguito ? fatto(JSON.stringify({ reply: 'e qualche rampa in più.' }))
          : fatto('{"reply": "Per questo mazzo servono più pescate', 'length');
      }
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => {
      const r = risposta(o);
      try { o.onDelta && o.onDelta(r.text); } catch (_) {}
      return r;
    };
  });
}

test('Mazzi: la risposta interrotta lo dice da nota, e «Continua» chiede il seguito', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  const bolla = mazzi.locator('.dk-msg-bot').last();
  await expect(bolla.locator('.dk-msg-text')).toHaveText('Per questo mazzo servono più pescate', { timeout: 15_000 });
  await expect(bolla.locator('.dk-msg-pending')).toHaveText('La risposta si è interrotta qui: ha raggiunto la lunghezza massima.');
  mkdirSync(SHOTS, { recursive: true });
  await bolla.screenshot({ path: `${SHOTS}/1097-mazzi-continua.png` });
  await bolla.locator('[data-continua]').click();
  await expect(mazzi.locator('.dk-msg-bot').last()).toContainText('e qualche rampa in più.', { timeout: 15_000 });
  await expect(mazzi.locator('[data-continua]')).toHaveCount(0);
});

test('Aiuto: la risposta interrotta offre «Continua», che chiede il seguito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1><button>Iscriviti</button>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await sito.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await sito.fill('.sn-sidebar-input textarea', 'come mi iscrivo?');
  await sito.press('.sn-sidebar-input textarea', 'Enter');
  await expect(sito.locator('.sn-sidebar-msg-assistant').last()).toContainText('apri il modulo e', { timeout: 10_000 });
  await expect(sito.locator('.sn-sidebar-msg-assistant').last()).not.toContainText('{');
  const continua = sito.locator('.sn-sidebar-choice', { hasText: 'Continua' });
  await expect(continua).toBeVisible();
  await continua.click();
  await expect(sito.locator('.sn-sidebar-msg-assistant').last()).toContainText('poi premi Invia.', { timeout: 10_000 });
});

test('Home: la riga «interrotta» dentro la bolla ha l\'aspetto di una nota, in chiaro e in scuro', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = 'Le tappe del viaggio sono: Roma, Firenze, Bologna e';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, finishReason: 'length', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
  });
  const casa = await home(app);
  await casa.locator('#input').fill('dimmi le tappe del viaggio');
  await casa.locator('#sendBtn').click();
  const nota = casa.locator('.dash-bubble-filo .dash-bubble-interrotta');
  await expect(nota).toHaveText('La risposta si è interrotta qui: ha raggiunto la lunghezza massima.', { timeout: 15_000 });
  expect(await nota.evaluate((n) => getComputedStyle(n).fontStyle)).toBe('italic');
  mkdirSync(SHOTS, { recursive: true });
  await casa.locator('.dash-bubble-filo').last().screenshot({ path: `${SHOTS}/1097-home-interrotta-chiaro.png` });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(casa.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await casa.waitForTimeout(400);
  await casa.locator('.dash-bubble-filo').last().screenshot({ path: `${SHOTS}/1097-home-interrotta-scuro.png` });
});

// Una risposta di casa che il tetto ferma: dentro un blocco di codice, o a metà degli argomenti di un'azione.
async function casaFermata(app, risposta) {
  await app.evaluate(async (_e, r) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giri = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      globalThis.__giri += 1;
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { text: r.text, finishReason: 'length', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: r.toolCalls || [], reasoningDetails: [] };
    };
  }, risposta);
  return home(app);
}

test('Home: interrotta dentro un blocco di codice, la riga resta una nota fuori dal codice', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = await casaFermata(app, { text: 'Ecco lo script:\n\n```python\nfor i in range(10):\n    print(i' });
  await casa.locator('#input').fill('scrivimi uno script');
  await casa.locator('#sendBtn').click();
  const nota = casa.locator('.dash-bubble-filo .dash-bubble-interrotta');
  await expect(nota).toHaveText('La risposta si è interrotta qui: ha raggiunto la lunghezza massima.', { timeout: 15_000 });
  await expect(casa.locator('.dash-bubble-filo pre').last()).not.toContainText('interrotta');
});

test('Home: il tetto che taglia gli argomenti di un\'azione ferma il turno con «Continua», senza rifarla', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = await casaFermata(app, {
    text: 'Cerco.',
    toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query": "meteo di domani a Bolo' }],
  });
  await casa.locator('#input').fill('che tempo fa domani?');
  await casa.locator('#sendBtn').click();
  await expect(casa.locator('.dash-bubble-filo .dash-bubble-interrotta')).toBeVisible({ timeout: 15_000 });
  await expect(casa.getByRole('button', { name: 'Continua' }).last()).toBeVisible();
  expect(await app.evaluate(() => globalThis.__giri)).toBe(1);
});
