// Verifica #868 giro 9, rilievo 1: una chat cancellata mentre Filo indicizza le conversazioni vecchie.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, readFileSync } from 'node:fs';

const ORA_MS = 60 * 60 * 1000;

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

// Una scheda nuova: un'altra home, con la sua conversazione.
async function schedaNuova(app, shell) {
  const prima = new Set(await newtabs(app));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const nuova = (await newtabs(app)).find((w) => !prima.has(w));
    if (nuova) { await nuova.waitForLoadState('domcontentloaded'); return nuova; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('seconda newtab non trovata');
}

// Modello finto: le risposte della chat escono in ordine da `copione`; i vettori sono parole chiave contate, così
// «il ristorante di Lisbona» è vicino allo scambio sul ristorante di Lisbona e lontano da tutto il resto.
async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    // L'intervista di benvenuto ha il suo blocco nelle istruzioni: qui si prova il filo di tutti i giorni.
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const TEMI = ['lisbona', 'ristorante', 'orche', 'fisica', 'esame', 'gatto', 'briciola', 'taberna'];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({
      vectors: texts.map((t) => {
        const s = String(t).toLowerCase();
        const v = TEMI.map((w) => (s.includes(w) ? 1 : 0));
        v.push(0.05);
        return v;
      }),
    });
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

// Conversazioni e pagine di giorni fa, scritte nel filo come le avrebbe scritte Filo.
async function semina(app, { chat = [], pagine = [] }) {
  await app.evaluate(async (_e, { chat, pagine, ora }) => {
    const E = globalThis.SN_FILO_EVENTI;
    const T = E.TIPI;
    const ev = [];
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    for (const c of chat) {
      ev.push(E.crea(T.CHAT_APERTA, { chat: c.id }, { ts: ts(c.oreFa), dispositivo: 'prova', autore: 'utente' }));
      c.scambi.forEach(([u, f], i) => {
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'user', text: u } }, { ts: ts(c.oreFa, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'filo', text: f } }, { ts: ts(c.oreFa, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
      });
      ev.push(E.crea(T.CHAT_CHIUSA, { chat: c.id }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'utente' }));
      if (c.titolo) ev.push(E.crea(T.CHAT_TITOLO, { chat: c.id, title: c.titolo, kind: 'conversazione' }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'filo' }));
    }
    for (const p of pagine) ev.push(E.crea(T.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: ts(p.oreFa), dispositivo: 'prova', autore: 'utente' }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { chat, pagine, ora: Date.now() });
}


test('una chat cancellata mentre si indicizzano le conversazioni vecchie non va più al modello dei vettori e non lascia il suo indice', async ({ app }) => {
  test.setTimeout(120_000);
  await primaScheda(app);
  await preparaModello(app, []);
  // Trenta conversazioni di dieci giorni fa, mai indicizzate: il primo messaggio dopo l'aggiornamento le manda tutte.
  const chat = [];
  for (let i = 0; i < 30; i++) {
    const scambi = [];
    for (let k = 0; k < 30; k++) scambi.push([`chat ${i} domanda ${k} PAROLA-${i}`, `risposta ${k}`]);
    chat.push({ id: `vecchia-${i}`, oreFa: 24 * 10 + i, scambi });
  }
  await semina(app, { chat });
  // Un modello dei vettori lento come uno vero sotto carico: l'indicizzazione dura una decina di secondi.
  await app.evaluate(() => {
    const orig = globalThis.SN_PROVIDER_OPENROUTER.embed;
    globalThis.__embedTesti = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async (a) => {
      globalThis.__embedTesti.push({ t: Date.now(), testi: a.texts.slice() });
      await new Promise((r) => setTimeout(r, 1500));
      return orig(a);
    };
  });
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'parlami di lisbona', threadHistory: [], chatId: 'scheda-x' }));
  // L'utente cancella dalla Cronologia la conversazione più recente fra quelle vecchie, mentre l'indice si fa.
  const tCanc = await app.evaluate(async () => { await globalThis.SN_FILO_CHATS.remove('vecchia-0'); return Date.now(); });
  // La domanda più 28 blocchi da 32 scambi: l'ultimo, fatto solo della chat cancellata, non parte più.
  await expect.poll(() => app.evaluate(() => globalThis.__embedTesti.length), { timeout: 40_000 }).toBeGreaterThanOrEqual(29);
  await new Promise((r) => setTimeout(r, 3000));
  const info = await app.evaluate((_e, tCanc) => ({
    f: globalThis.SN_RICORDI_FILO.file(),
    mandatiDopo: globalThis.__embedTesti.filter((e) => e.t > tCanc && e.testi.some((s) => /PAROLA-0(?!\d)/.test(s))).length,
  }), tCanc);
  const righe = existsSync(info.f) ? readFileSync(info.f, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [];
  expect(info.mandatiDopo, 'testo della chat cancellata mandato al modello dei vettori dopo la cancellazione').toBe(0);
  expect(righe.filter((v) => v.c === 'vecchia-0').length, 'vettori della chat cancellata rimasti nel file').toBe(0);
});
