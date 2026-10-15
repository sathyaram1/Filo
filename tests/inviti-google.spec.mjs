// #1120 — gli inviti si danno solo col portafoglio collegato a Google, e dalla stessa rete entra un numero limitato
// di persone. Qui la parte dell'app: la pagina Crediti al posto dei codici offre l'accesso Google, e i due rifiuti
// nuovi del riscatto si spiegano (il quarto della stessa rete sa da che ora riprovare, anche al primo avvio).
// Server e identità sono simulati come in wallet-credits.spec.mjs; l'accesso Google vero non si simula
// (auth-pkce.spec.mjs): la risposta di auth_signin la decide il test.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const T_PRIMO_AVVIO = 'al primo avvio, il quarto della stessa rete trova scritto da che ora riprovare';

let server;
let bloccato = true; // il server dice invitesLocked: 'need_google'
let conPortafoglio = true;
let pending = null;
let riscatto = null; // la risposta di walletRedeem
const seen = { redeems: [] };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const RIAPRE = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

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
        if (!conPortafoglio) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100,
            canInvite: !bloccato, invitesLocked: bloccato ? 'need_google' : null,
            // Codici di prima del #1120: il server li ha ancora, ma senza Google non fanno entrare nessuno.
            invites: bloccato
              ? [{ code: 'AAAA-2222', used: 0, max: 3 }]
              : [{ code: 'AAAA-2222', used: 0, max: 3 }, { code: 'BBBB-3333', used: 0, max: 3 }, { code: 'CCCC-4444', used: 0, max: 3 }],
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: pending || { status: 'none' } });
      if (url === '/walletRedeem') {
        seen.redeems.push(String((body.data && body.data.code) || ''));
        return json(res, 200, { result: riscatto || { status: 'invalid_code' } });
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
  bloccato = true;
  conPortafoglio = !/riscatto|primo avvio/.test(testInfo.title);
  pending = testInfo.title === T_PRIMO_AVVIO ? { status: 'ok', code: 'ABCD-EFGH' } : null;
  riscatto = testInfo.title === T_PRIMO_AVVIO ? { status: 'network_cap', reopensAt: RIAPRE() } : null;
  seen.redeems.length = 0;
});

// Ogni auth_signin resta in sospeso finché il test non lo chiude con __chiudiAccesso(esito). `altrove`: da lì in poi
// lo stato del portafoglio dice che l'accesso Google è su un'altra identità.
async function dirottaAccesso(page) {
  await page.evaluate(() => {
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__accessi = [];
    window.__altrove = false;
    window.__chiudiAccesso = (esito) => window.__accessi[window.__accessi.length - 1](esito);
    chrome.runtime.sendMessage = (msg, ...resto) => {
      if (msg && msg.type === 'auth_signin') return new Promise((r) => window.__accessi.push(r));
      if (msg && msg.type === 'wallet_state' && window.__altrove) {
        return vero(msg, ...resto).then((w) => ({ ...w, google: { signedIn: true, linkedHere: false } }));
      }
      return vero(msg, ...resto);
    };
  });
}

test('un portafoglio senza Google vede «Collega Google» al posto dei codici; fatto l\'accesso, i codici compaiono', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const bottone = page.locator('#linkGoogleBtn');
  await expect(bottone).toBeVisible({ timeout: 15_000 });
  await expect(bottone).toHaveText('Collega Google per dare i tuoi inviti');
  await expect(page.locator('#invitesSection h2')).toHaveText('I tuoi inviti');
  // I codici vecchi non si mostrano: chi li ricevesse si sentirebbe dire che non valgono.
  await expect(page.locator('#invites .sn-wallet-invite')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('AAAA-2222');
  await expect(page.locator('#invitesLockedText')).toBeHidden();
  // Il main dice alla pagina che l'accesso Google non c'è.
  const w = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wallet_state' }));
  expect(w.google).toEqual({ signedIn: false, linkedHere: null });

  await dirottaAccesso(page);
  await bottone.click();
  await expect.poll(() => page.evaluate(() => window.__accessi.length)).toBe(1);
  await expect(page.locator('#linkGoogleMsg')).toHaveText('Completa l’accesso a Google, poi i tuoi inviti compaiono qui.');
  await expect(bottone).toBeDisabled();
  // Un secondo clic mentre l'accesso è aperto non ne apre un altro.
  await bottone.click({ force: true });
  expect(await page.evaluate(() => window.__accessi.length)).toBe(1);

  // L'accesso riesce e il server, vista l'identità collegata, consegna i codici.
  bloccato = false;
  await page.evaluate(() => window.__chiudiAccesso({ ok: true, profile: { email: 'io@example.com' } }));
  await expect(page.locator('#invites .sn-wallet-invite')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.locator('#invitesLocked')).toBeHidden();
  await expect(page.locator('#invites .sn-wallet-code').first()).toHaveText('AAAA-2222');
});

