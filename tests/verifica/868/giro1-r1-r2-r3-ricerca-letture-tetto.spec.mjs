// #868 giro 1 — la ricerca nel filo con le parole della richiesta, e la vita di una lettura quando si parla altrove.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0, 0, 1]) });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.text) { try { onDelta && onDelta(r.text); } catch (_) {} }
      return {
        ...base, text: r.text || '',
        toolCalls: (r.tools || []).map((t, i) => ({ id: `t${globalThis.__chiamate.length}_${i}`, name: t.name, arguments: JSON.stringify(t.args || {}) })),
        reasoningDetails: [], finishReason: r.tools ? 'tool_calls' : 'stop',
      };
    };
  }, copione);
}

const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

test('r1 «la pagina sulle orche»: la ricerca nel filo trova la pagina visitata anche se la domanda ha qualche parola in più', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<!doctype html><title>Orche - Wikipedia</title><h1>Orche</h1>');
  await app.evaluate(async (_e, { url, ora }) => {
    const E = globalThis.SN_FILO_EVENTI;
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    const meta = (oreFa, autore, piu) => ({ ts: ts(oreFa, piu), dispositivo: 'prova', autore });
    const T = E.TIPI;
    // Una chat sulle orche c'è anche: la ricerca trova lei, e il modello non ha motivo di riprovare.
    const ev = [
      E.crea(T.CHAT_APERTA, { chat: 'orche-chat' }, meta(30, 'utente', 0)),
      E.crea(T.MESSAGGIO, { chat: 'orche-chat', msg: { role: 'user', text: 'le orche cacciano in gruppo?' } }, meta(30, 'utente', 1000)),
      E.crea(T.MESSAGGIO, { chat: 'orche-chat', msg: { role: 'filo', text: 'Sì, in branchi familiari.' } }, meta(30, 'filo', 5000)),
      E.crea(T.CHAT_CHIUSA, { chat: 'orche-chat' }, meta(29, 'utente', 0)),
      E.crea(T.NAVIGAZIONE, { url, titolo: 'Orche - Wikipedia' }, meta(20, 'utente', 0)),
    ];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { url, ora: Date.now() });
  await preparaModello(app, [
    { text: '', tools: [{ name: 'CERCA_CHAT', args: { query: 'pagina sulle orche chiusa ieri' } }] },
    { text: 'Eccola.' },
  ]);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'riapri quella pagina sulle orche che ho chiuso ieri', threadHistory: [], chatId: 'scheda-orche' }));
  const [, secondo] = await app.evaluate(() => globalThis.__chiamate);
  const esito = testo(secondo.find((m) => m.role === 'tool'));
  expect(esito).toContain(url);
});

test('r2 un documento letto in una scheda resta davanti a Filo in quella scheda anche dopo dieci scambi in un\'altra', async ({ app }) => {
  test.setTimeout(120_000);
  const casa = cartellaInCasa('filo-868-v-');
  const doc = join(casa, 'contratto.txt');
  writeFileSync(doc, 'Contratto di affitto. Punto 3: il canone mensile è di 742 euro, da pagare entro il giorno 5.');
  try {
    const copione = [
      { text: '', tools: [{ name: 'LEGGI_DOCUMENTO', args: { percorso: doc } }] },
      { text: 'Ho letto il contratto.' },
    ];
    const N = Number(process.env.N868 || 11);
    for (let i = 0; i < N; i++) copione.push({ text: `Risposta ${i}.` });
    copione.push({ text: 'Il canone è 742 euro.' });
    await preparaModello(app, copione);
    const domanda = `leggi ${doc}`;
    const a = await app.evaluate((_e, domanda) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: domanda, threadHistory: [], chatId: 'scheda-contratto' }), domanda);
    expect(a.actions.find((x) => x.type === 'LEGGI_DOCUMENTO')._executed).toBe(true);
    let storiaB = [];
    for (let i = 0; i < N; i++) {
      const q = `domanda numero ${i} su tutt'altro`;
      const r = await app.evaluate((_e, { q, storiaB }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: q, threadHistory: storiaB, chatId: 'scheda-altro' }), { q, storiaB });
      storiaB = [...storiaB, { role: 'user', text: q }, { role: 'filo', text: r.text, actions: r.actions || [] }];
    }
    // La scheda del contratto ha ancora tutto: due messaggi, e la lettura con il suo esito.
    const storiaA = [{ role: 'user', text: domanda }, { role: 'filo', text: a.text, actions: a.actions }];
    await app.evaluate((_e, storiaA) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'quanto pago al mese secondo il punto 3?', threadHistory: storiaA, chatId: 'scheda-contratto' }), storiaA);
    const chiamate = await app.evaluate(() => globalThis.__chiamate);
    const ultima = chiamate[chiamate.length - 1];
    expect(ultima.map(testo).join('\n')).toContain('742 euro');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

test('r3 col tetto in token più basso, la conversazione della scheda non lo scavalca', async ({ app }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Ok.' }]);
  await app.evaluate(async (_e, ora) => {
    const E = globalThis.SN_FILO_EVENTI;
    const T = E.TIPI;
    const meta = (minFa, autore) => ({ ts: new Date(ora - minFa * 60000).toISOString(), dispositivo: 'prova', autore });
    const ev = [E.crea(T.CHAT_APERTA, { chat: 'lunga' }, meta(120, 'utente'))];
    for (let i = 0; i < 30; i++) {
      const role = i % 2 ? 'filo' : 'user';
      ev.push(E.crea(T.MESSAGGIO, { chat: 'lunga', msg: { role, text: `testo incollato numero ${i}: ${'parola '.repeat(300)}` } }, meta(100 - i, role === 'user' ? 'utente' : 'filo')));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { token: 2000 } });
  }, Date.now());
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'riassumi', threadHistory: [], chatId: 'lunga' }));
  const [primo] = await app.evaluate(() => globalThis.__chiamate);
  const k = primo.findIndex((m) => m.role === 'user' && testo(m).startsWith('═══ CONTESTO DI ADESSO'));
  const caratteri = primo.slice(1, k).reduce((n, m) => n + testo(m).length, 0);
  // Il tetto è di 2000 token: circa 7000 caratteri, alla stima che usa Filo stesso.
  expect(caratteri).toBeLessThanOrEqual(2000 * 3.5);
});
