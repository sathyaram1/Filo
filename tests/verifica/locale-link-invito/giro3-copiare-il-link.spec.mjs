// Giro di verifica locale del ramo claude/link-invito — giro 3.
//
// Un invito si dà come LINK, e la pagina Crediti promette di darlo «con un
// clic»: il pulsante dice «Copiato» e quello che si incolla in chat dev'essere
// il link, non altro. Qui si guarda quello che i giri prima hanno dato per
// buono senza aprirlo: che negli appunti del sistema ci finisca davvero il
// link, che il pulsante accanto copi il codice, e che due clic attaccati — la
// cosa che tutti fanno su un pulsante che sembra testo — non lascino la riga
// senza più il suo link.
//
// Server finto: un codice vero è a usi contati e una prova non ne brucia uno.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const INVITI = [
  { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }] },
  { code: 'BBBB3333', max: 3, used: 0, uses: [] },
];

function statoConPortafoglio() {
  return {
    hasWallet: true,
    pseudonym: 'abcdef0123456789',
    balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
    stale: false,
    dailyCredits: 100,
    invites: INVITI,
  };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') return json(res, 200, { result: statoConPortafoglio() });
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
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

async function appunti(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}
async function svuotaAppunti(app) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('—niente—'));
}

async function apriCrediti(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#invites > li')).toHaveCount(2, { timeout: 20000 });
  return page;
}

test('il link dell’invito finisce davvero negli appunti, e il codice accanto pure', async ({ app, openTab }) => {
  const page = await apriCrediti(openTab);
  const riga = page.locator('#invites > li').first();

  await svuotaAppunti(app);
  await riga.locator('.sn-wallet-invite-link').click();
  // Il pulsante conferma: «Copiato». Ma la conferma vale solo se quello che si
  // incolla in chat è il link.
  await expect(riga.locator('.sn-wallet-invite-link')).toHaveText('Copiato', { timeout: 5000 });
  await expect.poll(() => appunti(app), { timeout: 5000, intervals: [100] }).toBe('https://filo.red/i/AAAA2222');

  // Il codice accanto, per chi lo detta a voce: si copia lui, non il link.
  await expect(riga.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222', { timeout: 5000 });
  await svuotaAppunti(app);
  await riga.locator('.sn-wallet-code').click();
  await expect.poll(() => appunti(app), { timeout: 5000, intervals: [100] }).toBe('AAAA-2222');
});

test('due clic attaccati sul pulsante non fanno sparire il link dalla riga', async ({ app, openTab }) => {
  const page = await apriCrediti(openTab);
  const link = page.locator('#invites > li').first().locator('.sn-wallet-invite-link');

  // Un pulsante che sembra testo si clicca due volte: succede a chiunque non
  // sia sicuro che il primo clic sia andato a segno.
  await link.dblclick();
  // Passata l'animazione della conferma, la riga deve tornare a mostrare il
  // link: è l'unica cosa che l'utente deve poter leggere e dettare.
  await page.waitForTimeout(3000);
  await expect(link).toHaveText('https://filo.red/i/AAAA2222');
});

test('anche a clic ripetuti quello che si incolla resta il link giusto', async ({ app, openTab }) => {
  const page = await apriCrediti(openTab);
  const riga = page.locator('#invites > li').nth(1);
  const link = riga.locator('.sn-wallet-invite-link');
  await svuotaAppunti(app);
  for (let i = 0; i < 3; i += 1) await link.click();
  await expect.poll(() => appunti(app), { timeout: 5000, intervals: [100] }).toBe('https://filo.red/i/BBBB3333');
});
