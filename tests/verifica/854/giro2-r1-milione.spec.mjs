// Verifica #854 giro 2: un milione scritto alla italiana nella manopola degli ingressi diventa 1.


import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

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

// La pagina dell'owner NON si apre con openTab: quello sceglie la finestra per
// host, e owner.html ha lo stesso host di credits.html.
async function apriOwner(app) {
  const url = 'filo://credits/owner.html';
  const shell = await primaFinestra(app);
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

// Scritto o incollato con i punti delle migliaia, un milione non deve partire come 1: o si salva un milione, o si
// rifiuta con una frase. Il campo numerico butta via il secondo punto (scritto) o tutto dopo il primo (incollato).
test('r1 un milione scritto o incollato coi punti non si salva come 1', async ({ app }) => {
  expect(await simulaOwner(app)).toBe(true);
  await dirottaFirestore(app, base);
  const page = await apriOwner(app);
  const campo = page.locator('#knob-invitesRemaining');
  const msg = page.locator('#knob-invitesRemaining-msg');
  await expect(campo).toHaveValue('9', { timeout: 15_000 });

  await campo.fill('');
  await campo.pressSequentially('1.000.000');
  await page.click('#knob-invitesRemaining-salva');
  await expect(msg).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  expect(patch.map((p) => p.valori.invitesRemaining)).not.toContain(1);

  await campo.fill('');
  await app.evaluate(({ clipboard }) => clipboard.writeText('1.000.000'));
  await campo.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.click('#knob-invitesRemaining-salva');
  await page.waitForTimeout(1000);
  expect(patch.map((p) => p.valori.invitesRemaining)).not.toContain(1);
});
