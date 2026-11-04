// #1097.3 giro 1 — una risposta fermata a metà si riprende con «Continua» in ogni chat: Mazzi, Aiuto (che dal #1433 è
// anche la chat dell'Editor) e home, e la riga che lo dice si legge da nota, non come parole del modello.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';
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
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'come mi iscrivo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('apri il modulo e', { timeout: 10_000 });
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).not.toContainText('{');
  const continua = aiuto.locator('.sn-sidebar-choice', { hasText: 'Continua' });
  await expect(continua).toBeVisible();
  // #1302: la bozza che si stava scrivendo resta, e la richiesta del seguito non diventa una bolla dell'utente.
  await aiuto.fill('.sn-sidebar-input textarea', 'e dopo cosa');
  await continua.click();
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('poi premi Invia.', { timeout: 10_000 });
  await expect(aiuto.locator('.sn-sidebar-input textarea')).toHaveValue('e dopo cosa');
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: 'Continua da dove' })).toHaveCount(0);
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: 'come mi iscrivo?' })).toHaveCount(1);
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
    globalThis.__inviati = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__giri += 1;
      globalThis.__inviati.push(JSON.stringify(messages));
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

// #1302: il seguito di una risposta fermata dentro un blocco di codice riparte dentro il blocco, non come testo.
test('Home: «Continua» dentro un blocco di codice lo riapre', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giri = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      globalThis.__giri += 1;
      const primo = globalThis.__giri === 1;
      const text = primo ? 'Ecco lo script:\n\n```python\nfor i in range(10):\n    print(i' : ')\n    totale += i\n```\nFatto.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, finishReason: primo ? 'length' : 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
  });
  const casa = await home(app);
  await casa.locator('#input').fill('scrivimi uno script');
  await casa.locator('#sendBtn').click();
  await casa.getByRole('button', { name: 'Continua' }).last().click({ timeout: 15_000 });
  const seguito = casa.locator('.dash-bubble-filo', { hasText: 'Fatto.' });
  await expect(seguito).toBeVisible({ timeout: 15_000 });
  await expect(seguito.locator('pre')).toContainText('totale += i');
  await expect(seguito.locator('pre')).not.toContainText('Fatto.');
});

test('Home: il tetto che taglia gli argomenti di un\'azione ferma il turno con «Continua», senza rifarla', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = await casaFermata(app, {
    text: 'Cerco.',
    toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query": "meteo di domani a Bolo' }],
  });
  await casa.locator('#input').fill('che tempo fa domani?');
  await casa.locator('#sendBtn').click();
  const frase = await app.evaluate(() => globalThis.SN_CHAT_ERRORS.FRASE_AZIONE_TAGLIATA);
  await expect(casa.locator('.dash-bubble-filo .dash-bubble-interrotta')).toHaveText(frase, { timeout: 15_000 });
  await expect(casa.getByRole('button', { name: 'Continua' }).last()).toBeVisible();
  expect(await app.evaluate(() => globalThis.__giri)).toBe(1);
  // #1302: al «Continua» il modello ritrova nella conversazione che l'azione non è partita e come rifarla.
  await casa.getByRole('button', { name: 'Continua' }).last().click();
  await expect.poll(() => app.evaluate(() => globalThis.__giri), { timeout: 15_000 }).toBe(2);
  const secondo = await app.evaluate(() => globalThis.__inviati[1]);
  expect(secondo).toContain('l\'azione non è partita');
  expect(secondo).toContain('divisa in più parti');
});
