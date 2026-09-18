// Verifica del ramo ripiego-crediti, quarto giro. Le sedici prove dei tre
// giri passati sono verdi (le tre rosse attese restano rosse): qui si provano
// le strade laterali che nessuno aveva ancora percorso.
//
//  · Filo senza server dei crediti (irraggiungibile) e senza invito: la
//    chiave propria si mette e si toglie in Crediti, e la chat va con lei;
//  · un portafoglio a zero crediti con la chiave propria che funziona: la
//    chat va con la chiave, nessun «crediti finiti» a sbarrare la strada;
//  · «spiega» su una pagina web con la chiave propria a secco: la risposta
//    arriva coi crediti di Filo, e il riquadro lo dice? (in chat la riga c'è);
//  · i vettori (embeddings) con la chiave propria a secco: stesso ripiego
//    della chat (una chiamata con la propria, poi una con la personale);
//  · una chiave che non comincia con sk-or- incollata in Crediti.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter, impostaOpenRouter,
  chiamateOpenRouter, chiediInChat, cartellaFiloSecurity, paginaWeb, ENV_OFFLINE,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }

const PROPRIA = 'sk-or-v1-propria-0123456789ABCDEF';
const CODA = PROPRIA.slice(-6);
const primoWallet = () => [...server.store.docs.wallets.values()][0];
const chiavePersonale = () => server.keys.keys.get(primoWallet().keyHash).key;
const chiamateChat = async (app) => (await chiamateOpenRouter(app)).filter((c) => c.url.includes('/chat/completions'));

async function riscatta(page, code) {
  await page.fill('#inviteCode', code);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('#balance')).not.toHaveText('—', { timeout: 15_000 });
}
async function mettiChiave(page, key) {
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
  await page.fill('#ownKeyInput', key);
  await page.click('#ownKeySaveBtn');
  await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
}
async function togliChiave(page) {
  await page.click('#ownKeyRemoveBtn');
  await expect(page.locator('#ownKeyConfirm')).toBeVisible({ timeout: 5_000 });
  await page.click('#ownKeyRemoveYes');
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
}
async function apriHome(filo) {
  const dash = await filo.openTab('filo://dashboard/dashboard.html');
  await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
  return dash;
}

test('senza server dei crediti e senza invito: la chiave propria si mette in Crediti, la chat va con lei, e si toglie', async () => {
  test.setTimeout(180_000);
  // Nessun server: gli indirizzi puntano a una porta chiusa.
  const filo = await avviaFilo({ env: ENV_OFFLINE });
  try {
    const page = await apriCrediti(filo.openTab);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: null, usage: 0.5, limit_remaining: null }, account: { total_credits: 5, total_usage: 0.5 } } } });
    const nota = (await page.locator('#walletNote').isVisible()) ? await page.locator('#walletNote').innerText() : '';
    console.log('[nota]', `senza server, prima della chiave: nota «${nota}»; modulo della chiave ${await page.locator('#ownKeyForm').isVisible() ? 'visibile' : 'NON visibile'}`);
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter|^$/, { timeout: 15_000 });
    console.log('[nota]', `senza server, con la chiave: riga spesa «${await page.locator('#ownKeyBalance').innerText()}», regola «${await page.locator('#ownKeyRule').innerText()}»`);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    expect(await bolla.innerText()).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls.length).toBe(1);
    expect(calls[0].key).toBe(PROPRIA);
    expect(await dash.locator('#bubbles .dash-bubble-filo').last().innerText()).not.toMatch(/crediti di Filo/);
    // La pagina intera non contiene mai la chiave.
    expect(await page.content()).not.toContain(PROPRIA);
    await togliChiave(page);
    console.log('[nota]', `senza server, tolta la chiave: nota «${(await page.locator('#walletNote').isVisible()) ? await page.locator('#walletNote').innerText() : ''}»`);
  } finally { await chiudi(filo); }
});

