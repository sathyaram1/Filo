// L'avviso prima che i crediti finiscano (#818), dal punto di vista di chi usa Filo.
//
// Un HTTP locale finge il server dei crediti, l'identità, OpenRouter e Firestore (come ripiego-crediti.spec): il
// portafoglio ha 400 crediti e una quota di 100, il diario dei consumi dice 300 al giorno negli ultimi tre giorni.
//  (A) con una conversazione aperta l'avviso arriva in chat, una volta, con «finiscono dopodomani» e i rimedi con le
//      cifre; «Usa i più economici» cambia davvero il modello della chat, e un clic lo rimette com'era;
//  (B) senza conversazione è una notifica nella finestra che apre la pagina Crediti, dove i rimedi si applicano e
//      si annullano; lo stesso calo non avvisa due volte, un saldo risalito sopra la soglia sì;
//  (C) sopra le soglie, con la chiave propria o senza portafoglio: nessun avviso;
//  (D) soglie, interruttore e spiegazione preparata si cambiano dalle Preferenze;
//  (E) una home con la conversazione in una scheda dietro le altre non lo prende: arriva la notifica;
//  (F) a parole, dopo l'avviso in chat, Filo vede i rimedi, li applica e li rimette come i pulsanti.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from './fixtures/electron.mjs';

const SHOTS = 'tests/.shots/818';
const PSEUDONYM = 'abcdef0123456789';
const PERSONAL_KEY = 'sk-or-v1-test-personal';

let server;
let base = '';
let redeemed = false;
let saldo = 400;
const modelliVisti = [];
const corpiChat = [];

