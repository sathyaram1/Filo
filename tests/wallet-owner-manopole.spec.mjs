// La pagina «Inviti e utenti» dell'owner (#652): le manopole dei crediti
// si cambiano da qui, i numeri che il server calcola si guardano e basta, e
// ogni riga della tabella apre la scheda della persona.
//
// Cosa si prova davvero:
//   · un numero storto (negativo, con la virgola, vuoto) NON arriva al server:
//     la pagina lo dice con parole sue e il documento resta com'era;
//   · un numero buono viene scritto in config/credits e il campo si riscrive
//     con quello che il server RISPONDE, non con quello che era stato digitato;
//   · «Rimetti com'era» riporta davvero il valore di prima, sul server;
//   · la scheda di una persona arriva su richiesta e porta movimenti, inviti e
//     ultime chiamate.
//
// Server dei crediti, identità e Firestore sono un HTTP locale: il main viene
// dirottato lì (come in ripiego-crediti.spec.mjs), perché l'indirizzo di
// Firestore è scritto nel codice.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const PSEUDONIMO = 'abcdef0123456789';

let server;
let base = '';
// Il documento config/credits, come se stesse su Firestore.
let configDoc = {};
// Le PATCH arrivate: { mask: [...], fields: {...} }.
const patch = [];
// Acceso, il documento delle manopole risponde «non autorizzato»: è come si
// comporta Firestore quando le regole non lasciano scrivere.
let rifiutaPatch = false;
const detailChiesti = [];
// Quante volte la pagina ha chiesto i numeri calcolati: dopo un salvataggio li rilegge.
let overviewChiesti = 0;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function fsFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return fields;
}
function fsRead(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('stringValue' in v) out[k] = v.stringValue;
  }
  return out;
}

function configDiPartenza() {
  return {
    eurPerCredit: 0.0007,
    entryCredits: 5000,
    dailyCredits: 100,
    invitesPerUser: 3,
    invitesMaxUses: 3,
    maxGrantCredits: 70000,
    rewardFeedbackSent: 10,
    rewardSentPerDay: 5,
    rewardFeedbackClosed: 50,
    invitesRemaining: 9,
    redeemsPerNetwork: 3,
    redeemsPerInviter: 3,
    redeemsPerNetworkHours: 24,
    eurUsd: 1.17,
    totalLimitUsd: 4.2,
  };
}

