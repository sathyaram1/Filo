// #1120 — dà inviti solo chi ha collegato Google: la pagina Crediti, senza collegamento, mostra «Collega Google per
// dare i tuoi inviti» al posto dei codici, e i rifiuti nuovi del riscatto (inviter_not_linked, network_cap) arrivano
// all'utente con la loro frase. Server e identità simulati come in wallet-credits.spec.mjs.

import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText } from './helpers/confirm.mjs';

let server;
let redeemed = false;
let linked = false;
let rifiuto = null;
let inAttesa = null;
let giaUsato = false;
const CODICI = ['AAAA-2222', 'BBBB-3333', 'CCCC-4444'];

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if ((req.headers.authorization || '') !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, grants: [],
            canInvite: linked && !giaUsato, invitesLocked: giaUsato ? 'google_used' : (linked ? null : 'need_google'),
            invites: linked && !giaUsato ? CODICI.map((code) => ({ code, used: 0, max: 3, uses: [] })) : [],
          },
        });
      }
      if (url === '/walletRedeem') {
        if (rifiuto) return json(res, 200, { result: rifiuto });
        const code = String((body.data && body.data.code) || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (code !== 'ABCDEFGH') return json(res, 200, { result: { status: 'invalid_code' } });
        redeemed = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000,
            migrated: 0, localRequested: 0, cutReason: null,
            inviteCodes: linked ? CODICI : [], invitesLocked: linked ? null : 'need_google',
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: inAttesa || { status: 'none' } });
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

const T_ATTESA_RETE = 'primo avvio dal link: se dalla connessione sono già entrati in tre, la home dice perché e quando riprovare';
const T_ATTESA_SENZA_GOOGLE = 'primo avvio dal link senza Google: il benvenuto non promette inviti da dare e dice dove collegarlo';

test.beforeEach(({}, testInfo) => {
  redeemed = false; linked = false; rifiuto = null; inAttesa = null; giaUsato = false;
  // L'invito in attesa si chiede all'avvio: va pronto prima che la fixture lanci Filo.
  if (testInfo.title === T_ATTESA_RETE || testInfo.title === T_ATTESA_SENZA_GOOGLE) inAttesa = { status: 'ok', code: 'ABCD-EFGH' };
  if (testInfo.title === T_ATTESA_RETE) rifiuto = { status: 'network_cap', reopensAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), cap: 3, hours: 24 };
});

async function home(app) {
  const scadenza = Date.now() + 15000;
  for (;;) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
    if (p || Date.now() > scadenza) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

// L'accesso a Google resta in sospeso finché il test non lo chiude con __chiudiAccesso(esito); un esito ok fa
// risultare dentro anche la lettura dei crediti, come fa il main vero dopo un accesso.
async function accessoFinto(page) {
  await page.evaluate(() => {
    const real = window.filo.message.bind(window.filo);
    const MSG = window.SN_MSG.MSG;
    let dentro = false;
    window.__accessi = [];
    window.__chiudiAccesso = (esito) => {
      if (esito && esito.ok) dentro = true;
      window.__accessi[window.__accessi.length - 1].resolve(esito);
    };
    window.filo.message = (msg) => {
      if (msg.type === MSG.AUTH_SIGNIN) return new Promise((resolve) => window.__accessi.push({ resolve }));
      if (msg.type === MSG.GET_CREDITS) return Promise.resolve(real(msg)).then((r) => ({ ...(r || {}), signedIn: dentro }));
      return real(msg);
    };
  });
}

async function entra(page) {
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
}

function scatto(page, nome) {
  const dir = path.join(process.cwd(), 'tests', '.shots');
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: path.join(dir, `${nome}.png`) });
}

test('senza Google collegato i codici non ci sono: c\'è «Collega Google», e collegato compaiono i tre codici', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await entra(page);

  const sezione = page.locator('#invitesSection');
  const collega = page.locator('#linkGoogleBtn');
  await expect(sezione).toBeVisible();
  await expect(collega).toHaveText('Collega Google per dare i tuoi inviti');
  await expect(page.locator('#invites li')).toHaveCount(0);
  await expect(page.locator('#invitesLockedNote')).toBeHidden();
  await scatto(page, 'inviti-google-scollegato');

  await accessoFinto(page);
  await collega.click();
  await expect(collega).toBeDisabled();
  await expect(collega).toContainText('Continua nella scheda di Google');
  await page.waitForFunction(() => window.__accessi.length === 1);

  linked = true;
  await page.evaluate(() => window.__chiudiAccesso({ ok: true, profile: { email: 'io@example.com' } }));
  const codici = page.locator('#invites li');
  await expect(codici).toHaveCount(3, { timeout: 10000 });
  await expect(codici.nth(0).locator('.sn-wallet-code')).toHaveText('AAAA-2222');
  await expect(page.locator('#invitesLocked')).toBeHidden();
});

