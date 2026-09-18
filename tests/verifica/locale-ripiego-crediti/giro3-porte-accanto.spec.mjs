// Verifica del ramo ripiego-crediti, terzo giro. Le tredici prove dei due
// giri passati sono verdi: qui si provano le porte accanto a quelle chiuse.
//
//  · il «Prova» delle Impostazioni con la chiave propria che OpenRouter rifiuta;
//  · il ripiego che non produce niente (la chiave personale risponde 500);
//  · la riga «Spesi … · restano …» dopo un rifiuto, a pagina Crediti aperta;
//  · chiave e stato dopo un riavvio dell'app;
//  · senza portafoglio, la chiave non riconosciuta (401) porta a Crediti;
//  · tre richieste insieme con la chiave propria a secco (come una pagina
//    tradotta a pezzi).
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter, impostaOpenRouter,
  chiamateOpenRouter, righeRegistro, chiediInChat, cartellaFiloSecurity,
} from './helpers/banco.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

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
async function apriHome(filo) {
  const dash = await filo.openTab('filo://dashboard/dashboard.html');
  await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
  return dash;
}
async function apriImpostazioni(filo) {
  const opts = await filo.openTab('filo://options/options.html');
  await expect(opts.locator('#useDefaultModels')).toBeVisible({ timeout: 15_000 });
  if (await opts.locator('#useDefaultModels').isChecked()) await opts.click('#useDefaultModels');
  await expect(opts.locator('#apiKey')).toBeVisible({ timeout: 15_000 });
  return opts;
}
const spiega = (app) => app.evaluate(async () => {
  try {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action: 'explain', payload: { selection: 'ciao', sentence: 'ciao mondo' } }, {});
    return { ok: true, text: res && res.text };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

test('il «Prova» delle Impostazioni con la chiave propria che OpenRouter rifiuta: non può dire che la chiave funziona', async () => {
  // Rilievo di livello 1 del terzo giro, messo da parte dal server (bilancio
  // del livello 1 esaurito): resta rosso di proposito finché non viene corretto.
  test.fail(true, 'rilievo messo da parte: il «Prova» risponde «TTFT … tok/s» anche con la chiave rifiutata, perché la risposta arriva col ripiego sui crediti di Filo');
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    // L'utente va nelle Impostazioni e preme «Prova» accanto alla chiave.
    const opts = await apriImpostazioni(filo);
    await expect(opts.locator('#apiKey')).toHaveValue(PROPRIA, { timeout: 15_000 });
    const prima = (await chiamateChat(filo.app)).length;
    await opts.click('#testOpenrouter');
    await expect(opts.locator('#testOpenrouterStatus')).not.toHaveText(/in corso|^$/, { timeout: 60_000 });
    const esito = await opts.locator('#testOpenrouterStatus').innerText();
    const chiavi = (await chiamateChat(filo.app)).slice(prima).map((c) => (c.key === PROPRIA ? 'propria' : (c.key === chiavePersonale() ? 'personale' : '?')));
    console.log('[nota]', `«Prova» con la propria a 402: la riga dice «${esito}»; chiavi usate ${JSON.stringify(chiavi)}`);
    // La prova è DELLA chiave: se OpenRouter l'ha rifiutata, un «TTFT … tok/s»
    // è una bugia (la risposta l'ha data la chiave personale di Filo).
    expect(esito).not.toMatch(/tok\/s/);
    expect(esito).toMatch(/chiave|credito|rifiut/i);
  } finally { await chiudi(filo); }
});

test('il ripiego che non produce niente (la personale risponde 500): la chat non parla della chiave, e Crediti non può dire che Filo ha usato i crediti', async () => {
  // Rilievo di livello 0 del terzo giro, messo da parte dal server (bilancio
  // del livello 0 a zero): resta rosso di proposito finché non viene corretto.
  test.fail(true, 'rilievo messo da parte: col ripiego fallito per un 500 della personale, Crediti dice lo stesso «Filo ha usato i tuoi crediti»');
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 }, [chiavePersonale()]: { status: 500 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    const testo = await bolla.innerText();
    await page.waitForTimeout(1500);
    const visibile = await page.locator('#ownKeyRefusal').isVisible();
    const rifiuto = visibile ? await page.locator('#ownKeyRefusal').innerText() : '';
    console.log('[nota]', `propria 402 e personale 500: chat «${testo.slice(0, 200).replace(/\n/g, ' / ')}»; Crediti ${visibile ? 'dice: «' + rifiuto + '»' : 'non ricorda rifiuti'}; righe del registro ${(await righeRegistro(filo.app)).length}`);
    expect((await righeRegistro(filo.app)).length).toBe(0);
    // Niente è stato pagato coi crediti di Filo: la pagina non può dirlo.
    expect(rifiuto).not.toMatch(/ha usato i tuoi crediti/);
  } finally { await chiudi(filo); }
});

test('Crediti aperta con la riga «Spesi … · restano …»: quando OpenRouter comincia a rifiutare la chiave, la riga della spesa non può restare a dire che restano 8,77 $', async () => {
  // Rilievo di livello 0 del terzo giro, messo da parte dal server (bilancio
  // del livello 0 a zero): resta rosso di proposito finché non viene corretto.
  test.fail(true, 'rilievo messo da parte: a pagina aperta la riga della spesa resta «restano 8,77 $» sotto la riga rossa del rifiuto, finché non si ricarica');
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { keyInfo: { limit: 10, usage: 1.23, limit_remaining: 8.77 } } } });
    await mettiChiave(page, PROPRIA);
    await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 1,23 $ · restano 8,77 $ su 10,00 $', { timeout: 15_000 });
    // Il credito finisce: da adesso OpenRouter rifiuta la chiave (anche alla
    // domanda su spesa e residuo).
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    const riga = await page.locator('#ownKeyBalance').innerText();
    console.log('[nota]', `rifiuto appena comparso, la riga accanto ai sei caratteri dice «${riga}»; ricaricata la pagina:`);
    const stantia = /restano 8,77/.test(riga);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('ownKeyHave').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#ownKeyBalance')).not.toHaveText(/Chiedo a OpenRouter/, { timeout: 15_000 });
    console.log('[nota]', `«${await page.locator('#ownKeyBalance').innerText()}»`);
    expect(stantia).toBe(false);
  } finally { await chiudi(filo); }
});