// Le persone che la vista elenca: una prova le cambia per vedere cosa fa la pagina quando la vista si rilegge.
let persone = [];
function personeDiPartenza() {
  return [{
    pseudonym: PSEUDONIMO,
    balance: { credits: 4890.5, creditsGranted: 5128, usageUsd: 0.21, limitUsd: 4.2 },
    invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z',
    reconcile: { flagged: false }, usage: { rows: 2, byAction: { chat: 0.2 }, byDay: { '2026-09-17': 0.2 } },
  }];
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }

      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const p = new URLSearchParams(raw);
        const rt = p.get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }

      // ── Firestore ────────────────────────────────────────────────────────
      if (url.includes('/databases/(default)/documents/')) {
        const doc = url.split('/databases/(default)/documents/')[1];
        if (doc === 'config/credits') {
          if (req.method === 'PATCH' && rifiutaPatch) {
            return json(res, 403, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } });
          }
          if (req.method === 'PATCH') {
            const mask = [...new URL(req.url, 'http://x').searchParams.getAll('updateMask.fieldPaths')];
            const valori = fsRead(body.fields);
            patch.push({ mask, valori });
            Object.assign(configDoc, valori);
            return json(res, 200, { name: doc, fields: fsFields(configDoc) });
          }
          return json(res, 200, { name: doc, fields: fsFields(configDoc) });
        }
        // Ogni altro documento (modelli, segreti): esiste e non dice niente.
        return json(res, 200, { name: doc, fields: {} });
      }

      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletOverview') {
        overviewChiesti += 1;
        const cfg = { ...configDoc, eurUsdAt: '2026-09-18', maxGrantUsd: 57.33, migrateLocalMax: 10000 };
        return json(res, 200, {
          result: {
            config: cfg,
            totals: {
              users: 1, totalLimitUsd: 4.2, maxGrantUsd: 57.33,
              maxGrantCredits: cfg.maxGrantCredits, grantedCredits: 5128, liveCredits: 4890.5,
            },
            ownerInvites: [
              { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }], createdAt: '2026-09-11T09:00:00.000Z' },
              { code: 'CCCC4444', max: 3, used: 3, uses: [], createdAt: '2026-09-11T09:00:00.000Z' },
            ],
            users: persone,
          },
        });
      }
      if (url === '/walletUserDetail') {
        detailChiesti.push(body.data);
        const lei = persone.find((p) => body.data && p.pseudonym === body.data.pseudonym);
        if (!lei || lei.pseudonym !== PSEUDONIMO) return json(res, 200, { result: { found: false } });
        return json(res, 200, {
          result: {
            found: true,
            pseudonym: PSEUDONIMO,
            balance: lei.balance,
            createdAt: '2026-09-10T08:00:00.000Z',
            invitedBy: 'owner',
            reconcile: { flagged: false },
            usage: { rows: 3, byAction: { chat: 0.2, traduci: 0.01, spiega: 0.0031 }, byDay: { '2026-09-17': 0.21, '2026-09-16': 0.0031 } },
            grants: [
              { at: '2026-09-10T08:00:00.000Z', credits: 5000, why: 'entry' },
              { at: '2026-09-17T03:10:00.000Z', credits: 100, why: 'daily' },
              { at: '2026-09-18T11:00:00.000Z', credits: 28, why: 'feedback_closed:Zz99' },
            ],
            invites: [{ code: 'BBBB3333', max: 3, used: 1, uses: [{ pseudonym: '0f0f0f0f', at: '2026-09-18T09:00:00.000Z' }], createdAt: '2026-09-12T09:00:00.000Z' }],
            rows: [
              { at: '2026-09-18T10:00:00.000Z', action: 'chat', model: 'deepseek-flash', servedBy: 'Fireworks', promptTokens: 1200, completionTokens: 300, costUsd: 0.2, credits: 244 },
              { at: '2026-09-17T09:00:00.000Z', action: 'traduci', model: 'glm-5', servedBy: 'Baseten', promptTokens: 60, completionTokens: 20, costUsd: 0.01, credits: 12 },
              // Quanto costa davvero una chiamata corta: meno di mezzo
              // centesimo. Arrotondata ai centesimi si leggeva «0 $».
              { at: '2026-09-16T08:00:00.000Z', action: 'spiega', model: 'glm-5', servedBy: 'Baseten', promptTokens: 40, completionTokens: 10, costUsd: 0.0031, credits: 4 },
            ],
          },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  configDoc = configDiPartenza();
  persone = personeDiPartenza();
  patch.length = 0;
  rifiutaPatch = false;
  detailChiesti.length = 0;
  overviewChiesti = 0;
});

async function simulaOwner(app) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    store.save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
}

// Firestore ha l'indirizzo scritto nel codice: nel main il `fetch` globale lo
// ridirige al finto.
async function dirottaFirestore(app, b) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, b);
}

// «Inviti e utenti» sta in Gestione (#1414): l'indirizzo ne apre la scheda, poi torna pulito.
async function apriOwner(app) {
  const url = GESTIONE;
  const shell = await primaFinestra(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `${url}#utenti`);
  const deadline = Date.now() + 15_000;
  let page = null;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((w) => { try { return w.url().startsWith(url); } catch (_) { return false; } }) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('apriOwner: nessuna finestra per ' + url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => {
    const s = document.getElementById('ownerSection');
    return s && !s.hidden;
  }, null, { timeout: 15_000 });
  return page;
}

