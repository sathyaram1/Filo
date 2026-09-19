// Giro di verifica locale del ramo claude/link-invito — giro 5.
//
// La scena che il lavoro promette: si apre il link, si installa Filo, e al
// PRIMO avvio i crediti sono già dentro senza scrivere niente. Il quarto giro
// aveva trovato che l'avviso in home si perdeva proprio quando il server
// rispondeva in fretta — cioè nel caso normale. Qui si riprova quella porta
// col server più svelto possibile (risposta immediata), e si aggiunge quello
// che il quarto giro non aveva guardato: che il benvenuto non si racconti DUE
// volte (una scheda nuova della home, e la home ricaricata).
//
// Scritto da chi verifica, non da chi ha fatto il lavoro. Server finto: un
// codice vero a usi contati non si brucia per una prova.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';

let server;
const visto = { redeems: [], pending: 0 };
let riscattato = false;

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
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      if (url === '/walletPendingInvite') {
        visto.pending += 1;
        return json(res, 200, { result: { status: 'ok', code: CODICE } });
      }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
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

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

// La home dell'avvio: la finestra che Filo apre da solo.
async function attendiHome(app, tetto = 30000) {
  const scadenza = Date.now() + tetto;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => {
      try { return new URL(x.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test('col server che risponde subito, il primo avvio racconta il benvenuto — e una volta sola', async ({ app, shell }) => {
  test.setTimeout(240000);

  // 1. Nessuno scrive niente: il riscatto parte da solo, e al server arriva il
  //    codice pulito.
  await expect.poll(() => visto.redeems.length, { timeout: 60000, intervals: [400] }).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe(CODICE);

  const home = await attendiHome(app);
  expect(home, 'la home non si è aperta all’avvio').toBeTruthy();

  // 2. Il benvenuto arriva in home, coi crediti dentro.
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 90000 });
  await expect.poll(() => confirmText(home), { timeout: 30000 }).toContain('Benvenuto in Filo');
  const testo = await confirmText(home);
  expect(testo).toContain('Sei entrato con un invito');
  expect(testo).toContain('5.000');

  // 3. Chiuso il benvenuto, non torna da solo.
  await clickConfirm(home, 'ok');
  await expect(home.locator(CONFIRM_HOST)).toBeHidden({ timeout: 15000 });
  await new Promise((r) => setTimeout(r, 8000));
  expect(await confirmText(home)).not.toContain('Sei entrato con un invito');

  // 4. Una scheda NUOVA della home non lo racconta una seconda volta.
  const primaDi = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let seconda = null;
  const scadenza = Date.now() + 20000;
  while (Date.now() < scadenza && !seconda) {
    seconda = app.windows().find((w) => {
      if (primaDi.has(w)) return false;
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    }) || null;
    if (!seconda) await new Promise((r) => setTimeout(r, 150));
  }
  expect(seconda, 'la seconda scheda della home non si è aperta').toBeTruthy();
  await new Promise((r) => setTimeout(r, 10000));
  expect(await confirmText(seconda)).not.toContain('Sei entrato con un invito');

  // 5. Nemmeno la home ricaricata.
  await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10000));
  expect(await confirmText(home)).not.toContain('Sei entrato con un invito');

  // 6. E il riscatto è rimasto uno solo: nessuno ha bussato una seconda volta.
  expect(visto.redeems.filter((c) => c === CODICE).length).toBe(1);
});
