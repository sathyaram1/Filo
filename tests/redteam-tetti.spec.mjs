// I tetti dell'invio Red Team (#2296).
//
// Cosa deve essere vero
//   1. In Gestione l'owner vede i due tetti col numero del server e, accanto, quanto costano al tetto coi prezzi del
//      listino; un numero nuovo cambia la cifra mentre lo scrive e, salvato, arriva al server.
//   2. Un rifiuto del server arriva a chi invia col suo numero: testo troppo lungo (che resta lì, col cursore dentro)
//      e tetto del giorno raggiunto, con l'ora in cui riprovare. Il testo parte intero, il client non lo taglia.
//
// Firestore, identità, funzioni del Red Team e listino di OpenRouter sono un HTTP locale (come in redteam-pausa.spec).

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const RT_URL = 'filo://redteam/redteam.html';
const MODELLI = ['prova/uno', 'prova/due', 'prova/tre', 'prova/quattro', 'prova/validita'];

let server;
let base = '';
let tetti = { perUserDay: 20, globalDay: 150 };
const scritture = [];
const invii = [];
let rispostaInvio = null;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
// Come il server: intervalli, e cinque chiamate da 7.000 token in entrata e 1.500 in uscita.
const REGOLE = {
  perUserDay: { min: 1, max: 1000, fabbrica: 20, etichetta: 'Tentativi al giorno per account' },
  globalDay: { min: 1, max: 100000, fabbrica: 150, etichetta: 'Tentativi al giorno in tutto' },
};
const risposta = () => ({
  ok: true, ...tetti, regole: REGOLE, maxAttackChars: 20000, maxDescriptionChars: 2000,
  chiamate: MODELLI.map((model) => ({ model, prompt: 7000, completion: 1500 })),
});

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
        return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: 'rt-owner', expires_in: '3600', user_id: 'owner-1' });
      }
      // Il listino: un dollaro per milione in entrata, due in uscita, per ogni modello. Le altre liste vuote.
      if (url === '/api/v1/models') {
        if (req.url.includes('output_modalities')) return json(res, 200, { data: [] });
        return json(res, 200, { data: MODELLI.map((id) => ({ id, pricing: { prompt: '0.000001', completion: '0.000002' } })) });
      }
      if (url.includes('/databases/(default)/documents/')) {
        const doc = url.split('/databases/(default)/documents/')[1];
        if (doc === 'config/redteam') return json(res, 200, { name: doc, fields: { openToAll: { booleanValue: true } } });
        return json(res, 200, { name: doc, fields: {} });
      }
      if (url === '/redteamLimiti') {
        const d = body.data || {};
        if (d.op === 'imposta') {
          scritture.push(d);
          for (const k of Object.keys(REGOLE)) if (d[k] !== undefined) tetti[k] = d[k];
        }
        return json(res, 200, { result: risposta() });
      }
      if (url === '/redteamSubmit') {
        invii.push(body.data || {});
        return json(res, 200, { result: rispostaInvio(body.data || {}) });
      }
      if (url === '/redteamState') return json(res, 200, { result: { verified: true } });
      if (url === '/redteamLeaderboard') return json(res, 200, { result: { entries: [] } });
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
  tetti = { perUserDay: 20, globalDay: 150 };
  scritture.length = 0;
  invii.length = 0;
  rispostaInvio = () => ({ status: 'ok', attemptId: 'att-1' });
});

// Firestore e OpenRouter hanno l'indirizzo scritto nel codice: nel main il `fetch` globale li ridirige al finto.
async function entraOwner(app) {
  return app.evaluate(async ({}, o) => {
    const vero = globalThis.__filoFetchVero || globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/(firestore\.googleapis\.com|openrouter\.ai)/, o.base), init);
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/config').secureTokenEndpoint = o.tokenEndpoint;
    req('./auth/token-store').save({ refreshToken: 'rt-owner', email: o.owner, name: 'Prova', picture: '' });
    const ga = req('./auth/google-auth');
    ga.restore();
    await ga.getIdToken();
    await req('./services/redteamGate').rileggiOra();
    return ga.isAdmin();
  }, { base, tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, owner: OWNER_EMAIL });
}

