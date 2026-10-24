// #379.5 — riassunto per file, mantenuto aggiornato, come contesto per Filo.
//
// Verifica il COMPORTAMENTO (non un messaggio):
//  1) scrivendo abbastanza testo in un documento, Filo genera da solo un
//     RIASSUNTO e lo SALVA nel file (meta.summary): è ciò che poi entra nel
//     contesto di Filo al posto del testo integrale;
//  2) il riassunto si RIGENERA quando il file cambia in modo significativo
//     (a differenza del titolo, una-tantum);
//  3) il tasto destro sul titolo espone "Rigenera riassunto" e rigenerarlo
//     aggiorna il riassunto salvato;
//  4) chat del documento, titolo e riassunto leggono il documento intero (#1475).
//
// L'AI è stubbata sovrascrivendo chrome.runtime.sendMessage nella pagina (lo
// shim è writable): AI_REQUEST torna un riassunto canonico, FILO_GET_MEMORY una
// memoria vuota — nessuna chiave modello richiesta.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const COLLECTION_KEY = 'filo.editor.collection';

async function stubAI(page, initialSummary) {
  await page.evaluate((summary) => {
    window.__summaryReply = summary;
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = [];
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        window.__aiCalls.push(msg);
        r = { ok: true, text: window.__summaryReply };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        if (typeof cb === 'function') { cb(r); return undefined; }
        return Promise.resolve(r);
      }
      return orig(msg, cb);
    };
  }, initialSummary);
}

function longText(words, marker) {
  const base = ['il', 'progetto', 'di', 'ricerca', 'analizza', 'i', 'dati', 'raccolti', 'sul', 'campo'];
  const out = [];
  for (let i = 0; i < words; i++) out.push(marker ? `${marker}${i}` : base[i % base.length]);
  return out.join(' ');
}

function activeSummary(page) {
  return page.evaluate((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return (f && f.meta && f.meta.summary) || null;
    } catch (_) { return null; }
  }, COLLECTION_KEY);
}

test('scrivendo abbastanza testo Filo genera e SALVA un riassunto del file', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'Un progetto di ricerca sui dati raccolti sul campo.');

  // Precondizione: nessun riassunto salvato.
  expect(await activeSummary(page)).toBeNull();

  // Scrive abbastanza testo e notifica l'editor (evento input): scatta il tiro
  // automatico (con debounce), che chiama l'AI e salva il riassunto.
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(90));

  // Il riassunto proposto dall'AI viene salvato nel file (contesto per Filo).
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return !!(f && f.meta && f.meta.summary);
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  expect(await activeSummary(page)).toBe('Un progetto di ricerca sui dati raccolti sul campo.');
});

test('il riassunto si rigenera quando il file cambia in modo significativo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'Primo riassunto.');

  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(90, 'x'));
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Primo riassunto.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  const firstCalls = await page.evaluate(() => window.__aiCalls.length);

  // Cambia molto il contenuto (molte parole in più): supera la soglia di
  // "cambiamento significativo" e il riassunto si rigenera.
  await page.evaluate(() => { window.__summaryReply = 'Secondo riassunto aggiornato.'; });
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, longText(200, 'y'));
  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Secondo riassunto aggiornato.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 15000 });
  expect(await page.evaluate(() => window.__aiCalls.length)).toBeGreaterThan(firstCalls);
});

test('il tasto destro sul titolo espone "Rigenera riassunto" e rigenerarlo aggiorna il riassunto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await stubAI(page, 'Riassunto rigenerato a mano.');

  await page.click('#docSwitch', { button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Rigenera riassunto', { exact: true })).toHaveCount(1);

  // Scrive un po' di testo, poi rigenera il riassunto dal menu (nessuna soglia).
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>una breve nota di prova sul progetto di ricerca</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await menu.getByText('Rigenera riassunto', { exact: true }).click();

  await page.waitForFunction((key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key));
      const f = c.files.find((x) => x.id === c.activeId);
      return f && f.meta && f.meta.summary === 'Riassunto rigenerato a mano.';
    } catch (_) { return false; }
  }, COLLECTION_KEY, { timeout: 8000 });
  expect(await activeSummary(page)).toBe('Riassunto rigenerato a mano.');
});

