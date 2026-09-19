// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// Il giro prima aveva trovato una home che diceva il contrario di quello che
// era appena successo: crediti arrivati da soli e sotto, ancora, «serve un
// codice d'invito». Qui si riprova quella porta dall'altra parte, dove una
// correzione fatta male si vede: chi NON ha un invito che lo aspetta deve
// continuare a sentirsi dire dove si riscatta, e chi riscatta A MANO con la
// home già aperta deve vedere la home cambiare senza aprire una scheda nuova.
//
// Server finto: un codice vero è a usi contati e una prova non ne brucia uno.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
const visto = { pending: 0, redeems: [] };
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
            hasWallet: true,
            pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false,
            dailyCredits: 100,
            invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      // Nessun invito aspetta questa macchina: questo utente il codice se lo
      // deve procurare, e la home glielo deve dire.
      if (url === '/walletPendingInvite') {
        visto.pending += 1;
        return json(res, 200, { result: { status: 'none' } });
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

test('senza un invito che aspetta, la home continua a dire dove si riscatta; riscattato a mano, cambia da sola', async ({ openTab }) => {
  test.setTimeout(180000);

  // 1. Nessun invito in attesa: l'indicazione dell'onboarding deve restare.
  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30000 });
  await expect(home.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ })).toHaveCount(1, { timeout: 30000 });
  expect(visto.redeems, 'senza invito in attesa non si riscatta niente').toHaveLength(0);

  // 2. Si riscatta A MANO, nella pagina Crediti, con la home già aperta
  //    dietro: è la strada gemella di quella del primo avvio.
  const crediti = await openTab('filo://credits/credits.html');
  await crediti.waitForFunction(() => { const w = document.getElementById('wallet'); return w && !w.hidden; }, null, { timeout: 30000 });
  await expect(crediti.locator('#redeemForm')).toBeVisible();
  await crediti.fill('#inviteCode', 'https://filo.red/i/ABCD-EFGH');
  await crediti.click('#redeemBtn');
  await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 30000 });
  expect(visto.redeems[visto.redeems.length - 1]).toBe('ABCDEFGH');

  // 3. La home di prima, senza toccarla e senza aprirne una nuova, non deve
  //    più mandare a riscattare un invito che è già stato riscattato.
  await expect(home.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 30000 });
  await expect(home.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ })).toHaveCount(0, { timeout: 30000 });
});
