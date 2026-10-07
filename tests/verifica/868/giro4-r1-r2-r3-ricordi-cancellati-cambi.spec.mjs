// Verifica #868, giro 4: un ricordo che si ripete, una conversazione cancellata che resta davanti, i cambi che la
// ricerca allargata perde. Modello e vettori finti, come in tests/filo-contesto.spec.mjs.

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
        reasoningDetails: r.rd || [], finishReason: r.tools ? 'tool_calls' : 'stop',
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


test('r1 lo stesso pezzo vecchio ripescato in tre messaggi di fila arriva al modello una volta sola', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, {
    chat: [{ id: 'viaggio-lisbona', oreFa: 6 * 24, titolo: 'Viaggio a Lisbona', scambi: [['segnati il ristorante di Lisbona: Taberna da Rua', 'Fatto, il ristorante è Taberna da Rua.']] }],
  });
  await preparaModello(app, [{ text: 'Si chiamava Taberna da Rua.' }, { text: 'Costa poco.' }, { text: 'Il castello.' }]);
  await scrivi(page, 'come si chiamava il ristorante di Lisbona?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Si chiamava Taberna da Rua.' })).toBeVisible({ timeout: 15_000 });
  await scrivi(page, 'il ristorante di Lisbona era caro?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Costa poco.' })).toBeVisible({ timeout: 15_000 });
  await scrivi(page, 'e a Lisbona cosa vedo vicino al ristorante?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il castello.' })).toBeVisible({ timeout: 15_000 });
  const tutte = await chiamate(app);
  const copie = (msgs) => (msgs.map(testo).join('\n').match(/segnati il ristorante di Lisbona/g) || []).length;
  expect(copie(tutte[0])).toBe(1);
  expect(copie(tutte[2])).toBe(1);
});

test('r2 una conversazione ripescata da sola e poi cancellata non arriva più al modello, né in quella scheda né in un\'altra', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  await semina(app, {
    chat: [{ id: 'viaggio-lisbona', oreFa: 6 * 24, titolo: 'Viaggio a Lisbona', scambi: [['segnati il ristorante di Lisbona: Taberna da Rua, codice prenotazione LISB-7731', 'Fatto, Taberna da Rua, codice LISB-7731.']] }],
  });
  await preparaModello(app, [{ text: 'Taberna da Rua.' }, { text: 'Sette.' }, { text: 'Mela.' }]);
  const r = await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'come si chiamava il ristorante di Lisbona?', threadHistory: [], chatId: 'scheda-y' }));
  const storia = [{ role: 'user', text: 'come si chiamava il ristorante di Lisbona?' }, { role: 'filo', text: r.text, actions: r.actions }];
  await app.evaluate(() => globalThis.SN_FILO_CHATS.remove('viaggio-lisbona'));
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'dimmi un numero', threadHistory: [], chatId: 'scheda-z' }));
  await app.evaluate((_e, storia) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'dimmi una parola', threadHistory: storia, chatId: 'scheda-y' }), storia);
  const [primo, altra, stessa] = await chiamate(app);
  expect(primo.map(testo).join('\n')).toContain('LISB-7731');
  expect(altra.map(testo).join('\n')).not.toContain('LISB-7731');
  expect(stessa.map(testo).join('\n')).not.toContain('LISB-7731');
});

test('r2 una conversazione riletta con la ricerca e poi cancellata non arriva più al modello da un\'altra scheda', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  await semina(app, {
    chat: [{ id: 'vecchia-chat', oreFa: 6 * 24, titolo: 'Cane', scambi: [['il veterinario del cane ha il numero VET-55821', 'Segnato VET-55821.']] }],
  });
  await preparaModello(app, [
    { text: '', tools: [{ name: 'CERCA_CHAT', args: { id: 'vecchia-chat' } }] },
    { text: 'Ecco.' },
    { text: 'Sette.' },
  ]);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'rileggi la chat sul cane', threadHistory: [], chatId: 'scheda-y' }));
  await app.evaluate(() => globalThis.SN_FILO_CHATS.remove('vecchia-chat'));
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'dimmi un numero', threadHistory: [], chatId: 'scheda-z' }));
  const t = await chiamate(app);
  expect(t[1].map(testo).join('\n')).toContain('VET-55821');
  expect(t[2].map(testo).join('\n')).not.toContain('VET-55821');
});

test('r3 un cambio si ritrova anche con una parola in più nella ricerca, come le conversazioni', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  await semina(app, { chat: [{ id: 'chat-tema', oreFa: 30, scambi: [['mi piace il tema scuro?', 'Sì, è riposante.']] }] });
  await preparaModello(app, [
    { text: '', tools: [{ name: 'IMPOSTA_PREFERENZA', args: { chiave: 'tema', valore: 'scuro' } }] },
    { text: 'Fatto.' },
    { text: '', tools: [{ name: 'CERCA_CHAT', args: { query: 'cambio tema scuro' } }] },
    { text: 'Eccolo.' },
  ]);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'tema scuro', threadHistory: [], chatId: 'scheda-imposta' }));
  await app.evaluate(() => globalThis.SN_REGISTRO_CAMBI.attesa());
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'rimetti come prima il tema scuro di ieri', threadHistory: [], chatId: 'scheda-cerca' }));
  const t = await chiamate(app);
  const esito = testo(t[t.length - 1].filter((m) => m.role === 'tool').pop());
  expect(esito).toContain('chat-tema');
  expect(esito).toMatch(/tema: .* → scuro/);
});
