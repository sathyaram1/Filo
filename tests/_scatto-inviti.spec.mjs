// Scatto temporaneo della pagina Crediti con gli inviti (#651), chiaro e
// scuro. Si cancella dopo averlo guardato.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { test } from './fixtures/electron.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots', 'inviti-651');
let server;
let redeemed = true;

const INVITES = [
  {
    code: 'AAAA-2222', link: 'https://filo.red/i/AAAA2222', used: 2, max: 3, revoked: false,
    uses: [
      { pseudonym: '1111aaaa2222bbbb', at: '2026-09-10T09:00:00.000Z' },
      { pseudonym: '3333cccc4444dddd', at: '2026-09-12T18:30:00.000Z' },
    ],
  },
  {
    code: 'BBBB-3333', link: 'https://filo.red/i/BBBB3333', used: 3, max: 3, revoked: false,
    uses: [{ pseudonym: '5555eeee6666ffff', at: '2026-09-01T08:00:00.000Z' }, { pseudonym: '7777aaaa8888bbbb', at: '2026-09-02T08:00:00.000Z' }, { pseudonym: '9999cccc2222dddd', at: '2026-09-03T08:00:00.000Z' }],
  },
  { code: 'CCCC-4444', link: 'https://filo.red/i/CCCC4444', used: 0, max: 3, uses: [], revoked: false },
];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'r', expiresIn: '3600', localId: 'u1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'r', expires_in: '3600', user_id: 'u1' });
      if (url === '/walletState') {
        return json(res, 200, {
          result: {
            hasWallet: redeemed, pseudonym: 'abcdef0123456789',
            balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.19, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: INVITES,
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      json(res, 404, { error: { message: 'no ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('scatto inviti chiaro e scuro', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await page.setViewportSize({ width: 1100, height: 900 }).catch(() => {});
  for (const t of ['light', 'dark']) {
    await app.evaluate(async ({}, th) => {
      const s = (await globalThis.__filoStorage.get('settings')).settings || {};
      await globalThis.__filoStorage.set({ settings: { ...s, theme: th } });
    }, t);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('invitesSection').hidden, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `crediti-inviti-${t}.png`), fullPage: true });
  }
});
