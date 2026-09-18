// Il link d'invito (#651): un invito si dà come link, vale per più persone, e
// chi lo riceve non deve ricopiare niente.
//
//   - nel campo della pagina Crediti va bene il link intero, non solo il codice;
//   - gli inviti si vedono come link da dare, con quanti sono entrati su
//     quanti posti e chi;
//   - al primo avvio dopo aver scaricato Filo dalla pagina dell'invito, il
//     server dice qual è l'invito che aspetta questa installazione e Filo lo
//     riscatta da solo;
//   - un server che non risponde non ferma niente;
//   - `filo://invito/<codice>` riscatta e porta davanti la pagina Crediti,
//     mentre ogni ALTRO `filo://…` (che il sistema consegna comunque, una
//     volta che Filo è il gestore del protocollo) non fa niente.
//
// Server e identità Firebase sono simulati da un HTTP locale, come in
// tests/wallet-credits.spec.mjs: gli endpoint si spostano con
// FILO_FUNCTIONS_BASE / FILO_IDENTITY_ENDPOINT / FILO_SECURE_TOKEN_ENDPOINT,
// scritti in process.env PRIMA che la fixture lanci Electron.
//
// Le risposte del finto server si scelgono in `beforeEach`, per TITOLO della
// prova: l'invito in attesa si chiede quattro secondi dopo l'avvio, e la
// fixture lancia Electron prima che il corpo della prova cominci.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText } from './helpers/confirm.mjs';

const T_CAMPO = 'nel campo va bene il link intero, e gli inviti si danno come link';
const T_PRIMO_AVVIO = 'al primo avvio l\'invito che aspettava si riscatta da solo, e lo dicono home e Crediti';
const T_MUTO = 'se il server non risponde l\'avvio non si ferma, e nessun invito viene dato per riscattato';
const T_DEEP_LINK = 'filo://invito riscatta e porta davanti Crediti; ogni altro filo:// non fa niente';

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

// La pagina aperta su un certo host, aspettandola: openTab non serve quando è
// Filo ad aprire la scheda.
async function attendiPagina(app, host, tetto = 15000) {
  const scadenza = Date.now() + tetto;
  for (;;) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) return p;
    if (Date.now() > scadenza) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

test(T_CAMPO, async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });

  // Un testo che non è un invito: la frase dice cos'è un invito, e non si
  // spreca un giro dal server per scoprirlo.
  await page.fill('#inviteCode', 'ciao come stai');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('otto caratteri');
  expect(seen.redeems, 'un testo qualsiasi non arriva al server').toEqual([]);

  // Il link intero, copiato dalla barra degli indirizzi con lo slash finale.
  await page.fill('#inviteCode', 'https://filo.red/i/abcdefgh/');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  expect(seen.redeems, 'al server arriva il codice, non il link').toEqual(['ABCDEFGH']);

  // ── Gli inviti: link da dare, posti, e chi è entrato ──────────────────────
  const invites = page.locator('#invites li.sn-wallet-invite');
  await expect(invites).toHaveCount(3);

  const primo = invites.nth(0);
  await expect(primo.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222');
  await expect(primo.locator('.sn-wallet-code')).toHaveText('AAAA-2222');
  await expect(primo.locator('.sn-wallet-invite-state')).toHaveText('entrati 2 su 3');
  await expect(primo.locator('.sn-wallet-invite-uses li')).toHaveCount(2);
  await expect(primo.locator('.sn-wallet-invite-uses')).toContainText('1111aaaa2222bbbb');
  await expect(primo.locator('.sn-wallet-invite-uses')).toContainText('3333cccc4444dddd');

  // Il link si copia con un clic: negli appunti ci finisce il link intero, e
  // l'utente vede che è successo.
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await primo.locator('.sn-wallet-invite-link').click();
  await expect(primo.locator('.sn-wallet-invite-link')).toHaveText('Copiato');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://filo.red/i/AAAA2222');
  await expect(primo.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222', { timeout: 5000 });

  // Anche il codice da dettare a voce, per chi preferisce.
  await primo.locator('.sn-wallet-code').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('AAAA-2222');

  // Un invito pieno si vede, e non si dà più: né il link né il codice.
  const pieno = invites.nth(1);
  await expect(pieno).toHaveClass(/is-used/);
  await expect(pieno.locator('.sn-wallet-invite-state')).toHaveText('entrati 3 su 3');
  await expect(pieno.locator('.sn-wallet-invite-link')).toBeDisabled();
  await expect(pieno.locator('.sn-wallet-code')).toBeDisabled();

  // Uno nuovo: nessuno dentro, nessuna riga di chi è entrato.
  const nuovo = invites.nth(2);
  await expect(nuovo.locator('.sn-wallet-invite-state')).toHaveText('entrati 0 su 3');
  await expect(nuovo).not.toHaveClass(/is-used/);
  await expect(nuovo.locator('.sn-wallet-invite-uses li')).toHaveCount(0);
});

