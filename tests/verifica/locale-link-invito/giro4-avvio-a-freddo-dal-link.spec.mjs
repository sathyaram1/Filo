// Giro di verifica locale del ramo claude/link-invito — giro 4.
//
// I giri prima hanno provato il collegamento d'invito aperto mentre Filo è già
// ACCESO. Qui si prova l'altra metà, ed è quella che capita davvero: Filo è
// chiuso, l'invitato clicca «apri Filo» sulla pagina del link (o il link in
// chat) e il sistema apre Filo consegnandogli l'indirizzo all'avvio. È un
// cammino diverso da quello della seconda istanza — a quel punto dell'avvio la
// finestra non c'è ancora — e se si perdesse lì, chi clicca vedrebbe Filo
// aprirsi e non succedere niente.
//
// Il finto server NON tiene da parte nessun invito per questa macchina
// (`walletPendingInvite` risponde «none»): così l'unica strada che può portare
// i crediti è il collegamento arrivato fra gli argomenti dell'avvio.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CODICE = 'ABCDEFGH';

let server;
let base = '';
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
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100,
            invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      // Nessun invito tenuto da parte per questa macchina: se i crediti
      // arrivano, è merito del collegamento e di nient'altro.
      if (url === '/walletPendingInvite') { visto.pending += 1; return json(res, 200, { result: { status: 'none' } }); }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('Filo chiuso, si clicca il link: all’avvio l’invito viene riscattato e la pagina Crediti lo mostra', async () => {
  test.setTimeout(180000);
  const userData = cartellaTemporanea('filo-test-');
  const env = {
    ...process.env,
    FILO_USER_DATA: userData,
    FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
    NODE_ENV: 'test',
    FILO_FUNCTIONS_BASE: base,
    FILO_IDENTITY_ENDPOINT: `${base}/accounts:signUp`,
    FILO_SECURE_TOKEN_ENDPOINT: `${base}/token`,
  };
  const app = await electron.launch({
    // L'indirizzo sta fra gli argomenti dell'avvio, come lo mette il sistema
    // quando apre il programma registrato per i `filo://`.
    args: [...argomentiScala, '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP 192.168.1.1 127.0.0.1:9', '.', `filo://invito/${CODICE}`],
    cwd: APP_ROOT,
    env,
  });
  try {
    await app.firstWindow();
    // Il riscatto deve partire da solo: nessuno ha scritto niente.
    await expect.poll(() => visto.redeems.length, { timeout: 60000, intervals: [500] }).toBeGreaterThan(0);
    expect(visto.redeems[0], 'al server è arrivato il codice del collegamento').toBe(CODICE);

    // E la pagina dove l'esito si legge deve essere lì davanti, col saldo del
    // server: chi ha cliccato il link deve vedere cos'è successo.
    const crediti = await expect.poll(async () => {
      const w = app.windows().find((win) => {
        try { return new URL(win.url()).hostname === 'credits'; } catch (_) { return false; }
      });
      return w ? 'c’è' : 'manca';
    }, { timeout: 30000, intervals: [500] }).toBe('c’è').then(() => app.windows().find((win) => {
      try { return new URL(win.url()).hostname === 'credits'; } catch (_) { return false; }
    }));
    await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 30000 });
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