test('accesso fatto ma account Google legato a un\'altra copia di Filo: la pagina lo dice e propone di riprovare', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await entra(page);
  await accessoFinto(page);

  const collega = page.locator('#linkGoogleBtn');
  const nota = page.locator('#invitesLockedNote');
  // Un accesso non riuscito si dice con la frase del main, e il pulsante torna.
  await collega.click();
  await page.waitForFunction(() => window.__accessi.length === 1);
  await page.evaluate(() => window.__chiudiAccesso({ ok: false, code: 'annullato', error: 'Hai chiuso la pagina di Google prima di finire.' }));
  await expect(nota).toHaveText('Hai chiuso la pagina di Google prima di finire.');
  await expect(collega).toBeEnabled();
  await expect(collega).toHaveText('Collega Google per dare i tuoi inviti');

  // Dentro con Google, ma il server dice ancora need_google.
  await collega.click();
  await page.waitForFunction(() => window.__accessi.length === 2);
  await page.evaluate(() => window.__chiudiAccesso({ ok: true, profile: { email: 'io@example.com' } }));
  await expect(nota).toContainText('già legato a un’altra copia di Filo', { timeout: 10000 });
  await expect(collega).toHaveText('Riprova a collegare Google');
  await expect(page.locator('#invites li')).toHaveCount(0);
  await scatto(page, 'inviti-google-legato-altrove');
});

test('account Google che ha già dato i suoi inviti da un\'altra copia di Filo: niente codici, niente pulsante, e la pagina dice perché', async ({ openTab }) => {
  linked = true; giaUsato = true;
  const page = await openTab('filo://credits/credits.html');
  await entra(page);
  await expect(page.locator('#invitesSection')).toBeVisible();
  await expect(page.locator('#invitesLockedNote')).toHaveText('Il tuo account Google ha già dato i suoi inviti da un’altra copia di Filo: si danno da quella.');
  await expect(page.locator('#linkGoogleBtn')).toBeHidden();
  await expect(page.locator('#invites li')).toHaveCount(0);
  await scatto(page, 'inviti-google-gia-usato');
});

test('i rifiuti nuovi del riscatto si spiegano: invito di chi non ha Google, troppe entrate dalla stessa connessione con l\'ora', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  const msg = page.locator('#redeemMsg');

  rifiuto = { status: 'inviter_not_linked' };
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(msg).toContainText('non ha ancora collegato il suo account Google');
  await expect(msg).toHaveClass(/is-error/);

  const riapre = new Date(Date.now() + 2 * 60 * 60 * 1000);
  rifiuto = { status: 'network_cap', reopensAt: riapre.toISOString(), cap: 3, hours: 24 };
  await page.click('#redeemBtn');
  await expect(msg).toContainText('Da questa connessione sono già entrate 3 persone nelle ultime 24 ore');
  const ora = await page.evaluate((iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), riapre.toISOString());
  await expect(msg).toContainText(ora);
  await expect(msg).toContainText('Il tuo codice resta valido');
  await expect(page.locator('#redeemForm')).toBeVisible();
});

test(T_ATTESA_RETE, async ({ app, openTab }) => {
  const h = await home(app);
  expect(h, 'la home è aperta all\'avvio').toBeTruthy();
  await expect(h.locator(CONFIRM_HOST)).toBeVisible({ timeout: 40000 });
  const detto = await confirmText(h);
  expect(detto).toContain('Da questa connessione sono già entrate 3 persone nelle ultime 24 ore');
  expect(detto).toContain('Il tuo codice resta valido');
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
});

test(T_ATTESA_SENZA_GOOGLE, async ({ app }) => {
  const h = await home(app);
  expect(h, 'la home è aperta all\'avvio').toBeTruthy();
  await expect(h.locator(CONFIRM_HOST)).toBeVisible({ timeout: 40000 });
  const detto = await confirmText(h);
  expect(detto).toContain('Sei entrato con un invito');
  expect(detto).toContain('colleghi Google per avere anche inviti da dare');
  expect(detto).not.toContain('insieme ai tuoi inviti da dare');
});