test('le manopole si salvano davvero, un numero storto non arriva al server e «rimetti com’era» riporta il valore di prima', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  // Ci sono tutte, col valore che ha il server adesso.
  await expect(page.locator('#ownerKnobs .sn-manopola')).toHaveCount(12, { timeout: 15_000 });
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('100');
  await expect(page.locator('#knob-entryCredits')).toHaveValue('5000');
  await expect(page.locator('#knob-rewardFeedbackClosed')).toHaveValue('50');
  // #1120 — il tetto degli ingressi dalla stessa connessione e la sua finestra.
  await expect(page.locator('#knob-redeemsPerNetwork')).toHaveValue('3');
  await expect(page.locator('#knob-redeemsPerNetworkHours')).toHaveValue('24');
  // #1519 — il tetto per chi dà inviti sta fra i due, e si salva da solo.
  await expect(page.locator('#knob-redeemsPerInviter')).toHaveValue('3');
  expect(await page.$$eval('#ownerKnobs .sn-manopola', (rr) => rr.map((r) => r.dataset.chiave).slice(-3)))
    .toEqual(['redeemsPerNetwork', 'redeemsPerInviter', 'redeemsPerNetworkHours']);
  await expect(page.locator('#knob-rewardSentPerDay')).toHaveValue('5');

  const msg = page.locator('#knob-dailyCredits-msg');

  // Negativo: lo dice con parole sue, il fuoco torna sul campo e il documento
  // sul server non si muove.
  await page.fill('#knob-dailyCredits', '-5');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveText('Crediti al giorno: non può essere negativo.');
  await expect(msg).toHaveClass(/is-error/);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('knob-dailyCredits');
  expect(patch.length).toBe(0);

  // Con i decimali: niente arrotondamenti muti.
  await page.fill('#knob-dailyCredits', '10.5');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveText('Crediti al giorno: un numero intero, senza virgola.');
  expect(patch.length).toBe(0);

  // Un campo numerico con dentro qualcosa che numero non è («1e», mezzo
  // esponente) risponde «vuoto» al codice, ma vuoto non è: la frase deve dire
  // che ci vuole un numero, non mandare a scrivere qualcosa che c'è già.
  await page.fill('#knob-dailyCredits', '');
  await page.locator('#knob-dailyCredits').pressSequentially('1e');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveText('Crediti al giorno: ci vuole un numero.');
  expect(patch.length).toBe(0);

  // Vuoto: non vuol dire zero.
  await page.fill('#knob-dailyCredits', '');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveText('Crediti al giorno: scrivi un numero.');
  expect(patch.length).toBe(0);

  // Un numero buono: arriva al server, e SOLO quel campo.
  await page.fill('#knob-dailyCredits', '250');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveText('Salvato.', { timeout: 15_000 });
  await expect(msg).toHaveClass(/is-ok/);
  expect(patch.length).toBe(1);
  expect(patch[0].mask).toEqual(['dailyCredits']);
  expect(patch[0].valori).toEqual({ dailyCredits: 250 });
  expect(configDoc.entryCredits).toBe(5000);
  // Il campo mostra quello che il server ha adesso.
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('250');

  // «Rimetti com'era»: il valore di prima torna sul server, non solo nel campo.
  const rimetti = page.locator('#knob-dailyCredits-rimetti');
  await expect(rimetti).toBeVisible();
  await rimetti.click();
  await expect(msg).toHaveText('Rimesso com’era.', { timeout: 15_000 });
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('100');
  expect(patch.length).toBe(2);
  expect(patch[1].valori).toEqual({ dailyCredits: 100 });
  expect(configDoc.dailyCredits).toBe(100);
  // Rimesso com'era non c'è più niente da rimettere.
  await expect(rimetti).toBeHidden();

  // Un invito per zero persone non esiste: quella manopola parte da 1.
  const msgUsi = page.locator('#knob-invitesMaxUses-msg');
  await page.fill('#knob-invitesMaxUses', '0');
  await page.click('#knob-invitesMaxUses-salva');
  await expect(msgUsi).toHaveText('Persone per invito: almeno 1.');
  expect(patch.length).toBe(2);

  // #1519 — a zero il tetto per chi dà inviti si spegne: zero è un valore buono, e parte solo lui.
  const prima = patch.length;
  await page.fill('#knob-redeemsPerInviter', '0');
  await page.click('#knob-redeemsPerInviter-salva');
  await expect(page.locator('#knob-redeemsPerInviter-msg')).toHaveText('Salvato.', { timeout: 15_000 });
  expect(patch.slice(prima).map((x) => x.valori)).toEqual([{ redeemsPerInviter: 0 }]);
  expect(configDoc.redeemsPerInviter).toBe(0);
  await page.fill('#knob-redeemsPerInviter', '3');
  await page.click('#knob-redeemsPerInviter-salva');
  await expect.poll(() => configDoc.redeemsPerInviter, { timeout: 10_000 }).toBe(3);
});

