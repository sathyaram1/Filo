
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamate);
const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const posContesto = (msgs) => msgs.findIndex((m) => m.role === 'user' && testo(m).startsWith('═══ CONTESTO DI ADESSO'));



// Una lettura (documento, pagina, comando) oggi vive al più venti messaggi, e solo nella conversazione che l'ha fatta.
test('r1 un documento letto in una conversazione finita non torna davanti a Filo a ogni messaggio delle altre schede', async ({ app }) => {
  test.setTimeout(150_000);
  await primaScheda(app);
  const casa = cartellaInCasa('filo-868-g2-');
  const doc = join(casa, 'contratto.txt');
  writeFileSync(doc, 'Contratto di affitto. Punto 3: il canone mensile è di 742 euro, da pagare entro il giorno 5.');
  try {
    const copione = [
      { text: '', tools: [{ name: 'LEGGI_DOCUMENTO', args: { percorso: doc } }] },
      { text: 'Ho letto il contratto.' },
    ];
    const N = 21;
    for (let i = 0; i < N; i++) copione.push({ text: `Risposta ${i}.` });
    await preparaModello(app, copione);
    const a = await app.evaluate((_e, doc) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: `leggi ${doc}`, threadHistory: [], chatId: 'scheda-contratto' }), doc);
    expect(a.actions.find((x) => x.type === 'LEGGI_DOCUMENTO')._executed).toBe(true);
    let storia = [];
    for (let i = 0; i < N; i++) {
      const q = `domanda numero ${i} su tutt'altro`;
      const r = await app.evaluate((_e, { q, storia }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: q, threadHistory: storia, chatId: 'scheda-altro' }), { q, storia });
      storia = [...storia, { role: 'user', text: q }, { role: 'filo', text: r.text, actions: r.actions || [] }];
    }
    const tutte = await chiamate(app);
    const ultima = tutte[tutte.length - 1];
    // Quarantadue messaggi dopo, in un'altra conversazione: il testo del contratto non deve esserci più.
    expect(ultima.map(testo).join('\n')).not.toContain('742 euro');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

test('r2 un messaggio lunghissimo incollato si rilegge intero con la ricerca, come promette il taglio', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  const lungo = 'a'.repeat(100_000) + ' SEGNO-DEL-MEZZO-77 ' + 'b'.repeat(100_000);
  await preparaModello(app, [
    { text: 'Letto.' },
    { text: '', tools: [{ name: 'CERCA_CHAT', args: { id: 'scheda-lunga' } }] },
    { text: 'Fatto.' },
  ]);
  await app.evaluate((_e, lungo) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: lungo, threadHistory: [], chatId: 'scheda-lunga' }), lungo);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'cosa c\'era in mezzo al testo che ti ho incollato?', threadHistory: [], chatId: 'scheda-altra' }));
  const tutte = await chiamate(app);
  const secondo = tutte[1];
  const k = posContesto(secondo);
  const tratto = secondo.slice(0, k).map(testo).join('\n');
  expect(tratto).toContain('si rileggono interi con CERCA_CHAT');
  expect(tratto).not.toContain('SEGNO-DEL-MEZZO-77');
  const terzo = tutte[2];
  expect(testo(terzo.find((m) => m.role === 'tool'))).toContain('SEGNO-DEL-MEZZO-77');
});
