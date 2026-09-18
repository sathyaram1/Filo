// Giro di verifica locale del ramo claude/link-invito — giro 1.
//
// La promessa: chi apre il link scarica Filo e al PRIMO AVVIO si ritrova i
// crediti senza scrivere niente. Qui Filo parte su un'installazione vergine
// mentre il finto server tiene da parte un invito per chi arriva da quel link:
// nessuno tocca la tastiera, e alla fine i crediti devono esserci, l'avviso
// deve dirlo e gli inviti da dare devono essere link.
//
// Il server è finto apposta: un codice vero è a usi contati e una prova non
// deve bruciarne uno.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, CONFIRM_HOST } from '../../helpers/confirm.mjs';

let server;
const visto = { pending: 0, redeems: [], states: 0 };
let invitoInAttesa = 'ABCDEFGH';
let riscattato = false;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function statoConPortafoglio() {
  return {
    hasWallet: true,
    pseudonym: 'abcdef0123456789',
    balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
    stale: false,
    dailyCredits: 100,
    invites: [
      { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }] },
      { code: 'BBBB3333', max: 3, used: 0, uses: [] },
      { code: 'CCCC4444', max: 3, used: 3, uses: [] },
    ],
  };
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
        visto.states += 1;
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: statoConPortafoglio() });
      }
      if (url === '/walletPendingInvite') {
        visto.pending += 1;
        if (!invitoInAttesa) return json(res, 200, { result: { status: 'none' } });
        return json(res, 200, { result: { status: 'ok', code: invitoInAttesa } });
      }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== 'ABCDEFGH') return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000,
            entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null,
          },
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

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('primo avvio dopo il link: i crediti arrivano da soli, l’avviso lo dice, e gli inviti da dare sono link', async ({ app, openTab }) => {
  // Nessuno scrive niente: si aspetta solo che l'invito in attesa venga
  // chiesto e riscattato da solo (parte quattro secondi dopo l'avvio).
  await expect.poll(() => visto.redeems.length, { timeout: 40000, intervals: [500] }).toBeGreaterThan(0);
  expect(visto.pending).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe('ABCDEFGH');

  // La pagina Crediti: il saldo è quello del server, il campo dell'invito non
  // serve più, e l'avviso racconta cos'è successo.
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 20000 });
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#walletNote')).toContainText('invito', { timeout: 10000 });

  // Gli inviti da dare: un LINK per ciascuno, e quanti sono entrati.
  const righe = page.locator('#invites > li');
  await expect(righe).toHaveCount(3);
  await expect(righe.nth(0).locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222');
  await expect(righe.nth(0).locator('.sn-wallet-invite-state')).toHaveText('entrati 1 su 3');
  // Un posto occupato su tre non spegne il link: restano due persone da
  // invitare.
  await expect(righe.nth(0).locator('.sn-wallet-invite-link')).toBeEnabled();
  await expect(righe.nth(1).locator('.sn-wallet-invite-state')).toHaveText('entrati 0 su 3');
  await expect(righe.nth(2).locator('.sn-wallet-invite-state')).toHaveText('entrati 3 su 3');
  await expect(righe.nth(2).locator('.sn-wallet-invite-link')).toBeDisabled();
  // Chi è entrato si vede per nome.
  await expect(righe.nth(0).locator('.sn-wallet-invite-who')).toHaveText('fedebb00');

  // Il codice resta accanto al link, per chi lo detta a voce.
  await expect(righe.nth(0).locator('.sn-wallet-code')).toHaveText('AAAA-2222');
});

test('la home racconta il benvenuto a chi non ha chiesto niente', async ({ app, shell }) => {
  // La scheda nuova è la home: l'avviso dell'invito arriva lì da solo, senza
  // che l'utente apra la pagina Crediti.
  let home = null;
  const scadenza = Date.now() + 20000;
  while (Date.now() < scadenza && !home) {
    home = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 200));
  }
  expect(home, 'la home non si è aperta all’avvio').toBeTruthy();
  // Il dialogo di Filo vive in uno Shadow DOM chiuso: si legge dall'hook.
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 45000 });
  await expect.poll(() => confirmText(home), { timeout: 15000 }).toContain('Benvenuto in Filo');
  await expect.poll(() => confirmText(home)).toContain('Sei entrato con un invito');
});
