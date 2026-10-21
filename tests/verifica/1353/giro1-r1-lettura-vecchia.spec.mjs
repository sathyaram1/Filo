// Con un portafoglio le cifre dei crediti che Filo dice fuori dalla pagina
// Crediti sono quelle del server (#816): la chat, il messaggio d'invio di una
// segnalazione, il riquadro della risoluzione. Il vecchio conteggio locale non
// riceve più premi.
//
// Server dei crediti e identità sono un HTTP locale (come wallet-credits.spec):
// le variabili vanno nell'ambiente prima che la fixture lanci Electron.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let serverDown = false;
let saldo = 4321.5;
let quota = 100;
let grants = [];
let tetto = 5;
// #1353 — un server dei crediti lento (avvio a freddo) e quante letture del saldo gli arrivano.
let ritardoMs = 0;
let lettureSaldo = 0;

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
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-816' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-816' });
      }
      if (serverDown) { res.destroy(); return; }
      if ((req.headers.authorization || '') !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        lettureSaldo += 1;
        // Le cifre sono quelle di quando la domanda è arrivata, come sul server vero.
        const risposta = {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: saldo, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: quota, sentRewardsPerDay: tetto, grants, invites: [],
          },
        };
        setTimeout(() => json(res, 200, risposta), ritardoMs);
        return;
      }
      if (url === '/walletRedeem') {
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, inviteCodes: [] },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.beforeEach(() => {
  serverDown = false;
  saldo = 4321.5;
  quota = 100;
  tetto = 5;
  ritardoMs = 0;
  lettureSaldo = 0;
  grants = [{ at: '2026-09-20T10:00:00.000Z', credits: 5000, why: 'entry' }];
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

async function riscatta(app) {
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

function saldoLocale(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact);
}

// Il testo del «Filo State» che un turno di chat mette nel prompt.
function statoChat(app) {
  return app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true })).stateText);
}

// Il tempo del main va avanti di un minuto: la chat torna a chiedere al server.
function passaUnMinuto(app) {
  return app.evaluate(() => {
    const vero = globalThis.__dateNowVero || Date.now;
    globalThis.__dateNowVero = vero;
    globalThis.__spostamento = (globalThis.__spostamento || 0) + 61_000;
    Date.now = () => vero() + globalThis.__spostamento;
  });
}

async function homeDiAvvio(app) {
  let win = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Verifica #1353, giro 1: una lettura del saldo partita prima e finita dopo non deve prendere il posto di quella nuova.
test('r1 lettura vecchia che arriva dopo: la chat dice il saldo della lettura più nuova, e non lo crede fresco', async ({ app }) => {
  await homeDiAvvio(app);
  await riscatta(app);
  // La lettura che Filo fa da solo quattro secondi dopo l'avvio è già passata.
  await new Promise((r) => setTimeout(r, 5_000));
  const prima = lettureSaldo;
  // Una lettura lenta parte col saldo a 4.000 (un avvio a freddo, o la pagina Crediti aperta in quel momento)…
  saldo = 4000;
  ritardoMs = 3_000;
  await app.evaluate(() => { globalThis.SN_WALLET_MAIN.readState().catch(() => {}); });
  await expect.poll(() => lettureSaldo).toBeGreaterThan(prima);
  // …poi il saldo scende e una lettura veloce lo porta: è quella che deve valere.
  saldo = 3900;
  ritardoMs = 200;
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.readState());
  expect(await statoChat(app)).toMatch(/Saldo: 3\.?900 crediti/);
  await new Promise((r) => setTimeout(r, 3_500));
  expect(await statoChat(app), 'la lettura lenta, partita prima, non sostituisce quella nuova').toMatch(/Saldo: 3\.?900 crediti/);
});
