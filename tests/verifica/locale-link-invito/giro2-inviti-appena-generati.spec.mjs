// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// Il giro prima aveva bocciato la pagina di chi gestisce Filo perché gli
// inviti uscivano nudi: nessun link, nessun conteggio, e uno con un posto
// occupato su tre sembrava già speso. La correzione va ri-provata dove il
// primo giro non era arrivato: sui codici APPENA generati, che escono dalla
// risposta del server e non dalla lista riletta. E va confrontata con la
// pagina Crediti di un utente qualunque, perché lo stesso invito sulle due
// strade deve leggersi allo stesso modo.
//
// Server finto: i codici veri sono a usi contati.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;
let generati = 0;

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Gli inviti dell'utente qualunque: uno intatto, uno a metà, uno pieno, uno
// annullato. Gli stessi che il server manda a chi li ha generati.
const INVITI = [
  { code: 'BBBB3333', max: 3, used: 0, uses: [] },
  { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }] },
  { code: 'CCCC4444', max: 3, used: 3, uses: [] },
  { code: 'DDDD5555', max: 3, used: 0, uses: [], revoked: true },
];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') {
        const p = new URLSearchParams(raw);
        const rt = p.get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') {
        return json(res, 200, {
          result: {
            hasWallet: true,
            pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100,
            invites: INVITI,
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletOverview') {
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: 1, totalLimitUsd: 4.2, maxGrantUsd: 50 },
            ownerInvites: INVITI.map((i) => ({ ...i, createdAt: '2026-09-10T09:00:00.000Z' })),
            users: [{ pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z', usage: { rows: 0 } }],
          },
        });
      }
      if (url === '/walletCreateInvites') {
        const n = Math.max(1, Math.floor(Number((body.data && body.data.count) || 1)));
        generati += n;
        // Codici nuovi, dell'alfabeto giusto, mai visti prima nella lista.
        const codes = Array.from({ length: n }, (_, i) => `EEEE${String(6666 + i)}`.slice(0, 8));
        return json(res, 200, { result: { codes } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

async function simulaOwner(app) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    store.save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
}

test('i codici appena generati escono col loro link e col conteggio dei posti, come quelli riletti', async ({ app, openTab }) => {
  test.setTimeout(180000);
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab('filo://credits/owner.html');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 30000 });
  await expect(page.locator('#ownerCodes > li')).toHaveCount(INVITI.length, { timeout: 30000 });

  // Si generano due codici nuovi, come farebbe chi deve invitare due persone.
  await page.fill('#ownerInviteCount', '2');
  await page.click('#ownerInvitesBtn');
  await expect(page.locator('#ownerCodes > li')).toHaveCount(INVITI.length + 2, { timeout: 30000 });
  expect(generati).toBe(2);

  const nuovo = page.locator('#ownerCodes > li').first();
  // Quello che si dà a qualcuno è il link: senza, chi genera il codice deve
  // costruirsi l'indirizzo a mano.
  await expect(nuovo.locator('.sn-wallet-invite-link')).toHaveText(/^https:\/\/filo\.red\/i\/EEEE\d{4}$/);
  await expect(nuovo.locator('.sn-wallet-invite-link')).toBeEnabled();
  // E quanti posti ha: era la cosa chiesta, «chi l'ha generato vede quante
  // sono entrate». Un codice appena nato ne ha tre liberi.
  await expect(nuovo.locator('.sn-wallet-invite-state')).toHaveText('entrati 0 su 3');
  await expect(nuovo).not.toHaveClass(/is-used/);

  // Un invito annullato si deve riconoscere, e non si dà più a nessuno.
  const annullato = page.locator('#ownerCodes > li[data-code="DDDD-5555"], #ownerCodes > li[data-code="DDDD5555"]').first();
  await expect(annullato.locator('.sn-wallet-invite-state')).toHaveText('annullato');
});

test('lo stesso invito si legge allo stesso modo nella pagina Crediti e in quella di chi lo ha generato', async ({ app, openTab }) => {
  test.setTimeout(180000);
  expect(await simulaOwner(app)).toBe(true);

  const owner = await openTab('filo://credits/owner.html');
  await owner.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 30000 });
  await expect(owner.locator('#ownerCodes > li')).toHaveCount(INVITI.length, { timeout: 30000 });

  const crediti = await openTab('filo://credits/credits.html');
  await crediti.waitForFunction(() => { const s = document.getElementById('invitesSection'); return s && !s.hidden; }, null, { timeout: 30000 });
  await expect(crediti.locator('#invites > li')).toHaveCount(INVITI.length, { timeout: 30000 });

  const leggi = async (page, sel) => page.locator(sel).evaluateAll((lis) => lis.map((li) => ({
    link: (li.querySelector('.sn-wallet-invite-link') || {}).textContent || '',
    stato: (li.querySelector('.sn-wallet-invite-state') || {}).textContent || '',
    spento: (li.querySelector('.sn-wallet-invite-link') || {}).disabled === true,
  })).sort((a, b) => a.link.localeCompare(b.link)));

  expect(await leggi(owner, '#ownerCodes > li')).toEqual(await leggi(crediti, '#invites > li'));
});