// #1475 — chat del documento, titolo e riassunto leggono il documento intero (prima i primi 6000 caratteri, in silenzio);
// oltre il tetto largo il taglio si dice, a chi scrive e al modello. Qui l'AI è finta nel main: la pagina resta com'è.
const SHOTS = 'tests/.shots';
const FONDO = 'La chiave del magazzino sta sotto il vaso di gerani.';
const RIEMPIMENTO = 'Il bilancio del trimestre segue le stesse voci del precedente, con qualche spesa in più per la manutenzione. ';

// Il modello finto risponde solo da quello che gli arriva: trova la frase in fondo se il documento gli arriva intero.
async function prepara(app) {
  await app.evaluate(async (_electron, { fondo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.EDITOR_TITLE]: 'deepseek-flash',
        [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__richieste = [];
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const utente = String((messages.find((m) => m.role === 'user') || {}).content || '');
      const vede = (sistema + utente).includes(fondo);
      if (sistema.includes('assistente di scrittura dentro un editor')) {
        globalThis.__richieste.push({ tipo: 'chat', sistema });
        return fatto(vede ? 'Sotto il vaso di gerani.' : 'Nel documento non lo trovo.');
      }
      if (sistema.includes('Genera un TITOLO')) {
        globalThis.__richieste.push({ tipo: 'titolo', utente });
        return fatto(vede ? 'Gerani e magazzino' : 'Bilancio del trimestre');
      }
      if (sistema.includes('Scrivi un RIASSUNTO')) {
        globalThis.__richieste.push({ tipo: 'riassunto', utente });
        return fatto(vede ? 'Il bilancio e dove sta la chiave del magazzino.' : 'Il bilancio del trimestre.');
      }
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => {
      const r = risposta(o);
      try { o.onDelta && o.onDelta(r.text); } catch (_) {}
      return r;
    };
  }, { fondo: FONDO });
}

// Il documento come lo lascia chi incolla un testo lungo: tanti paragrafi, e la frase che conta nell'ultimo.
async function scriviDocumento(editor, caratteri) {
  return editor.evaluate(({ caratteri, riempimento, fondo }) => {
    const per = riempimento.repeat(10);
    const n = Math.ceil(caratteri / per.length);
    const d = document.getElementById('doc');
    d.innerHTML = Array.from({ length: n }, () => `<p>${per}</p>`).join('') + `<p>${fondo}</p>`;
    d.dispatchEvent(new Event('input', { bubbles: true }));
    // Ogni paragrafo chiude con un a capo: i caratteri che il documento ha davvero.
    return n * (per.length + 1) + fondo.length;
  }, { caratteri, riempimento: RIEMPIMENTO, fondo: FONDO });
}

async function chiediAllaChat(editor, domanda) {
  const chat = editor.locator('.ed-module[data-type="chat"]');
  if (!await chat.count()) await editor.locator('.ed-switch-icon').nth(1).click();
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  return chat;
}

async function dalMenuDelTitolo(editor, voce) {
  await editor.locator('#docTitle').click({ button: 'right' });
  await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: voce }).click();
}

const richieste = (app, tipo) => app.evaluate((_electron, t) => globalThis.__richieste.filter((r) => r.tipo === t), tipo);

test('un documento lungo arriva intero: la chat trova la frase in fondo, titolo e riassunto lo leggono tutto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  // Dieci volte il vecchio tetto.
  await scriviDocumento(editor, 60_000);

  const chat = await chiediAllaChat(editor, 'Dove sta la chiave del magazzino?');
  await expect(chat.locator('.ed-chat-msg.assistant')).toHaveText('Sotto il vaso di gerani.', { timeout: 15_000 });
  await expect(chat.locator('.ed-chat-note')).toHaveCount(0);

  // Il titolo automatico, partito dall'input, ha già letto il documento fino in fondo; quello rifatto a mano anche.
  await expect(editor.locator('#docTitle')).toHaveText('Gerani e magazzino', { timeout: 15_000 });
  await dalMenuDelTitolo(editor, 'Rigenera titolo');
  await expect.poll(async () => (await richieste(app, 'titolo')).length, { timeout: 15_000 }).toBe(2);
  expect((await richieste(app, 'titolo')).every((r) => r.utente.includes(FONDO))).toBe(true);
  await expect(editor.locator('#docTitle')).toHaveText('Gerani e magazzino');

  await dalMenuDelTitolo(editor, 'Rigenera riassunto');
  await expect.poll(async () => (await richieste(app, 'riassunto')).some((r) => r.utente.includes(FONDO)), { timeout: 15_000 }).toBe(true);
  await expect(editor.locator('.ed-toast')).toHaveCount(0);
});