// #854 — gli ingressi con invito erano un numero in sola lettura: per aprire Filo a più persone l'owner
// doveva passare dalla console di Firebase.
test('gli ingressi con invito rimasti si cambiano dalla pagina, come le altre manopole', async ({ app }) => {
  configDoc.invitesRemaining = 0;
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  const campo = page.locator('#knob-invitesRemaining');
  const msg = page.locator('#knob-invitesRemaining-msg');
  const riga = page.locator('.sn-manopola[data-chiave="invitesRemaining"]');
  await expect(campo).toHaveValue('0', { timeout: 15_000 });
  await expect(riga.locator('label')).toHaveText('Ingressi con invito rimasti');
  await expect(campo).toHaveAttribute('title', 'Quante persone possono ancora entrare con un invito, in tutto. A zero nessun invito funziona più.');
  // Il numero sta in un posto solo: la manopola.
  await expect(page.locator('#ownerNumeri')).not.toContainText('riscatti');

  await page.fill('#knob-invitesRemaining', '-1');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Ingressi con invito rimasti: non può essere negativo.');
  await expect(msg).toHaveClass(/is-error/);

  // Scritto alla italiana, con la virgola: con il sistema in inglese il campo numerico buttava via la virgola,
  // e «2,5» partiva come 25. Scritto o incollato, è un decimale.
  await page.fill('#knob-invitesRemaining', '');
  await campo.pressSequentially('2,5');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Ingressi con invito rimasti: un numero intero, senza virgola.');
  await page.fill('#knob-invitesRemaining', '');
  await app.evaluate(({ clipboard }) => clipboard.writeText('2,5'));
  await campo.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Ingressi con invito rimasti: un numero intero, senza virgola.');
  await page.fill('#knob-invitesRemaining', '');
  await campo.pressSequentially('venti');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Ingressi con invito rimasti: ci vuole un numero.');
  expect(patch.length).toBe(0);

  // Il main rifà il controllo: una parola, un negativo o un decimale non arrivano a config/credits nemmeno
  // saltando la pagina.
  const diretti = await page.evaluate(async (valori) => {
    const out = [];
    for (const v of valori) {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WALLET_OWNER_KNOBS_SET, patch: { invitesRemaining: v } });
      out.push({ ok: Boolean(r && r.ok), error: String((r && r.error) || '') });
    }
    return out;
  }, ['venti', -1, 2.5]);
  expect(diretti.map((d) => d.ok)).toEqual([false, false, false]);
  expect(diretti[0].error).toContain('ci vuole un numero');
  expect(diretti[1].error).toContain('non può essere negativo');
  expect(diretti[2].error).toContain('un numero intero');
  expect(patch.length).toBe(0);
  expect(configDoc.invitesRemaining).toBe(0);

  // Da 0 a 20: arriva al server solo quel campo, e i numeri calcolati accanto si rileggono.
  const letturePrima = overviewChiesti;
  await page.fill('#knob-invitesRemaining', '20');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Salvato.', { timeout: 15_000 });
  expect(patch.length).toBe(1);
  expect(patch[0].mask).toEqual(['invitesRemaining']);
  expect(patch[0].valori).toEqual({ invitesRemaining: 20 });
  expect(configDoc.dailyCredits).toBe(100);
  await expect(campo).toHaveValue('20');
  await expect.poll(() => overviewChiesti, { timeout: 10_000 }).toBeGreaterThan(letturePrima);

  // «Rimetti com'era» riporta lo zero, sul server.
  await page.click('#knob-invitesRemaining-rimetti');
  await expect(msg).toHaveText('Rimesso com’era.', { timeout: 15_000 });
  await expect(campo).toHaveValue('0');
  expect(patch[1].valori).toEqual({ invitesRemaining: 0 });
  expect(configDoc.invitesRemaining).toBe(0);

  // Risalvato a 20 e riaperta la pagina, si legge 20.
  await page.fill('#knob-invitesRemaining', '20');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Salvato.', { timeout: 15_000 });
  expect(configDoc.invitesRemaining).toBe(20);
  await ricaricaSu(page, 'utenti');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#knob-invitesRemaining')).toHaveValue('20', { timeout: 15_000 });
  expect(patch.length).toBe(3);

  // Mille scritto alla italiana è mille, non uno.
  await page.locator('#knob-invitesRemaining').fill('');
  await page.locator('#knob-invitesRemaining').pressSequentially('1.000');
  await page.click('#knob-invitesRemaining-salva');
  await expect(page.locator('#knob-invitesRemaining-msg')).toHaveText('Salvato.', { timeout: 15_000 });
  expect(configDoc.invitesRemaining).toBe(1000);
  await expect(page.locator('#knob-invitesRemaining')).toHaveValue('1000');
});

