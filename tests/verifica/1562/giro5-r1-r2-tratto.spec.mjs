// Verifica #1562 giro 5: la richiesta cresce solo in coda anche alternando una conversazione ripresa e quella della
// home (r1), e quello che cambia prima di un «Continua» arriva comunque al modello (r2).

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione, extra = {}) {
  await app.evaluate(async (_e, { copione, extra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...extra,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!(!!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      const calls = r.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, { copione, extra });
}

async function scrivi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

test('r1 una conversazione ripresa dalla Cronologia e quella della home, alternate: la richiesta di un turno resta il prefisso di quella dopo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  // Un tetto in token basso fa sì che la conversazione di stamattina cominci prima del taglio, come succede col tetto di
  // serie a chi ha letto qualche pagina lunga negli ultimi giorni.
  await preparaModello(app, [{ text: 'Risposta uno.' }, { text: 'Risposta due.' }, { text: 'Risposta tre.' }], { contestoFilo: { token: 4000 } });
  const ids = await app.evaluate(async () => {
    const Chats = globalThis.SN_FILO_CHATS;
    const ora = Date.now();
    const fa = (min) => new Date(ora - min * 60000).toISOString();
    const A = 'a1a1a1a1-0000-4000-8000-000000000001';
    const B = 'b2b2b2b2-0000-4000-8000-000000000002';
    for (let i = 0; i < 12; i++) {
      await Chats.append(A, { role: 'user', text: `Parte ${i} della tesi: ${'parole della tesi '.repeat(90)}`, ts: fa(300 - i * 2) });
      await Chats.append(A, { role: 'filo', text: `Letta la parte ${i}.`, ts: fa(299 - i * 2) });
    }
    await Chats.append(B, { role: 'user', text: 'che tempo fa domani?', ts: fa(20) });
    await Chats.append(B, { role: 'filo', text: 'Sole.', ts: fa(19) });
    return { A, B };
  });

  const ripresa = await openTab(`filo://newtab/?chat=${ids.A}`);
  await expect(ripresa.locator('#input')).toBeEditable({ timeout: 15_000 });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });

  await ripresa.bringToFront();
  await scrivi(ripresa, 'riprendiamo la tesi', 'Risposta uno.');
  await home.bringToFront();
  await scrivi(home, 'e dopodomani?', 'Risposta due.');
  await ripresa.bringToFront();
  await scrivi(ripresa, 'e la conclusione?', 'Risposta tre.');

  const [uno, due, tre] = await app.evaluate(() => globalThis.__chiamate);
  expect(due.messages[0].content).toBe(uno.messages[0].content);
  // Senza la domanda (l'ultimo messaggio), il tratto del turno prima deve stare tale e quale in testa a quello dopo.
  const tratto = (c) => c.messages.slice(1, -1).map(testo);
  expect(tratto(due).slice(0, tratto(uno).length)).toEqual(tratto(uno));
  expect(tratto(tre).slice(0, tratto(due).length)).toEqual(tratto(due));
});

test('r2 una scheda aperta prima di «Continua» arriva al modello nel messaggio dopo, come senza il Continua', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [
    // Un turno che legge e poi tace: sotto compare «Continua».
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'tema' }) }] },
    { text: '' },
    { text: 'Ripreso.' },
    { text: 'Ecco le schede.' },
  ]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('che tema ho?');
  await home.locator('#sendBtn').click();
  const continua = home.locator('.dash-continua');
  await expect(continua).toBeVisible({ timeout: 15_000 });

  // Fra il turno e il Continua l'utente apre un sito.
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Orari del museo Egizio</title><p>orari</p>');
  await expect(sito).toHaveTitle('Orari del museo Egizio');
  await home.bringToFront();
  await continua.click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ripreso.' })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

  await scrivi(home, 'quali schede ho aperto?', 'Ecco le schede.');
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const ultima = chiamate[chiamate.length - 1];
  // Nel CONTESTO o in un messaggio: da qualche parte il modello deve vedere la scheda aperta.
  const tutto = ultima.messages.map(testo).join('\n');
  expect(tutto).toContain('Orari del museo Egizio');
});