test(T_PRIMO_AVVIO, async ({ app, openTab }) => {
  // La home è la scheda che l'utente sta già guardando: l'avviso arriva lì.
  const home = await attendiPagina(app, 'newtab');
  expect(home, 'la home è aperta all\'avvio').toBeTruthy();

  // Nessuno ha chiesto niente: il riscatto parte da sé, poco dopo l'avvio.
  await expect.poll(() => seen.redeems, { timeout: 40000 }).toEqual(['ABCDEFGH']);

  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
  const detto = await confirmText(home);
  expect(detto).toContain('Sei entrato con un invito');
  expect(detto).toContain('5.000 crediti');

  // E la pagina Crediti lo dice a sua volta, col saldo vero del server.
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#walletNote')).toContainText('Sei entrato con un invito', { timeout: 15000 });
  await expect(page.locator('#balance')).toHaveText('4.990');
  await expect(page.locator('#redeemForm')).toBeHidden();

  // Detto una volta: chi riapre Crediti non se lo ritrova addosso per sempre.
  await page.reload();
  await expect(page.locator('#balance')).toHaveText('4.990', { timeout: 15000 });
  await expect(page.locator('#walletNote')).not.toContainText('Sei entrato con un invito');
});

test(T_MUTO, async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  // Filo parte, la pagina risponde, e resta quello che un utente senza
  // portafoglio deve vedere: il campo dell'invito.
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => seen.pendings, { timeout: 40000 }).toBeGreaterThan(0);
  expect(seen.redeems, 'senza risposta non si riscatta niente').toEqual([]);
  await expect(page.locator('#walletNote')).not.toContainText('Sei entrato');
  await expect(page.locator('body')).not.toContainText('fetch failed');
});

test(T_DEEP_LINK, async ({ app }) => {
  // Il sistema consegna QUALUNQUE filo:// una volta che Filo è il gestore del
  // protocollo: una pagina interna messa in un link da un sito qualsiasi non
  // deve aprirsi né fare niente. Prima si prova quella.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://credits/credits.html', '.'], process.cwd()); });
  await new Promise((r) => setTimeout(r, 2000));
  expect(seen.redeems, 'un filo:// che non è un invito non riscatta niente').toEqual([]);
  expect(await attendiPagina(app, 'credits', 0), 'e non apre la pagina che nomina').toBeNull();

  // L'invito vero, come arriva su Windows e Linux: fra gli argomenti della
  // seconda istanza, in una posizione qualsiasi.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/abcd-efgh', '.'], process.cwd()); });
  await expect.poll(() => seen.redeems, { timeout: 20000 }).toEqual(['ABCDEFGH']);

  // Filo porta davanti la pagina dove l'esito si legge.
  const credits = await attendiPagina(app, 'credits');
  expect(credits, 'il link apre la pagina Crediti').toBeTruthy();
  await expect(credits.locator('#walletNote')).toContainText('Sei entrato con un invito', { timeout: 15000 });
  await expect(credits.locator('#balance')).toHaveText('4.990', { timeout: 15000 });

  // Lo stesso link una seconda volta, con il portafoglio già qui: lo dice,
  // invece di riprovare un riscatto che non può riuscire.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCDEFGH'], process.cwd()); });
  await expect(credits.locator('#walletNote')).toContainText('darlo a qualcun altro', { timeout: 15000 });
  expect(seen.redeems, 'chi ha già il portafoglio non consuma un invito').toEqual(['ABCDEFGH']);

  // E su Mac lo stesso indirizzo arriva con open-url: stessa strada, stesso esito.
  const macOk = await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCDEFGH'));
  expect(macOk, 'open-url ha un ascoltatore: su Mac il link arriva solo da lì').toBe(true);
});
