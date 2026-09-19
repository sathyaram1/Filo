// La pagina «Inviti e utenti» dell'owner (#652): le sette manopole dei crediti
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

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const PSEUDONIMO = 'abcdef0123456789';

let server;
let base = '';
// Il documento config/credits, come se stesse su Firestore.
let configDoc = {};
// Le PATCH arrivate: { mask: [...], fields: {...} }.
const patch = [];
const detailChiesti = [];

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
    rewardFeedbackClosed: 50,
    invitesRemaining: 9,
    eurUsd: 1.17,
    totalLimitUsd: 4.2,
  };
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
            users: [{
              pseudonym: PSEUDONIMO,
              balance: { credits: 4890.5, creditsGranted: 5128, usageUsd: 0.21, limitUsd: 4.2 },
              invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z',
              reconcile: { flagged: false }, usage: { rows: 2, byAction: { chat: 0.2 }, byDay: { '2026-09-17': 0.2 } },
            }],
          },
        });
      }
      if (url === '/walletUserDetail') {
        detailChiesti.push(body.data);
        if (!body.data || body.data.pseudonym !== PSEUDONIMO) return json(res, 200, { result: { found: false } });
        return json(res, 200, {
          result: {
            found: true,
            pseudonym: PSEUDONIMO,
            balance: { credits: 4890.5, creditsGranted: 5128, usageUsd: 0.21, limitUsd: 4.2 },
            createdAt: '2026-09-10T08:00:00.000Z',
            invitedBy: 'owner',
            reconcile: { flagged: false },
            usage: { rows: 2, byAction: { chat: 0.2, traduci: 0.01 }, byDay: { '2026-09-17': 0.21 } },
            grants: [
              { at: '2026-09-10T08:00:00.000Z', credits: 5000, why: 'entry' },
              { at: '2026-09-17T03:10:00.000Z', credits: 100, why: 'daily' },
              { at: '2026-09-18T11:00:00.000Z', credits: 28, why: 'feedback_closed:Zz99' },
            ],
            invites: [{ code: 'BBBB3333', max: 3, used: 1, uses: [{ pseudonym: '0f0f0f0f', at: '2026-09-18T09:00:00.000Z' }], createdAt: '2026-09-12T09:00:00.000Z' }],
            rows: [
              { at: '2026-09-18T10:00:00.000Z', action: 'chat', model: 'deepseek-flash', servedBy: 'Fireworks', promptTokens: 1200, completionTokens: 300, costUsd: 0.2, credits: 244 },
              { at: '2026-09-17T09:00:00.000Z', action: 'traduci', model: 'glm-5', servedBy: 'Baseten', promptTokens: 60, completionTokens: 20, costUsd: 0.01, credits: 12 },
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
  patch.length = 0;
  detailChiesti.length = 0;
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

// La pagina dell'owner NON si apre con openTab: quello sceglie la finestra per
// host, e owner.html ha lo stesso host di credits.html.
async function apriOwner(app) {
  const url = 'filo://credits/owner.html';
  const shell = await app.firstWindow();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
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

test('le sette manopole si salvano davvero, un numero storto non arriva al server e «rimetti com’era» riporta il valore di prima', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  // Ci sono tutte e sette, col valore che ha il server adesso.
  await expect(page.locator('#ownerKnobs .sn-manopola')).toHaveCount(7, { timeout: 15_000 });
  await expect(page.locator('#knob-dailyCredits')).toHaveValue('100');
  await expect(page.locator('#knob-entryCredits')).toHaveValue('5000');
  await expect(page.locator('#knob-rewardFeedbackClosed')).toHaveValue('50');

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
});

test('i numeri che il server calcola si leggono in cima, e non si possono toccare', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);

  const numeri = page.locator('#ownerNumeri .sn-wallet-numero');
  await expect(numeri).toHaveCount(6, { timeout: 15_000 });
  // Un utente si conta al singolare.
  await expect(numeri.nth(0)).toContainText('utente');
  await expect(numeri.nth(0)).not.toContainText('utenti');
  // Elargiti contro il tetto, e quanto manca (70.000 − 5.128).
  await expect(numeri.nth(1)).toContainText('5.128');
  await expect(numeri.nth(1)).toContainText('su 70.000');
  await expect(numeri.nth(2)).toContainText('64.872');
  await expect(numeri.nth(2)).toContainText('ancora elargibili');
  // Crediti vivi: la somma dei saldi.
  await expect(numeri.nth(3)).toContainText('4.890,5');
  // Inviti ancora da dare: uno dei due ha posti liberi.
  await expect(numeri.nth(4)).toContainText('tuo invito da dare');
  // Riscatti rimasti.
  await expect(numeri.nth(5)).toContainText('9');
  await expect(numeri.nth(5)).toContainText('riscatti rimasti');
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

  // Le ultime chiamate: modello, chi ha servito, costo.
  const chiamate = scheda.locator('.sn-wallet-chiamate tbody tr');
  await expect(chiamate).toHaveCount(2);
  await expect(chiamate.nth(0)).toContainText('deepseek-flash');
  await expect(chiamate.nth(0)).toContainText('Fireworks');
  await expect(chiamate.nth(0)).toContainText('0,2 $');
  await expect(chiamate.nth(1)).toContainText('Baseten');

  // Da tastiera la riga si apre come col mouse: si richiude e si riapre.
  await page.keyboard.press('Enter');
  await expect(scheda).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(scheda).toBeVisible();
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
    await page.reload();
    await page.waitForFunction(() => {
      const s = document.getElementById('ownerSection');
      return s && !s.hidden && document.querySelectorAll('#ownerKnobs .sn-manopola').length === 7;
    }, null, { timeout: 15_000 });
    // La pagina prende davvero il tema chiesto.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-sn-theme'))).toBe(tema);
    // Nello scatto ci deve stare anche quello che compare solo quando si usa
    // la pagina: il pulsante «Rimetti com'era» e la scheda di una persona.
    await page.fill('#knob-entryCredits', '6000');
    await expect(page.locator('#knob-entryCredits-rimetti')).toBeVisible();
    await page.locator('#ownerUsers tr.sn-wallet-user').click();
    await expect(page.locator('#ownerUsers .sn-wallet-scheda')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(cartella, `owner-${tema}.png`), fullPage: true });
  }
});
