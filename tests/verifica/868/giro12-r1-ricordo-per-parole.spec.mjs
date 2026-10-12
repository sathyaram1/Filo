// Verifica #868 giro 12, rilievo 1: senza vettori il ricordo per parole pretende nello scambio vecchio ogni parola della
// domanda, anche con la punteggiatura attaccata («Lisbona?») o assente da tutte le conversazioni («chiamava»).

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabs(app) {
  return app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
}

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [win] = await newtabs(app);
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // Il modello dei vettori non risponde (fornitore giù, nessun modello d'indicizzazione): il ricordo va per parole.
    globalThis.SN_PROVIDER_OPENROUTER.embed = async () => { throw new Error('vettori non disponibili'); };
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.text) { try { onDelta && onDelta(r.text); } catch (_) {} }
      return { ...base, text: r.text || '', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
}

async function semina(app, chat) {
  await app.evaluate(async (_e, { chat, ora }) => {
    const E = globalThis.SN_FILO_EVENTI; const T = E.TIPI; const ev = [];
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    for (const c of chat) {
      ev.push(E.crea(T.CHAT_APERTA, { chat: c.id }, { ts: ts(c.oreFa), dispositivo: 'prova', autore: 'utente' }));
      c.scambi.forEach(([u, f], i) => {
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'user', text: u } }, { ts: ts(c.oreFa, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'filo', text: f } }, { ts: ts(c.oreFa, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
      });
      ev.push(E.crea(T.CHAT_CHIUSA, { chat: c.id }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'utente' }));
      ev.push(E.crea(T.CHAT_TITOLO, { chat: c.id, title: c.titolo, kind: 'conversazione' }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'filo' }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { chat, ora: Date.now() });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const posContesto = (msgs) => msgs.findIndex((m) => m.role === 'user' && testo(m).startsWith('═══ CONTESTO DI ADESSO'));

// «il ristorante di Lisbona» lo ripesca; col punto interrogativo, o con una parola che lo scambio non ha, no.
for (const domanda of ['il ristorante di Lisbona?', 'come si chiamava il ristorante di Lisbona']) {
  test(`r1 senza vettori, «${domanda}» ripesca lo scambio vecchio sul ristorante`, async ({ app }) => {
    test.setTimeout(90_000);
    const page = await primaScheda(app);
    await semina(app, [
      { id: 'vecchia-lisbona', oreFa: 10 * 24, titolo: 'Viaggio a Lisbona', scambi: [['consigliami un ristorante di pesce a Lisbona', 'Ti consiglio la Taberna da Rua das Flores, in Chiado.']] },
      { id: 'vecchia-mutuo', oreFa: 8 * 24, titolo: 'Rata del mutuo', scambi: [['quanto pago di rata del mutuo?', 'La rata è di 640 euro al mese.']] },
    ]);
    await preparaModello(app, [{ text: 'Si chiamava Taberna.' }]);
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    await page.locator('#input').fill(domanda);
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Si chiamava Taberna.' })).toBeVisible({ timeout: 15_000 });
    const tutte = await app.evaluate(() => globalThis.__chiamate);
    const ultimo = tutte[tutte.length - 1];
    const ctx = testo(ultimo[posContesto(ultimo)]);
    expect(ctx, 'lo scambio sul ristorante non è arrivato al modello').toContain('Taberna da Rua das Flores');
    await expect(page.locator('.dash-activity-row', { hasText: 'Ricordato dal filo' })).toHaveCount(1);
  });
}
