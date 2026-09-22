// Verifica #663, giro 3 — la home aperta si accorge anche quando cambia SOLO
// il motivo per cui Filo non può rispondere.
//
// I giri 1 e 2 hanno chiuso le porte in cui Filo passa da «non posso» a
// «posso» (e viceversa) con la home già aperta. Resta il caso in cui la
// risposta a quella domanda NON cambia — resta «non posso» — ma cambia il
// perché, e con lui il messaggio e il suggerimento che la home mostra.
//
// Succede al primo avvio di un invitato: i modelli che Filo può chiamare
// arrivano dalla rete e la prima home è già a schermo quando arrivano. Chi
// riscatta l'invito in quella finestra ha i crediti ma non ancora i modelli:
// se la home non si rifà, continua a dirgli di riscattare un invito che ha
// appena riscattato — il sintomo esatto già visto nel giro 2, per una porta
// che quella correzione non copriva.
//
// Server finto: un codice vero è a usi contati e una prova non ne brucia uno.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
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
            stale: false, dailyCredits: 100,
            invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
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

// Nessun modello da nessuna parte: è lo stato dell'app finché la
// configurazione condivisa non è arrivata dalla rete.
async function senzaModelli(app) {
  await app.evaluate(() => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({ ...orig(), models: {}, modelRegistry: {} });
  });
}

test('riscattato l’invito con i modelli non ancora arrivati: la home smette di mandare a riscattarlo', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await senzaModelli(app);

  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await expect(home.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ })).toHaveCount(1, { timeout: 30_000 });

  // Si riscatta davvero, dalla pagina Crediti, con la home già aperta dietro.
  const crediti = await openTab('filo://credits/credits.html');
  await crediti.waitForFunction(() => { const w = document.getElementById('wallet'); return w && !w.hidden; }, null, { timeout: 30_000 });
  await expect(crediti.locator('#redeemForm')).toBeVisible();
  await crediti.fill('#inviteCode', 'https://filo.red/i/ABCD-EFGH');
  await crediti.click('#redeemBtn');
  await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 30_000 });

  // I crediti ci sono, i modelli ancora no: Filo continua a non poter
  // rispondere, ma il motivo è cambiato. La home non deve più chiedere un
  // invito già riscattato, né col messaggio né col suggerimento in cima.
  await expect(home.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 30_000 });
  await expect(home.locator('#suggestions .dash-suggestion', { hasText: /riscatta l.invito/i })).toHaveCount(0, { timeout: 30_000 });
  await expect(home.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 30_000 });
});
