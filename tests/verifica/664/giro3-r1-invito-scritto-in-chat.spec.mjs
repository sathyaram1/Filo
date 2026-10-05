import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText } from '../../helpers/confirm.mjs';

const T_CAMPO = 'nel campo va bene il link intero, e gli inviti si danno come link';
const T_PRIMO_AVVIO = 'al primo avvio l\'invito che aspettava si riscatta da solo, e lo dicono home e Crediti';
const T_MUTO = 'se il server non risponde l\'avvio non si ferma, e nessun invito viene dato per riscattato';
const T_DEEP_LINK = 'filo://invito riscatta e porta davanti Crediti; ogni altro filo:// non fa niente';
const T_CLIC_DENTRO = 'dentro Filo il pulsante della pagina dell’invito riscatta, e la pagina resta; una pagina che lo spinge da sola no';
const T_TASTO_DESTRO = 'tasto destro su un link d’invito: «Riscatta l’invito» lo porta dentro Filo';
const T_BENVENUTO_UNA_VOLTA = 'con più schede nuove aperte il benvenuto compare in una sola, quella che guardi';
const T_SALUTO = 'un saluto che sembra un codice non si mangia il codice, nei Crediti e con /invito';
const T_RIMBALZO = 'un collegamento cliccato che rimbalza su filo://invito riscatta, anche in una scheda nuova che poi non resta bianca';
const T_ALTRE_PORTE = 'filo://invito fuori dal clic sul link non cade in silenzio: «Apri in nuova tab», pulsante da script, barra';

let server;
const seen = { redeems: [], pendings: 0 };
let redeemed = false;
let pending = null;      // { status:'ok', code } oppure null → { status:'none' }
let pendingDown = false; // il server non risponde a walletPendingInvite

const INVITES = [
  // Due entrati su tre: c'è ancora posto, e si vede chi è entrato.
  {
    code: 'AAAA-2222', link: 'https://filo.red/i/AAAA2222', used: 2, max: 3, revoked: false,
    uses: [
      { pseudonym: '1111aaaa2222bbbb', at: '2026-09-10T09:00:00.000Z' },
      { pseudonym: '3333cccc4444dddd', at: '2026-09-12T18:30:00.000Z' },
    ],
  },
  // Pieno: non fa entrare più nessuno.
  {
    code: 'BBBB-3333', link: 'https://filo.red/i/BBBB3333', used: 3, max: 3, revoked: false,
    uses: [{ pseudonym: '5555eeee6666ffff', at: null }, { pseudonym: '7777aaaa8888bbbb', at: null }, { pseudonym: '9999cccc2222dddd', at: null }],
  },
  // Nuovo di zecca.
  { code: 'CCCC-4444', link: 'https://filo.red/i/CCCC4444', used: 0, max: 3, uses: [], revoked: false },
];

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }

      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      }
      // Un collegamento tracciato o una pagina che passa dal server prima di rimandare all'invito.
      if (url === '/redir') { res.writeHead(302, { Location: 'filo://invito/ABCD-EFGH' }); return res.end(); }
      if ((req.headers.authorization || '') !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });

      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: INVITES,
          },
        });
      }
      if (url === '/walletPendingInvite') {
        seen.pendings += 1;
        if (pendingDown) { res.destroy(); return; }
        return json(res, 200, { result: pending || { status: 'none' } });
      }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        seen.redeems.push(code);
        if (code !== 'ABCDEFGH') return json(res, 200, { result: { status: 'invalid_code' } });
        redeemed = true;
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
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(({}, testInfo) => {
  seen.redeems.length = 0;
  seen.pendings = 0;
  redeemed = false;
  pending = testInfo.title === T_PRIMO_AVVIO ? { status: 'ok', code: 'ABCD-EFGH' } : null;
  pendingDown = testInfo.title === T_MUTO;
});


async function attendiPagina(app, host, tetto = 15000) {
  const scadenza = Date.now() + tetto;
  for (;;) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) return p;
    if (Date.now() > scadenza) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}
function schedeNuove(app) {
  return app.windows().filter((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
}

// Il primo posto dove un utente senza crediti mette l'invito è la chat della home: il codice o il link scritti lì portano l'invito dentro.
async function scriviInChat(home, testo) {
  await home.fill('#input', testo);
  await home.press('#input', 'Enter');
  const bottone = home.locator('#bubbles .dash-bubble-filo').last().locator('button', { hasText: /Riscatta/ });
  if (await bottone.count().then((n) => n > 0, () => false)) await bottone.first().click();
}

test('il messaggio dell’invito scritto nella chat della home riscatta, senza ricopiarlo nei Crediti', async ({ openTab }) => {
  test.setTimeout(120000);
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#input');
  await scriviInChat(home, 'Cara Sara, ecco il codice: ABCD-EFGH');
  await new Promise((r) => setTimeout(r, 1500));
  await scriviInChat(home, 'Cara Sara, ecco il codice: ABCD-EFGH');
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il codice scritto in chat arriva al server' }).toContain('ABCDEFGH');
});

test('il link d’invito incollato nella chat della home riscatta', async ({ openTab }) => {
  test.setTimeout(120000);
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#input');
  await scriviInChat(home, 'https://filo.red/i/ABCD-EFGH');
  await new Promise((r) => setTimeout(r, 1500));
  await scriviInChat(home, 'https://filo.red/i/ABCD-EFGH');
  await expect.poll(() => seen.redeems, { timeout: 15000, message: 'il link scritto in chat arriva al server' }).toContain('ABCDEFGH');
});