// #854 — il contatore degli ingressi lo scala il server a ogni riscatto: una manopola appena salvata restava ferma
// sul numero salvato finché non si riapriva la pagina.
test('dopo un salvataggio la manopola degli ingressi segue il numero che il server ha scalato, e si può ancora rimettere com’era', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  const campo = page.locator('#knob-invitesRemaining');
  const msg = page.locator('#knob-invitesRemaining-msg');
  await expect(campo).toHaveValue('9', { timeout: 15_000 });

  await page.fill('#knob-invitesRemaining', '20');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toHaveText('Salvato.', { timeout: 15_000 });

  // Tre persone entrano con un invito; poi l'owner cambia un'altra manopola e la pagina rilegge i numeri.
  configDoc.invitesRemaining = 17;
  const prima = overviewChiesti;
  await page.fill('#knob-dailyCredits', '120');
  await page.click('#knob-dailyCredits-salva');
  await expect(page.locator('#knob-dailyCredits-msg')).toHaveText('Salvato.', { timeout: 15_000 });
  await expect.poll(() => overviewChiesti, { timeout: 10_000 }).toBeGreaterThan(prima);
  await expect(campo).toHaveValue('17', { timeout: 10_000 });
  // Il campo salvato prima resta lì col suo valore e col suo «rimetti com'era».
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('120');

  await page.click('#knob-invitesRemaining-rimetti');
  await expect(msg).toHaveText('Rimesso com’era.', { timeout: 15_000 });
  expect(configDoc.invitesRemaining).toBe(9);
  await expect(campo).toHaveValue('9');
});

test('i numeri che il server calcola si leggono in cima, e non si possono toccare', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  const numeri = page.locator('#ownerNumeri .sn-wallet-numero');
  await expect(numeri).toHaveCount(8, { timeout: 15_000 });
  // Un utente si conta al singolare.
  await expect(numeri.nth(0)).toContainText('utente');
  await expect(numeri.nth(0)).not.toContainText('utenti');
  // Chi l'ha usato davvero (#820): attivi a 7 e 30 giorni.
  await expect(numeri.nth(1)).toContainText('negli ultimi 7 giorni');
  await expect(numeri.nth(2)).toContainText('negli ultimi 30 giorni');
  // Elargiti contro il tetto, e quanto manca (70.000 − 5.128).
  await expect(numeri.nth(3)).toContainText('5.128');
  await expect(numeri.nth(3)).toContainText('su 70.000');
  await expect(numeri.nth(4)).toContainText('64.872');
  await expect(numeri.nth(4)).toContainText('ancora elargibili');
  // Crediti vivi: la somma dei saldi.
  await expect(numeri.nth(5)).toContainText('4.890,5');
  await expect(numeri.nth(6)).toContainText('crediti spesi');
  // Inviti ancora da dare: uno dei due ha posti liberi.
  await expect(numeri.nth(7)).toContainText('tuo invito da dare');
  // Gli ingressi con invito rimasti sono una manopola (#854): fra i numeri non si ripetono.
  await expect(page.locator('#ownerNumeri')).not.toContainText('riscatti');
  await expect(page.locator('#ownerNumeri')).not.toContainText('Ingressi con invito');
  // Sono numeri, non campi: nessuno di questi si scrive.
  expect(await page.locator('#ownerNumeri input').count()).toBe(0);
});