test('portafoglio a zero crediti ma la chiave propria funziona: la chat va con la chiave, senza «crediti finiti»', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: 10, usage: 1.23, limit_remaining: 8.77 } } } });
    // Il portafoglio si svuota: la chiave personale ha consumato tutto il suo tetto.
    const k = server.keys.keys.get(primoWallet().keyHash);
    k.usageUsd = k.limitUsd;
    await mettiChiave(page, PROPRIA);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('ownKeyHave').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#balance')).not.toHaveText('—', { timeout: 15_000 });
    console.log('[nota]', `portafoglio a «${await page.locator('#balance').innerText()}» crediti, chiave propria buona`);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    const testo = await bolla.innerText();
    console.log('[nota]', `chat: «${testo.slice(0, 160).replace(/\n/g, ' / ')}»`);
    expect(testo).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls[calls.length - 1].key).toBe(PROPRIA);
    expect(testo).not.toMatch(/crediti/i);
    // E se poi la propria si secca: il ripiego trova i crediti finiti, e lo dice.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 }, [chiavePersonale()]: { status: 402 } } });
    const bolla2 = await chiediInChat(dash, 'ancora');
    const testo2 = await bolla2.innerText();
    console.log('[nota]', `propria a secco e portafoglio a zero: «${testo2.slice(0, 220).replace(/\n/g, ' / ')}»`);
    expect(testo2).toMatch(/la tua chiave/);
    expect(testo2).toMatch(/crediti di Filo sono finiti/);
  } finally { await chiudi(filo); }
});