test('l\'accesso Google non riuscito lo dice sotto il pulsante, e si può riprovare', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const bottone = page.locator('#linkGoogleBtn');
  await expect(bottone).toBeVisible({ timeout: 15_000 });
  await dirottaAccesso(page);
  await bottone.click();
  await expect.poll(() => page.evaluate(() => window.__accessi.length)).toBe(1);
  await page.evaluate(() => window.__chiudiAccesso({ ok: false, code: 'rete', error: 'Accesso non riuscito: manca la connessione. Riprova quando sei in rete.' }));
  const msg = page.locator('#linkGoogleMsg');
  await expect(msg).toHaveText('Accesso non riuscito: manca la connessione. Riprova quando sei in rete.');
  await expect(msg).toHaveClass(/is-error/);
  await expect(bottone).toBeEnabled();
  await bottone.click();
  await expect.poll(() => page.evaluate(() => window.__accessi.length)).toBe(2);
  await expect(msg).not.toHaveClass(/is-error/);
});

test('con l\'account Google già legato a un\'altra copia di Filo, la pagina lo dice invece di riproporre lo stesso accesso', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const bottone = page.locator('#linkGoogleBtn');
  await expect(bottone).toBeVisible({ timeout: 15_000 });
  await dirottaAccesso(page);
  await bottone.click();
  await expect.poll(() => page.evaluate(() => window.__accessi.length)).toBe(1);
  // L'accesso riesce, ma Google era già legato altrove: il server resta chiuso.
  await page.evaluate(() => { window.__altrove = true; window.__chiudiAccesso({ ok: true }); });
  await expect(page.locator('#invitesLockedText')).toHaveText('Il tuo account Google è già legato a un’altra copia di Filo, per esempio su un altro computer. Per dare inviti da qui serve un altro account Google.', { timeout: 15_000 });
  await expect(bottone).toHaveText('Collega un altro account Google');
  await expect(page.locator('#invites .sn-wallet-invite')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/inviti-google-altrove.png', fullPage: true });
});

test('un accesso fatto da un\'altra parte sblocca gli inviti anche a pagina aperta', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#linkGoogleBtn')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/inviti-google-chiusi.png', fullPage: true });
  bloccato = false;
  // L'avviso che il main manda alle pagine di Filo a ogni accesso (menu dell'account, bacheca…).
  await page.evaluate(() => { for (const l of chrome.runtime.onMessage._listeners) l({ type: 'auth_changed', signedIn: true }); });
  await expect(page.locator('#invites .sn-wallet-invite')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.locator('#invitesLocked')).toBeHidden();
});

test('i due rifiuti nuovi del riscatto si spiegano: invito di chi non ha Google, e rete piena con l\'ora', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
  const msg = page.locator('#redeemMsg');

  riscatto = { status: 'inviter_not_linked' };
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(msg).toHaveText('Questo invito non vale ancora. Chi te l’ha dato deve prima collegare Google a Filo dalla sua pagina Crediti. Chiediglielo, o fatti mandare un altro invito.');
  await expect(msg).toHaveClass(/is-error/);

  const riapre = RIAPRE();
  riscatto = { status: 'network_cap', reopensAt: riapre };
  await page.click('#redeemBtn');
  const ora = await page.evaluate((iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), riapre);
  await expect(msg).toHaveText(new RegExp(`^Da questa rete sono già entrate troppe persone con un invito\\. Il codice resta valido, riprova (domani )?dopo le ${ora}\\.$`));
  expect(seen.redeems).toEqual(['ABCDEFGH', 'ABCDEFGH']);
  // Il campo resta lì col codice: chi riprova più tardi non lo deve ricopiare.
  await expect(page.locator('#inviteCode')).toHaveValue('ABCD-EFGH');
});

test(T_PRIMO_AVVIO, async ({ openTab }) => {
  await expect.poll(() => seen.redeems, { timeout: 40_000 }).toEqual(['ABCDEFGH']);
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#walletNote')).toContainText('Da questa rete sono già entrate troppe persone con un invito. Il codice resta valido, riprova', { timeout: 15_000 });
  await expect(page.locator('#walletNote')).toContainText(/riprova (domani )?dopo le \d\d:\d\d\./);
  await expect(page.locator('#redeemForm')).toBeVisible();
});