test('la riga di una persona apre la sua scheda: movimenti, suoi inviti e ultime chiamate', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
  // Prima di aprire non si chiede niente al server: la scheda costa una
  // chiamata per persona.
  expect(detailChiesti.length).toBe(0);

  await page.locator('#ownerUsers tr.sn-wallet-user').click();
  const scheda = page.locator('#ownerUsers .sn-wallet-scheda');
  await expect(scheda).toBeVisible({ timeout: 15_000 });
  expect(detailChiesti).toEqual([{ pseudonym: PSEUDONIMO }]);

  // In due parole: saldo, ricevuti, speso, chi l'ha invitata.
  await expect(scheda).toContainText('4.890,5');
  await expect(scheda).toContainText('5.128');
  await expect(scheda).toContainText('0,21 $');
  await expect(scheda).toContainText('te');

  // I movimenti, col premio per la segnalazione risolta scritto in italiano e
  // il più recente in cima (il server li manda nell'ordine del documento, dal
  // più vecchio: l'ordine lo decide la pagina, sulla data).
  const movimenti = scheda.locator('.sn-wallet-scheda-blocco', { hasText: 'Movimenti' }).locator('li');
  await expect(movimenti).toHaveCount(3);
  await expect(movimenti.nth(0)).toContainText('Segnalazione risolta');
  await expect(movimenti.nth(0)).toContainText('+28');
  await expect(movimenti.nth(1)).toContainText('Quota del giorno');
  await expect(movimenti.nth(2)).toContainText('Invito riscattato');

  // I suoi inviti, con chi è entrato.
  await expect(scheda.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/BBBB3333');
  await expect(scheda).toContainText('entrati 1 su 3');
  await expect(scheda).toContainText('0f0f0f0f');

  // Le ultime chiamate: modello, chi ha servito, crediti e costo.
  const chiamate = scheda.locator('.sn-wallet-chiamate tbody tr');
  await expect(chiamate).toHaveCount(3);
  await expect(chiamate.nth(0)).toContainText('deepseek-flash');
  await expect(chiamate.nth(0)).toContainText('Fireworks');
  await expect(chiamate.nth(0)).toContainText('0,2 $');
  await expect(chiamate.nth(0)).toContainText('244');
  await expect(chiamate.nth(1)).toContainText('Baseten');
  // Una chiamata corta costa meno di mezzo centesimo: il costo si legge lo
  // stesso, e accanto ci sono i crediti, che sono numeri interi.
  await expect(chiamate.nth(2)).toContainText('0,0031 $');
  await expect(chiamate.nth(2)).toContainText('4');
  await expect(scheda.locator('.sn-wallet-scheda-blocco', { hasText: 'Dove sono andati i crediti' })).toContainText('0,0031 $');

  // Da tastiera la riga si apre come col mouse: si richiude e si riapre.
  await page.keyboard.press('Enter');
  await expect(scheda).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(scheda).toBeVisible();
});

// Un numero scritto e non salvato spariva in silenzio appena il cursore
// lasciava il campo, e fino a quel momento la pagina lo mostrava come se fosse
// in vigore (pattern «un testo scritto in una casella si salva da solo, o lo
// perdi»). Adesso: finché è solo digitato si VEDE che non è quello del server,
// e quando il cursore se ne va parte da solo.
test('un numero lasciato a metà parte da solo, si vede finché non è partito, e un rifiuto del server si spiega a parole', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  await page.waitForFunction(() => document.querySelectorAll('#ownerKnobs .sn-manopola').length === 12, null, { timeout: 15_000 });

  const scatola = page.locator('.sn-manopola[data-chiave="dailyCredits"]');
  const msg = page.locator('#knob-dailyCredits-msg');
  const rimetti = page.locator('#knob-dailyCredits-rimetti');

  // Senza un salvataggio da disfare, «rimetti com'era» non c'è: prometteva di
  // riportare indietro una cosa che non era successa.
  await expect(rimetti).toBeHidden();

  await page.fill('#knob-dailyCredits', '250');
  await expect(scatola).toHaveClass(/is-sporco/);
  await expect(rimetti).toBeHidden();
  expect(patch.length).toBe(0);

  // Il cursore va su un altro campo: il numero parte senza che nessuno prema
  // niente.
  await page.locator('#knob-entryCredits').click();
  await expect(msg).toHaveText('Salvato.', { timeout: 15_000 });
  expect(patch.length).toBe(1);
  expect(patch[0].valori).toEqual({ dailyCredits: 250 });
  await expect(scatola).not.toHaveClass(/is-sporco/);
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('250');
  // Adesso sì che c'è qualcosa da disfare.
  await expect(rimetti).toBeVisible();

  // Il server rifiuta la scrittura: quello che compare è una frase, non la sua
  // risposta per intero.
  rifiutaPatch = true;
  await page.fill('#knob-dailyCredits', '300');
  await page.click('#knob-dailyCredits-salva');
  await expect(msg).toHaveClass(/is-error/, { timeout: 15_000 });
  const testo = await msg.innerText();
  expect(testo).toMatch(/^Non salvato: /);
  expect(testo).not.toMatch(/[{}]|403|PERMISSION_DENIED|config update|fetch/i);
  expect(configDoc.dailyCredits).toBe(250);
});