test('«spiega» su una pagina web con la chiave propria a secco: la risposta arriva coi crediti di Filo, e il riquadro lo dice come lo dice la chat', async () => {
  // Rilievo di livello 1 del quarto giro (parità fra le strade: la chat lo
  // dice, il riquadro sulla pagina no), messo da parte dal server per il
  // bilancio del livello 1 esaurito: resta rosso di proposito finché non
  // viene corretto.
  test.fail(true, 'rilievo messo da parte: il riquadro di «spiega» non dice che OpenRouter ha rifiutato la chiave e che Filo ha usato i crediti');
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const web = await paginaWeb('<!doctype html><meta charset="utf-8"><title>Pagina di prova</title><p id="t">Una frase da spiegare sulla pagina.</p>');
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const pagina = await filo.openTab(web.url);
    await pagina.locator('#t').click();
    await pagina.evaluate(() => {
      const p = document.querySelector('#t');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await filo.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await expect(pagina.locator('.sn-popup')).toBeVisible({ timeout: 15_000 });
    await expect(pagina.locator('.sn-popup')).toContainText('Ciao dal modello finto.', { timeout: 30_000 });
    const chiavi = (await chiamateChat(filo.app)).map((c) => (c.key === PROPRIA ? 'propria' : (c.key === chiavePersonale() ? 'personale' : '?')));
    const testo = await pagina.locator('.sn-popup').innerText();
    console.log('[nota]', `«spiega» sulla pagina con la propria a 402: chiavi ${JSON.stringify(chiavi)}; il riquadro dice «${testo.replace(/\s+/g, ' ').slice(0, 300)}»`);
    expect(chiavi).toEqual(['propria', 'personale']);
    // Come sotto la risposta in chat: «OpenRouter ha rifiutato la tua chiave …: ho usato i crediti di Filo».
    expect(testo).toMatch(/crediti di Filo/);
  } finally { await web.chiudi(); await chiudi(filo); }
});

test('i vettori (embeddings) con la chiave propria a secco passano dallo stesso ripiego: prima la propria, poi la personale', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const esito = await filo.app.evaluate(async ({}, k) => {
      try {
        const P = globalThis.SN_PROVIDER_OPENROUTER;
        const r = await P.embed({ apiKey: k, model: 'finto/embed', texts: ['prova'], dim: 8 });
        return { ok: true, n: r && r.vectors ? r.vectors.length : -1 };
      } catch (e) { return { ok: false, message: String(e && e.message || e), status: e && e.status }; }
    }, PROPRIA);
    const emb = (await chiamateOpenRouter(filo.app)).filter((c) => c.url.includes('/embeddings'));
    const chiavi = emb.map((c) => (c.key === PROPRIA ? 'propria' : (c.key === chiavePersonale() ? 'personale' : '?')));
    console.log('[nota]', `embeddings con la propria a 402: chiamate ${JSON.stringify(chiavi)}; esito ${JSON.stringify(esito)}`);
    expect(chiavi).toEqual(['propria', 'personale']);
    // L'errore, se c'è, non è il 402 della chiave propria (il finto risponde
    // con un corpo da chat, non da vettori: è quello che il modulo non digerisce).
    expect(esito.status).not.toBe(402);
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('«spiega» sulla pagina con la chiave propria a secco fa le stesse richieste di quando la chiave va (ognuna rifatta con la personale): nessuna tempesta di tentativi', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const web = await paginaWeb('<!doctype html><meta charset="utf-8"><title>Pagina di prova</title><p id="t">Una frase da spiegare sulla pagina.</p>');
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, {});
    await mettiChiave(page, PROPRIA);
    const pagina = await filo.openTab(web.url);
    const spiega = async () => {
      await pagina.locator('#t').click();
      await pagina.evaluate(() => {
        const p = document.querySelector('#t');
        const range = document.createRange();
        range.selectNodeContents(p);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      await filo.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        globalThis.__filoShortcuts.dispatch('explain-selection', win);
      });
      await expect(pagina.locator('.sn-popup').last()).toContainText('Ciao dal modello finto.', { timeout: 30_000 });
      await pagina.waitForTimeout(3000); // le richieste precalcolate dal riquadro
    };
    await spiega();
    const conBuona = (await chiamateChat(filo.app)).length;
    await pagina.keyboard.press('Escape');
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await spiega();
    const dopo = (await chiamateChat(filo.app)).slice(conBuona);
    const chiavi = dopo.map((c) => (c.key === PROPRIA ? 'propria' : (c.key === chiavePersonale() ? 'personale' : '?')));
    console.log('[nota]', `«spiega» con la chiave buona: ${conBuona} richieste; con la chiave a 402: ${JSON.stringify(chiavi)}`);
    expect(dopo.length).toBe(conBuona * 2);
    for (let i = 0; i < chiavi.length; i += 2) expect(chiavi.slice(i, i + 2)).toEqual(['propria', 'personale']);
  } finally { await web.chiudi(); await chiudi(filo); }
});

test('una chiave di un altro servizio incollata in Crediti: OpenRouter non la riconosce, e la riga accanto ai sei caratteri lo dice subito', async () => {
  test.setTimeout(120_000);
  const ALTRA = 'sk-proj-questa-non-e-di-openrouter';
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    // Una chiave che OpenRouter non conosce: 401 a tutto, anche alla domanda su spesa e residuo.
    await fintoOpenRouter(filo.app, { byKey: { [ALTRA]: { status: 401 } } });
    await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15_000 });
    await page.fill('#ownKeyInput', ALTRA);
    await page.click('#ownKeySaveBtn');
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
    const msg = (await page.locator('#ownKeyMsg').isVisible()) ? await page.locator('#ownKeyMsg').innerText() : '';
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter|^$/, { timeout: 15_000 });
    const riga = await page.locator('#ownKeyBalance').innerText();
    console.log('[nota]', `chiave «sk-proj-…»: salvata (messaggio al salvataggio «${msg}»); riga spesa «${riga}»`);
    expect(riga).toMatch(/non accetta questa chiave/);
    expect(riga).toMatch(/non la riconosce/);
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${ALTRA.slice(-6)}`);
  } finally { await chiudi(filo); }
});