// Le misure del servizio dei contatori (#1472) nelle ore di oggi, sommate.
const servizioOggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.servizio) continue;
    for (const [m, conti] of Object.entries(ora.servizio)) {
      for (const [c, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[c] = ((out[m] || {})[c] || 0) + n;
    }
  }
  return out;
});

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-818' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-818' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        const notte = new Date(); notte.setHours(2, 0, 0, 0);
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: PSEUDONYM,
            balance: { credits: saldo, creditsGranted: 2600, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [],
            grants: [
              { at: notte.toISOString(), credits: 100, why: 'daily' },
              { at: '2026-09-20T10:00:00.000Z', credits: 2000, why: 'entry' },
            ],
          },
        });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: PSEUDONYM, credits: 2000, entryCredits: 2000, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (JSON.stringify(msgs).includes('preparare la dashboard')) { req.socket.destroy(); return; }
        const last = msgs[msgs.length - 1] || {};
        if (body.tools && last.role === 'user') { modelliVisti.push(body.model); corpiChat.push(body); }
        // A parole: «usa i modelli più economici» e «rimetti i modelli di prima» diventano il rimedio, come farebbe un modello.
        const detto = last.role === 'user' ? JSON.stringify(last.content || '') : '';
        const op = /usa i modelli più economici/.test(detto) ? 'applica' : /rimetti i modelli di prima/.test(detto) ? 'annulla' : '';
        if (body.tools && op && body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const call = { index: 0, id: `c${corpiChat.length}`, type: 'function', function: { name: 'RIMEDIO_CREDITI', arguments: JSON.stringify({ operazione: op, rimedio: 'modello' }) } };
          res.write(`data: ${JSON.stringify({ id: 'gen-t', provider: 'Fake', choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0 } })}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        const testo = 'Ecco fatto.';
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: testo }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: testo } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  redeemed = false;
  saldo = 400;
  modelliVisti.length = 0;
  corpiChat.length = 0;
});

async function redirectHosts(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => {
      const u = String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b);
      return vero(u, init);
    };
  }, base);
}

async function riscatta(app) {
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

// Tre giorni a 300 crediti: la chat, la spiegazione preparata alla selezione e il riassunto delle schede chiuse.
async function treGiorniA300(app) {
  await app.evaluate(async () => {
    const CA = globalThis.SN_CREDITI_AVVISO;
    const A = globalThis.SN_CONST.ACTIONS;
    let d = {};
    for (let i = 1; i <= 3; i++) {
      const giorno = CA.chiaveGiorno(new Date(Date.now() - i * 86400000));
      d = CA.aggiungi(d, { giorno, azione: A.FILO_CHAT, crediti: 240, prompt: 240000, completion: 24000 });
      d = CA.aggiungi(d, { giorno, azione: A.EXPLAIN, tag: CA.ANTICIPATA, crediti: 30, prompt: 30000, completion: 6000 });
      d = CA.aggiungi(d, { giorno, azione: A.FILO_TAB_SUMMARY, crediti: 30, prompt: 30000, completion: 3000 });
    }
    await globalThis.SN_AVVISO_CREDITI_MAIN.impostaDiarioPerTest(d);
  });
}

const valuta = (app) => app.evaluate(async () => {
  const r = await globalThis.SN_AVVISO_CREDITI_MAIN.valutaOra();
  return r && r.esito;
});
// Il tempo del main va avanti di un minuto: la chat torna a chiedere il saldo al server.
function passaUnMinuto(app) {
  return app.evaluate(() => {
    const vero = globalThis.__dateNowVero || Date.now;
    globalThis.__dateNowVero = vero;
    globalThis.__spostamento = (globalThis.__spostamento || 0) + 61_000;
    Date.now = () => vero() + globalThis.__spostamento;
  });
}
const rileggi = (app) => app.evaluate(async () => { await globalThis.SN_WALLET_MAIN.readState(); });

async function newtab(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function scrivi(home, testo) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
}

test('(A) con una conversazione aperta l\'avviso arriva in chat, una volta; il modello più economico si applica e si rimette', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtab(app);
  await redirectHosts(app);
  await treGiorniA300(app);
  // Al riscatto il saldo è alto; poi scende sul server, e il turno di chat lo rilegge come fa sempre dopo un minuto.
  saldo = 4000;
  await riscatta(app);
  saldo = 400;
  await passaUnMinuto(app);

  await scrivi(home, 'ciao');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco fatto' }).first()).toBeVisible({ timeout: 30_000 });
  expect(modelliVisti.at(-1)).toBe('deepseek/deepseek-v4-pro');

  // SUCCESSO: la frase della proiezione e i rimedi con le cifre, in fondo alla conversazione.
  const avviso = home.locator('.dash-crediti-avviso');
  await expect(avviso).toHaveCount(1, { timeout: 20_000 });
  await expect(avviso).toContainText('Ti restano 400 crediti: al ritmo di oggi finiscono dopodomani.');
  const modello = avviso.locator('.sn-crediti-rimedio[data-rimedio="modello"]');
  await expect(modello).toContainText('Chat con Filo');
  await expect(modello.locator('.sn-crediti-rimedio-cifra')).toHaveText(/^circa \d+ crediti in meno al giorno$/);
  await expect(modello).toContainText('Gemma 4 31B invece di DeepSeek V4 Pro');
  const automatiche = avviso.locator('.sn-crediti-rimedio[data-rimedio="automatiche"]');
  await expect(automatiche).toContainText('la spiegazione preparata quando selezioni un testo');
  await expect(automatiche).toContainText('il riassunto delle schede');
  await expect(automatiche.locator('.sn-crediti-rimedio-cifra')).toHaveText('circa 60 crediti in meno al giorno');
  await expect(avviso.locator('.sn-crediti-rimedio[data-rimedio="chiave"]')).toContainText('chiave OpenRouter');
  await expect(avviso.locator('.sn-crediti-rimedio[data-rimedio="attesa"]')).toContainText('arrivano 100 crediti');
  await home.screenshot({ path: `${SHOTS}/chat-chiaro.png` });

  // Un clic: la chat passa al modello più economico, davvero.
  await modello.locator('button', { hasText: 'Usa i più economici' }).click();
  await expect(modello.locator('button')).toHaveText('Rimetti i modelli di prima');
  await expect(modello).toContainText('Stai usando modelli più economici');
  await scrivi(home, 'e adesso?');
  await expect.poll(() => modelliVisti.length, { timeout: 30_000 }).toBe(2);
  expect(modelliVisti[1]).toBe('google/gemma-4-31b-it');
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });

  // Lo stesso calo non avvisa due volte, nemmeno dopo un altro turno.
  await new Promise((r) => setTimeout(r, 5_000));
  await expect(home.locator('.dash-crediti-avviso')).toHaveCount(1);
  expect(await valuta(app)).toBe('gia-detto');

  // Un clic lo rimette com'era.
  await modello.locator('button', { hasText: 'Rimetti i modelli di prima' }).click();
  await expect(modello.locator('.sn-crediti-rimedio-esito')).toHaveText('Rimesso com\'era.');
  await expect(modello.locator('button')).toHaveText('Usa i più economici');
  await scrivi(home, 'e ora?');
  await expect.poll(() => modelliVisti.length, { timeout: 30_000 }).toBe(3);
  expect(modelliVisti[2]).toBe('deepseek/deepseek-v4-pro');

  await home.evaluate(async () => { await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }); });
  await new Promise((r) => setTimeout(r, 800));
  await home.screenshot({ path: `${SHOTS}/chat-scuro.png` });
});

test('(F) a parole: dopo l\'avviso in chat Filo vede i rimedi, li applica e li rimette, e i pulsanti in chat lo seguono', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtab(app);
  await redirectHosts(app);
  await treGiorniA300(app);
  saldo = 4000;
  await riscatta(app);
  saldo = 400;
  await passaUnMinuto(app);
  await scrivi(home, 'ciao');
  const avviso = home.locator('.dash-crediti-avviso');
  await expect(avviso).toHaveCount(1, { timeout: 30_000 });
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });

  // Filo sa cosa ha proposto: nel filo c'è l'avviso intero, rimedi e cifre compresi.
  await scrivi(home, 'sì, usa i modelli più economici');
  await expect.poll(() => corpiChat.length, { timeout: 30_000 }).toBe(2);
  const filo = JSON.stringify(corpiChat[1].messages);
  expect(filo).toContain('Usa modelli più economici per Chat con Filo');
  expect(filo).toContain('Gemma 4 31B invece di DeepSeek V4 Pro');
  // E l'ha fatto: il pulsante sotto l'avviso lo dice, e la chat dopo usa il modello più economico.
  const modello = avviso.locator('.sn-crediti-rimedio[data-rimedio="modello"]');
  await expect(modello.locator('button')).toHaveText('Rimetti i modelli di prima', { timeout: 20_000 });
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });
  await scrivi(home, 'e adesso?');
  await expect.poll(() => modelliVisti.length, { timeout: 30_000 }).toBe(3);
  expect(modelliVisti[2]).toBe('google/gemma-4-31b-it');
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });

  // A parole si rimette com'era.
  await scrivi(home, 'rimetti i modelli di prima');
  await expect(modello.locator('button')).toHaveText('Usa i più economici', { timeout: 20_000 });
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });
  await scrivi(home, 'e ora?');
  await expect.poll(() => modelliVisti.length, { timeout: 30_000 }).toBe(5);
  expect(modelliVisti[4]).toBe('deepseek/deepseek-v4-pro');
});

test('(B) senza conversazione è una notifica che apre Crediti; lì i rimedi si applicano e si annullano, e lo stesso calo non torna', async ({ app, shell, avvisi }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtab(app);
  await redirectHosts(app);
  await treGiorniA300(app);
  // Il saldo letto al riscatto basta: la valutazione che segue ogni lettura avvisa, e nessuna home ha una conversazione.
  await riscatta(app);
  const vista = await avvisi();
  const notifica = vista.locator('.shell-notif', { hasText: 'al ritmo di oggi finiscono dopodomani' });
  await expect(notifica).toBeVisible({ timeout: 10_000 });
  await vista.screenshot({ path: `${SHOTS}/notifica.png` });
  await notifica.locator('.shell-notif-action', { hasText: 'Come farli durare' }).click();

  let crediti = null;
  await expect.poll(() => {
    crediti = app.windows().find((w) => w.url().startsWith('filo://credits/credits.html'));
    return Boolean(crediti);
  }, { timeout: 10_000 }).toBe(true);
  await crediti.waitForLoadState('domcontentloaded');
  const sez = crediti.locator('#avviso');
  await expect(sez).toBeVisible({ timeout: 15_000 });
  await expect(crediti.locator('#avvisoTesto')).toHaveText('Ti restano 400 crediti: al ritmo di oggi finiscono dopodomani.');
  await crediti.screenshot({ path: `${SHOTS}/crediti-chiaro.png`, fullPage: true });

  // Spegnere le automatiche che consumano, e riaccenderle.
  const auto = sez.locator('.sn-crediti-rimedio[data-rimedio="automatiche"]');
  // La pagina si ridisegna a ogni saldo cambiato: un pulsante che non cambia resta lo stesso, o un clic in mezzo va a vuoto.
  const altroBtn = sez.locator('.sn-crediti-rimedio[data-rimedio="modello"] button');
  await altroBtn.evaluate((b) => { b.__resta = true; });
  await auto.locator('button', { hasText: 'Spegnile' }).click();
  await expect(auto.locator('button')).toHaveText('Riaccendi');
  await new Promise((r) => setTimeout(r, 1000));
  expect(await altroBtn.evaluate((b) => b.__resta === true)).toBe(true);
  const imp = () => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return { riassunto: s.riassuntoSchede.enabled, anticipata: s.spiegaAnticipata.enabled };
  });
  expect(await imp()).toEqual({ riassunto: false, anticipata: false });
  await auto.locator('button', { hasText: 'Riaccendi' }).click();
  await expect(auto.locator('.sn-crediti-rimedio-esito')).toHaveText('Rimesso com\'era.');
  expect(await imp()).toEqual({ riassunto: true, anticipata: true });

  await crediti.evaluate(async () => { await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }); });
  await new Promise((r) => setTimeout(r, 800));
  await crediti.screenshot({ path: `${SHOTS}/crediti-scuro.png`, fullPage: true });

  // «Metti la chiave» porta al campo della chiave.
  await sez.locator('.sn-crediti-rimedio[data-rimedio="chiave"] button').click();
  await expect(crediti.locator('#ownKeyInput')).toBeFocused();

  // I contatori del servizio (#1472): l'avviso scattato, i rimedi scelti (anche quello che resta nella pagina), le
  // automatiche spente, l'invito riscattato e il saldo in fasce; mai la chiave.
  await expect.poll(async () => ((await servizioOggi(app)).avviso_crediti || {})['rimedio|chiave'] || 0, { timeout: 5_000 }).toBe(1);
  const sv = await servizioOggi(app);
  expect(sv.avviso_crediti['scattato|proiezione']).toBeGreaterThanOrEqual(1);
  expect(sv.avviso_crediti['rimedio|automatiche']).toBe(1);
  expect(sv.avviso_crediti['spenta|riassuntoSchede']).toBe(1);
  expect(sv.avviso_crediti['spenta|spiegaAnticipata']).toBe(1);
  expect(sv.invito).toEqual({ ok: 1 });
  expect(sv.saldo_spesa['saldo|c500']).toBe(1);
  expect(JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto()))).not.toContain(PERSONAL_KEY);

  // Lo stesso calo non avvisa due volte; il saldo risale (un regalo) e riscende: avvisa di nuovo.
  expect(await valuta(app)).toBe('gia-detto');
  // Risale di poco (la quota della notte) e riscende: è lo stesso calo.
  saldo = 450;
  await rileggi(app);
  expect(await valuta(app)).toBe('sopra');
  saldo = 380;
  await rileggi(app);
  expect(await valuta(app)).toBe('gia-detto');
  saldo = 1500;
  await rileggi(app);
  expect(await valuta(app)).toBe('sopra');
  saldo = 380;
  await rileggi(app);
  expect(await valuta(app)).toBe('avvisato');
});

test('(E) una home con la conversazione in una scheda che non si vede non lo prende: arriva la notifica', async ({ app, shell, avvisi, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtab(app);
  await redirectHosts(app);
  await treGiorniA300(app);
  saldo = 4000;
  await riscatta(app);
  await scrivi(home, 'ciao');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco fatto' }).first()).toBeVisible({ timeout: 30_000 });

  // Si passa a un'altra scheda; poi il saldo scende.
  await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><p>altro</p>', { pubblico: true });
  saldo = 400;
  await rileggi(app);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif', { hasText: 'al ritmo di oggi finiscono dopodomani' })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('.dash-crediti-avviso')).toHaveCount(0);
});

test('(C) sopra le soglie, con la chiave propria o senza portafoglio non c\'è avviso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtab(app);
  await redirectHosts(app);
  expect(await valuta(app)).toBe('senza-portafoglio');

  await treGiorniA300(app);
  saldo = 4000;
  await riscatta(app);
  expect(await valuta(app)).toBe('sopra');

  saldo = 400;
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-mia' } }); });
  await rileggi(app);
  expect(await valuta(app)).toBe('niente');

  // L'avviso spento dalle Preferenze (o chiedendolo a Filo) non parla nemmeno sotto le soglie.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' }, avvisoCrediti: { attivo: false } }); });
  await rileggi(app);
  expect(await valuta(app)).toBe('sopra');
  const crediti = await app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('avvisoCreditiStato', null)));
  expect(crediti).toBe(null);
});

test('(D) le soglie e la spiegazione preparata si cambiano dalle Preferenze, e il valore fuori scala torna dentro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#avvisoCreditiAttivo')).toBeChecked({ timeout: 15_000 });
  await expect(pref.locator('#avvisoCreditiGiorni')).toHaveValue('2');
  await expect(pref.locator('#avvisoCreditiPercento')).toHaveValue('10');
  await expect(pref.locator('#spiegaAnticipata')).toBeChecked();
  await pref.locator('#sec-crediti').scrollIntoViewIfNeeded();
  await pref.screenshot({ path: `${SHOTS}/preferenze.png` });

  await pref.locator('#avvisoCreditiGiorni').fill('3.5');
  await pref.locator('#avvisoCreditiGiorni').press('Tab');
  await pref.locator('#avvisoCreditiPercento').fill('250');
  await pref.locator('#avvisoCreditiPercento').press('Tab');
  await expect(pref.locator('#avvisoCreditiPercento')).toHaveValue('100');
  await pref.locator('#spiegaAnticipata').uncheck();
  await pref.locator('#avvisoCreditiAttivo').uncheck();
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return { ...s.avvisoCrediti, spiega: s.spiegaAnticipata.enabled };
  }), { timeout: 10_000 }).toEqual({ attivo: false, giorni: 3.5, percento: 100, spiega: false });
});