// #666 — le uscite che non toccano il campo: ricaricare la pagina o chiudere la scheda col cursore ancora dentro
// buttavano via il numero, in silenzio. Nessun tasto, nessun clic altrove: Playwright non fa perdere il fuoco.
test('un numero scritto non si perde ricaricando la pagina o chiudendo la scheda col cursore ancora nel campo', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  await page.waitForFunction(() => document.querySelectorAll('#ownerKnobs .sn-manopola').length === 12, null, { timeout: 15_000 });

  await page.fill('#knob-dailyCredits', '500');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('knob-dailyCredits');
  expect(patch.length).toBe(0);
  await ricaricaSu(page, 'utenti');
  await expect.poll(() => configDoc.dailyCredits, { timeout: 10_000 }).toBe(500);
  expect(patch.map((p) => p.valori)).toEqual([{ dailyCredits: 500 }]);
  // La pagina ricaricata mostra il numero che il server ha adesso.
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('500', { timeout: 15_000 });

  await page.fill('#knob-entryCredits', '4200');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('knob-entryCredits');
  const shell = await primaFinestra(app);
  const chiusa = await shell.evaluate(async () => {
    const t = (await window.filoShell.tabs.snapshot()).tabs.find((x) => String(x.url || '').includes('manage/manage.html'));
    if (!t) return false;
    await window.filoShell.tabs.close(t.id);
    return true;
  });
  expect(chiusa).toBe(true);
  await expect.poll(() => configDoc.entryCredits, { timeout: 10_000 }).toBe(4200);
  // Spedito il numero, la pagina chiusa se ne va davvero.
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .some((w) => !w.isDestroyed() && w.getURL().includes('manage/manage.html'))), { timeout: 5000 }).toBe(false);
});

// Il tasto destro è centrale in Filo: su una riga della tabella deve offrire
// quello che si vuole fare a QUELLA persona. Prima si apriva il menu generale
// della pagina, che della riga non sa niente.
test('il tasto destro su una persona apre un menu suo: scheda, pseudonimo, regalo', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  const riga = page.locator('#ownerUsers tr.sn-wallet-user').first();
  await expect(riga).toBeVisible({ timeout: 15_000 });

  await riga.click({ button: 'right' });
  const menu = page.locator('.sn-wallet-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Apri la scheda');
  await expect(menu).toContainText('Copia lo pseudonimo');

  // Dal menu si regala a questa persona senza copiare niente a mano.
  await menu.getByText('Regala crediti a questa persona').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#ownerGrantPseudonym')).toHaveValue(PSEUDONIMO);

  // E la scheda si apre anche da lì.
  await riga.click({ button: 'right' });
  await page.locator('.sn-wallet-ctxmenu').getByText('Apri la scheda').click();
  await expect(page.locator('#ownerUsers .sn-wallet-scheda')).toBeVisible({ timeout: 15_000 });

  // Esc lo chiude, e il menu non resta appeso.
  await riga.click({ button: 'right' });
  await expect(page.locator('.sn-wallet-ctxmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-wallet-ctxmenu')).toHaveCount(0);
});