test('oltre il tetto il taglio si dice: sotto la risposta, nell\'avviso del titolo e al modello', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  const totale = await scriviDocumento(editor, 400_000);
  const nota = `Il documento è lungo: ho letto i primi 350.000 caratteri su ${totale.toLocaleString('it-IT')}.`;

  const chat = await chiediAllaChat(editor, 'Dove sta la chiave del magazzino?');
  await expect(chat.locator('.ed-chat-msg.assistant')).toHaveText('Nel documento non lo trovo.', { timeout: 15_000 });
  await expect(chat.locator('.ed-chat-note')).toHaveText(nota);
  const [domanda] = await richieste(app, 'chat');
  expect(domanda.sistema).toContain('Il resto non lo vedi');
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/1475-editor-taglio-chiaro.png` });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(editor.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await chat.screenshot({ path: `${SHOTS}/1475-editor-taglio-scuro.png` });

  await dalMenuDelTitolo(editor, 'Rigenera titolo');
  await expect(editor.locator('.ed-toast', { hasText: 'per il titolo ho letto i primi 350.000 caratteri' })).toBeVisible({ timeout: 15_000 });
  const titoli = await richieste(app, 'titolo');
  expect(titoli[titoli.length - 1].utente).toContain('Il resto non lo vedi');

  await dalMenuDelTitolo(editor, 'Rigenera riassunto');
  await expect(editor.locator('.ed-toast', { hasText: 'per il riassunto ho letto i primi 350.000 caratteri' })).toBeVisible({ timeout: 15_000 });
});

// Un modello dalla finestra più stretta del tetto rifiuta il documento intero: chat e titolo lo rileggono più corto,
// misurato sul rifiuto, e il taglio si dice come oltre il tetto. Prima arrivava un errore che dava la colpa al modello.
test('con un modello da 32.000 token il documento lungo si rilegge dentro la finestra, col taglio detto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const INIZIO = 'Il verbale si apre con la nomina di Giulia come segretaria.';
  await app.evaluate(async (_electron, { inizio }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.EDITOR_TITLE]: 'deepseek-flash', [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__rifiuti = 0;
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      if (tutto.length > 100_000) {
        globalThis.__rifiuti += 1;
        const chiesti = Math.round(tutto.length / 3);
        const e = new Error(`OpenRouter 400: {"error":{"message":"This endpoint's maximum context length is 32768 tokens. However, you requested about ${chiesti + 1000} tokens (${chiesti} of text input, 1000 in the output).","code":400}}`);
        e.status = 400;
        throw e;
      }
      const sistema = String(messages[0].content || '');
      const vede = tutto.includes(inizio);
      const text = sistema.includes('Genera un TITOLO') ? (vede ? 'Nomina della segretaria' : 'Senza inizio') : (vede ? 'Giulia fa la segretaria.' : 'Non lo trovo.');
      return { text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, { inizio: INIZIO });
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate(({ inizio, riempimento }) => {
    const d = document.getElementById('doc');
    d.innerHTML = `<p>${inizio}</p>` + Array.from({ length: 200 }, () => `<p>${riempimento.repeat(10)}</p>`).join('');
    d.dispatchEvent(new Event('input', { bubbles: true }));
  }, { inizio: INIZIO, riempimento: RIEMPIMENTO });

  const chat = await chiediAllaChat(editor, 'Chi fa la segretaria?');
  await expect(chat.locator('.ed-chat-msg.assistant').last()).toHaveText('Giulia fa la segretaria.', { timeout: 15_000 });
  await expect(chat.locator('.ed-chat-note')).toContainText('ho letto i primi');

  await dalMenuDelTitolo(editor, 'Rigenera titolo');
  await expect(editor.locator('#docTitle')).toHaveText('Nomina della segretaria', { timeout: 15_000 });
  await expect(editor.locator('.ed-toast', { hasText: 'per il titolo ho letto i primi' })).toBeVisible({ timeout: 15_000 });
  expect(await app.evaluate(() => globalThis.__rifiuti)).toBeGreaterThan(0);
});
