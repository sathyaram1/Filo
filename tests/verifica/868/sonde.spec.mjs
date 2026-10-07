
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


async function homeIncognito(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w && w._filoTabs.tabs.find((tt) => tt.view.webContents.getURL().startsWith('filo://newtab'));
    if (!t) return false;
    try { await t.view.webContents.executeJavaScript('window.__homeIncognito = 1'); return true; } catch (_) { return false; }
  }), { timeout: 20_000 }).toBe(true);
  for (const w of app.windows()) {
    try { if (await w.evaluate(() => window.__homeIncognito === 1)) return w; } catch (_) {}
  }
  throw new Error('home incognito non trovata');
}

test('sonda: una chat in incognito non entra nel contesto di una scheda normale', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const a = await primaScheda(app);
  await preparaModello(app, [{ text: 'Segnato in incognito.' }, { text: 'Ok normale.' }]);
  const inc = await homeIncognito(app, shell);
  await inc.locator('#input').fill('il mio codice segreto è SEGRETO-INC-913');
  await inc.locator('#sendBtn').click();
  await expect(inc.locator('.dash-bubble-filo', { hasText: 'Segnato in incognito.' })).toBeVisible({ timeout: 20_000 });
  await a.bringToFront();
  await a.reload();
  await expect(a.locator('#input')).toBeVisible();
  await scrivi(a, 'qual è il mio codice segreto?');
  await expect(a.locator('.dash-bubble-filo', { hasText: 'Ok normale.' })).toBeVisible({ timeout: 20_000 });
  const tutte = await chiamate(app);
  expect(tutte.length).toBe(2);
  expect(tutte[1].map(testo).join('\n')).not.toContain('SEGRETO-INC-913');
});

test('sonda: una chat cancellata esce dal contesto al turno dopo', async ({ app }) => {
  test.setTimeout(90_000);
  await primaScheda(app);
  await preparaModello(app, [{ text: 'Segnato.' }, { text: 'Non so.' }]);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'il codice del portone è PORTONE-4471', threadHistory: [], chatId: 'scheda-canc' }));
  const ids = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).map((c) => c.id));
  expect(ids).toContain('scheda-canc');
  await app.evaluate(() => globalThis.SN_FILO_CHATS.remove('scheda-canc'));
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'qual è il codice del portone?', threadHistory: [], chatId: 'scheda-dopo' }));
  const [primo, secondo] = await chiamate(app);
  expect(primo.map(testo).join('\n')).toContain('PORTONE-4471');
  expect(secondo.map(testo).join('\n')).not.toContain('PORTONE-4471');
});

test('sonda: un messaggio lunghissimo incollato si rilegge intero con la ricerca, come promette il taglio', async ({ app }) => {
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
  // Il tratto lo taglia (oltre un quarto del tetto) e dice che si rilegge con CERCA_CHAT...
  expect(tratto).toContain('si rileggono interi con CERCA_CHAT');
  expect(tratto).not.toContain('SEGNO-DEL-MEZZO-77');
  // ...ma la rilettura deve davvero restituirlo.
  const terzo = tutte[2];
  expect(testo(terzo.find((m) => m.role === 'tool'))).toContain('SEGNO-DEL-MEZZO-77');
});