// #1087.4 — la vista si rilegge a ogni movimento di crediti, anche di un'altra scheda, e rifaceva da capo la tabella:
// sotto le mani dell'owner sparivano il menu del tasto destro e la scheda aperta, e il fuoco cadeva dalla riga.
test('una rilettura della vista lascia aperti il menu e la scheda di una persona, col fuoco sulla sua riga', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  const righe = page.locator('#ownerUsers tr.sn-wallet-user');
  const lei = righe.filter({ hasText: PSEUDONIMO });
  const scheda = page.locator('#ownerUsers .sn-wallet-scheda');
  const menu = page.locator('.sn-wallet-ctxmenu');
  const fuocoSu = () => page.evaluate(() => {
    const a = document.activeElement;
    return a && a.classList.contains('sn-wallet-user') ? a.cells[0].textContent : null;
  });
  const rileggi = () => app.evaluate(() => globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED }));

  await expect(righe).toHaveCount(1, { timeout: 15_000 });
  await lei.click();
  await expect(scheda).toContainText('4.890,5', { timeout: 15_000 });
  await lei.click({ button: 'right' });
  await expect(menu).toBeVisible();
  expect(await fuocoSu()).toBe(PSEUDONIMO);

  // Le arrivano crediti: la riga e la scheda aperta prendono il numero nuovo, e niente si chiude.
  persone[0] = { ...persone[0], balance: { ...persone[0].balance, credits: 5890.5, creditsGranted: 6128 } };
  await rileggi();
  await expect(lei.locator('td').nth(1)).toHaveText('5.890,5', { timeout: 15_000 });
  await expect(scheda).toContainText('5.890,5', { timeout: 15_000 });
  expect(detailChiesti.length).toBe(2);
  await expect(menu).toHaveCount(1);
  await expect(menu).toBeVisible();
  expect(await fuocoSu()).toBe(PSEUDONIMO);

  // Entra una persona nuova, in cima: la riga col fuoco non si sposta e non lo perde.
  persone.unshift({
    pseudonym: 'f00dfeed00000001', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0, limitUsd: 3.5 },
    invitedBy: 'owner', createdAt: '2026-10-01T08:00:00.000Z', reconcile: null, usage: { rows: 0, byAction: {}, byDay: {} },
  });
  await rileggi();
  await expect(righe).toHaveCount(2, { timeout: 15_000 });
  await expect(righe.first()).toContainText('f00dfeed00000001');
  await expect(menu).toBeVisible();
  await expect(scheda).toBeVisible();
  expect(await fuocoSu()).toBe(PSEUDONIMO);

  // Esc chiude il menu, e il fuoco è ancora sulla riga: Invio richiude la scheda.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(scheda).toBeHidden();

  // Una persona che il server non elenca più porta via la sua riga e il menu aperto su di lei.
  await lei.click({ button: 'right' });
  await expect(menu).toBeVisible();
  persone = persone.filter((p) => p.pseudonym !== PSEUDONIMO);
  await rileggi();
  await expect(righe).toHaveCount(1, { timeout: 15_000 });
  await expect(lei).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

// Tema chiaro e tema scuro: le manopole e i riquadri dei numeri sono roba
// nuova sulla pagina, e devono leggersi in tutti e due. Gli screenshot
// finiscono in tests/.shots/ (non tracciati) e li guarda chi lavora.
test('manopole e numeri si leggono in tema chiaro e in tema scuro', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const cartella = join(process.cwd(), 'tests', '.shots', 'owner-manopole');
  mkdirSync(cartella, { recursive: true });

  const page = await apriOwner(app);
  await page.setViewportSize({ width: 1200, height: 1000 }).catch(() => {});

  for (const tema of ['light', 'dark']) {
    await app.evaluate(async ({}, t) => {
      const s = (await globalThis.__filoStorage.get('settings')).settings || {};
      await globalThis.__filoStorage.set({ settings: { ...s, theme: t } });
    }, tema);
    await ricaricaSu(page, 'utenti');
    await page.waitForFunction(() => {
      const s = document.getElementById('ownerSection');
      return s && !s.hidden && document.querySelectorAll('#ownerKnobs .sn-manopola').length === 12;
    }, null, { timeout: 15_000 });
    // La pagina prende davvero il tema chiesto.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-sn-theme'))).toBe(tema);
    // Nello scatto ci deve stare anche quello che compare solo quando si usa
    // la pagina: il pulsante «Rimetti com'era» e la scheda di una persona.
    // Un valore diverso per ogni tema: il secondo giro trova sul server quello
    // che ha salvato il primo, e risalvarlo darebbe «È già così».
    await page.fill('#knob-entryCredits', tema === 'dark' ? '6100' : '6000');
    await page.click('#knob-entryCredits-salva');
    await expect(page.locator('#knob-entryCredits-msg')).toHaveText('Salvato.', { timeout: 15_000 });
    await expect(page.locator('#knob-entryCredits-rimetti')).toBeVisible();
    await page.locator('#ownerUsers tr.sn-wallet-user').click();
    await expect(page.locator('#ownerUsers .sn-wallet-scheda')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(cartella, `owner-${tema}.png`), fullPage: true });
  }
});
