// Giro di verifica locale del ramo claude/link-invito — giro 1.
//
// L'invito che aspetta questa installazione non deve andare perso se al primo
// avvio il server non risponde: chi scarica Filo e lo apre in treno, o mentre
// il server è giù, deve ritrovare i crediti al riavvio dopo. Qui Filo parte
// due volte sulla STESSA installazione: la prima col server muto, la seconda
// col server acceso.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let server;
let base = '';
const visto = { pending: 0, redeems: [] };
let serverMuto = true;
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
      if (serverMuto) { res.destroy(); return; }
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }] } });
      }
      if (url === '/walletPendingInvite') { visto.pending += 1; return json(res, 200, { result: { status: 'ok', code: 'ABCDEFGH' } }); }
      if (url === '/walletRedeem') {
        visto.redeems.push(String((body.data && body.data.code) || ''));
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('se al primo avvio il server non risponde, l’invito arriva al riavvio dopo', async () => {
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
  const avvia = () => electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP 192.168.1.1 127.0.0.1:9', '.'],
    cwd: APP_ROOT,
    env,
  });

  try {
    // Primo avvio: il server chiude ogni richiesta in faccia.
    serverMuto = true;
    let app = await avvia();
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 12000));
    expect(visto.redeems.length, 'col server muto non si riscatta niente').toBe(0);
    await chiudiApp(app);

    // Secondo avvio, server acceso: l'invito che aspettava arriva lo stesso.
    serverMuto = false;
    app = await avvia();
    await app.firstWindow();
    await expect.poll(() => visto.redeems.length, { timeout: 45000, intervals: [500] }).toBeGreaterThan(0);
    expect(visto.redeems[0]).toBe('ABCDEFGH');
    await chiudiApp(app);
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