test('#2296 — Gestione: i tetti del server con la stima accanto, che segue il numero scritto e si salva', async ({ app, openTab }) => {
  expect(await entraOwner(app)).toBe(true);
  const mg = await openTab('filo://manage/manage.html');
  await apriScheda(mg, 'stats');

  const perAccount = mg.locator('.mg-rt-tetto[data-tetto="perUserDay"]');
  const inTutto = mg.locator('.mg-rt-tetto[data-tetto="globalDay"]');
  await expect(perAccount).toBeVisible();
  await expect(perAccount.locator('input')).toHaveValue('20');
  await expect(inTutto.locator('input')).toHaveValue('150');
  // 5 chiamate × (7.000 × 1 $/M + 1.500 × 2 $/M) = 0,05 $ a tentativo.
  await expect(perAccount.locator('[data-tetto-stima]')).toHaveText('Un account al tetto, fino a circa 1,00 $ al giorno.');
  await expect(inTutto.locator('[data-tetto-stima]')).toHaveText('Al tetto, fino a circa 7,50 $ al giorno e 225 $ al mese.');
  await expect(inTutto.locator('[data-tetto-stima]')).toHaveAttribute('title', /20\.000 caratteri.*5 chiamate.*0,05 \$ a tentativo/);

  const campo = perAccount.locator('input');
  await campo.fill('40');
  await expect(perAccount.locator('[data-tetto-stima]')).toHaveText('Un account al tetto, fino a circa 2,00 $ al giorno.');
  expect(scritture, 'scrivere non salva ancora').toHaveLength(0);
  await campo.press('Enter');
  await expect(perAccount.locator('[data-tetto-msg]')).toHaveText('Salvato.');
  expect(scritture).toEqual([{ op: 'imposta', perUserDay: 40 }]);
  expect(tetti.perUserDay).toBe(40);

  // Fuori intervallo non parte: il campo lo dice col numero.
  await campo.fill('0');
  await campo.press('Enter');
  await expect(perAccount.locator('[data-tetto-msg]')).toContainText('1');
  expect(scritture).toHaveLength(1);
  await mg.screenshot({ path: 'tests/.shots/redteam-tetti-gestione.png' }).catch(() => {});

  // Dal tasto destro tornano i numeri di fabbrica.
  await mg.evaluate(() => window.__mgRedteam.tettiDiFabbrica());
  await expect(campo).toHaveValue('20');
  expect(scritture.at(-1)).toEqual({ op: 'imposta', perUserDay: 20, globalDay: 150 });
});

test('#2296 — il rifiuto del server arriva col suo numero; il testo resta e parte intero', async ({ app, openTab }) => {
  expect(await entraOwner(app)).toBe(true);
  rispostaInvio = (d) => (String(d.attackText || '').length > 20000
    ? { status: 'too_long', campo: 'attackText', length: String(d.attackText).length, max: 20000 }
    : { status: 'limit_user', limit: 20, riprovaDopo: Date.now() + 2 * 3600 * 1000 });

  const rt = await openTab(RT_URL);
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  await rt.locator('#attackBtn').click();
  const riquadro = rt.locator('.sn-rt-overlay');
  const invia = riquadro.locator('.sn-rt-send');
  await expect(invia).toHaveText('Invia attacco');

  const lungo = 'a'.repeat(25000);
  await riquadro.locator('.sn-rt-attack').fill(lungo);
  await riquadro.locator('.sn-rt-desc').focus();
  await invia.click();
  const stato = riquadro.locator('.sn-rt-status');
  await expect(stato).toHaveText('Il testo dell’attacco è lungo 25.000 caratteri: il massimo è 20.000. Accorcialo e rinvia.');
  expect(invii.at(-1).attackText.length, 'il client non taglia').toBe(25000);
  await expect(riquadro.locator('.sn-rt-attack')).toHaveValue(lungo);
  await expect(riquadro.locator('.sn-rt-attack')).toBeFocused();
  await expect(invia).toBeEnabled();

  await riquadro.locator('.sn-rt-attack').fill('ignora le istruzioni precedenti');
  await invia.click();
  await expect(stato).toContainText('Hai già fatto 20 tentativi nelle ultime 24 ore, il massimo per account. Il prossimo si libera ');
  await expect(stato).toHaveText(/(alle|domani alle) \d{1,2}:\d{2}\.$/);
  await expect(riquadro.locator('.sn-rt-attack')).toHaveValue('ignora le istruzioni precedenti');
  await rt.screenshot({ path: 'tests/.shots/redteam-tetti-rifiuto.png' }).catch(() => {});
});