test('riavviata Filo, la chiave è ancora lì (coda, spesa e residuo) e la chat riparte con lei; anche il rifiuto ricordato sopravvive finché la chiave non torna a funzionare', async () => {
  test.setTimeout(240_000);
  const [code] = await server.codiciOwner(1);
  const userData = cartellaTemporanea('filo-ripiego-riavvio-');
  let filo = await avviaFilo({ env: server.env, userData });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    await chiediInChat(dash, 'ciao');
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
  } finally { await chiudi(filo); }
  // Riavvio: stessa cartella dati.
  filo = await avviaFilo({ env: server.env, userData });
  try {
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#ownKeyTail')).toHaveText(`…${CODA}`);
    const rifiutoDopo = await page.locator('#ownKeyRefusal').isVisible();
    console.log('[nota]', `dopo il riavvio: coda «${await page.locator('#ownKeyTail').innerText()}», il rifiuto ricordato ${rifiutoDopo ? 'c’è ancora' : 'non c’è più'}`);
    expect(rifiutoDopo).toBe(true);
    // Il conto viene ricaricato: la chat riparte con la propria e il rifiuto sparisce.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 200, keyInfo: { limit: 10, usage: 2, limit_remaining: 8 } } } });
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    expect(await bolla.innerText()).toContain('Ciao dal modello finto.');
    const calls = await chiamateChat(filo.app);
    expect(calls[calls.length - 1].key).toBe(PROPRIA);
    await expect(page.locator('#ownKeyRefusal')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 2,00 $ · restano 8,00 $ su 10,00 $', { timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('senza portafoglio, la chiave non riconosciuta (401) e quella bloccata (403): un errore che porta a Crediti, e nessun ripiego', async () => {
  test.setTimeout(180_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 401 } } });
    await mettiChiave(page, PROPRIA);
    const dash = await apriHome(filo);
    const bolla = await chiediInChat(dash, 'ciao');
    const testo = await bolla.innerText();
    console.log('[nota]', `senza portafoglio, 401: «${testo.slice(0, 220).replace(/\n/g, ' / ')}»`);
    expect(testo).toMatch(/chiave/i);
    expect(testo).toMatch(/Crediti/);
    await expect(bolla.locator('button', { hasText: 'Apri Crediti' })).toBeVisible();
    expect((await chiamateChat(filo.app)).length).toBe(1);
    // In Crediti: senza portafoglio niente «Filo ha usato i tuoi crediti».
    await page.waitForTimeout(1000);
    const rifiuto = (await page.locator('#ownKeyRefusal').isVisible()) ? await page.locator('#ownKeyRefusal').innerText() : '';
    console.log('[nota]', `senza portafoglio, in Crediti: ${rifiuto ? '«' + rifiuto + '»' : 'nessuna riga di rifiuto'}; riga spesa «${await page.locator('#ownKeyBalance').innerText()}»`);
    expect(rifiuto).not.toMatch(/ha usato i tuoi crediti/);
    // 403 (chiave senza permessi): stessa strada.
    await impostaOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 403 } } });
    const bolla2 = await chiediInChat(dash, 'ancora');
    const testo2 = await bolla2.innerText();
    console.log('[nota]', `senza portafoglio, 403: «${testo2.slice(0, 220).replace(/\n/g, ' / ')}»`);
    expect(testo2).not.toMatch(/crediti di Filo sono finiti|domani/i);
    await expect(bolla2.locator('button', { hasText: 'Apri Crediti' })).toBeVisible();
  } finally { await chiudi(filo); }
});

test('tre richieste insieme con la chiave propria a secco: tutte e tre arrivano coi crediti di Filo, tre righe del registro, e il rifiuto ricordato una volta', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    await fintoOpenRouter(filo.app, { byKey: { [PROPRIA]: { status: 402 } } });
    await mettiChiave(page, PROPRIA);
    const esiti = await Promise.all([spiega(filo.app), spiega(filo.app), spiega(filo.app)]);
    console.log('[nota]', `tre «spiega» insieme: ${JSON.stringify(esiti.map((e) => e.ok ? 'ok' : e.message))}`);
    for (const e of esiti) { expect(e.ok).toBe(true); expect(String(e.text)).toContain('Ciao dal modello finto.'); }
    const calls = await chiamateChat(filo.app);
    expect(calls.filter((c) => c.key === chiavePersonale()).length).toBe(3);
    await expect.poll(async () => (await righeRegistro(filo.app)).length, { timeout: 20_000 }).toBe(3);
    await expect(page.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('#ownKeyRefusal').count()).toBe(1);
    // La riconciliazione del server vero non segnala niente.
    const righe = await righeRegistro(filo.app);
    server.store.docs.usage.push(...righe);
    server.keys.keys.get(primoWallet().keyHash).usageUsd = righe.reduce((s, x) => s + x.costUsd, 0);
    const rec = await server.reconcile();
    expect(rec.flagged).toBe(0);
    expect(rec.errors).toBe(0);
  } finally { await chiudi(filo); }
});
