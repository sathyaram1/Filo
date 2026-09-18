// Giro di verifica locale del ramo claude/link-invito — giro 1.
//
// Due strade per lo stesso invito, provate dentro Filo:
//   · il LINK INTERO incollato nel campo dell'invito (chi riceve il messaggio
//     copia tutto, non solo le otto lettere);
//   · il COLLEGAMENTO aperto da fuori mentre Filo è già acceso.
// Più gli abusi: campo vuoto, soli spazi, diecimila caratteri, uno script,
// due clic di fila, e una pagina qualsiasi che prova a far aprire a Filo una
// cosa che non è un invito.
//
// Server finto: un codice vero è a usi contati e una prova non ne brucia uno.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let visto = { redeems: [], pending: 0 };
let riscattato = false;
let invitoInAttesa = null; // in questo file l'invito NON arriva da solo

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
      if (url === '/walletPendingInvite') {
        visto.pending += 1;
        return json(res, 200, { result: invitoInAttesa ? { status: 'ok', code: invitoInAttesa } : { status: 'none' } });
      }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== 'ABCDEFGH') return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 },
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

test.beforeEach(() => { visto = { redeems: [], pending: 0 }; riscattato = false; invitoInAttesa = null; });

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('nel campo dell’invito si incolla il link intero, com’è arrivato nel messaggio', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });

  await page.fill('#inviteCode', 'Ciao! Entra su Filo: https://filo.red/i/ABCD-EFGH — ci vediamo');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });

  // Al server è arrivato il codice nudo, non la frase.
  expect(visto.redeems).toContain('ABCDEFGH');
  await expect(page.locator('#balance')).toHaveText('5.000');
  // E l'invito da dare è a sua volta un link, pronto da copiare.
  await expect(page.locator('#invites > li').first().locator('.sn-wallet-invite-link'))
    .toHaveText('https://filo.red/i/AAAA2222');
});

test('il campo dell’invito regge gli abusi: vuoto, spazi, diecimila caratteri, uno script, due clic', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });

  // Vuoto: non parte niente e il campo riprende il fuoco.
  await page.fill('#inviteCode', '');
  await page.click('#redeemBtn');
  await page.waitForTimeout(500);
  expect(visto.redeems.length).toBe(0);

  // Soli spazi: idem, nessuna chiamata sprecata.
  await page.fill('#inviteCode', '     ');
  await page.click('#redeemBtn');
  await page.waitForTimeout(500);
  expect(visto.redeems.length).toBe(0);

  // Diecimila caratteri: rifiuto spiegato, niente taglio silenzioso, niente
  // chiamata al server.
  await page.fill('#inviteCode', 'x'.repeat(10000));
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('non è un codice', { timeout: 15000 });
  expect(visto.redeems.length).toBe(0);

  // Uno script: rifiutato come testo, e niente finisce nella pagina.
  await page.fill('#inviteCode', '<img src=x onerror="document.title=\'bucato\'">');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('non è un codice', { timeout: 15000 });
  expect(await page.title()).not.toBe('bucato');
  expect(await page.locator('#redeemMsg').evaluate((e) => e.querySelectorAll('img').length)).toBe(0);

  // Un codice che non esiste: lo dice il server, e si resta lì.
  await page.fill('#inviteCode', 'ZZZZ-9999');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('non esiste', { timeout: 15000 });

  // Due clic di fila sul codice buono: un solo riscatto.
  visto.redeems = [];
  await page.fill('#inviteCode', 'https://filo.red/i/ABCDEFGH');
  // Due clic davvero attaccati, prima che la risposta arrivi.
  await page.evaluate(() => { const b = document.getElementById('redeemBtn'); b.click(); b.click(); b.click(); });
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(visto.redeems.filter((c) => c === 'ABCDEFGH').length, 'due clic non devono valere due riscatti').toBe(1);
});

test('il collegamento aperto da fuori mentre Filo è acceso porta dentro l’invito; un filo:// qualsiasi no', async ({ app, shell }) => {
  // Prima: una pagina web qualsiasi può scrivere un `filo://…`. Quello che non
  // è un invito non deve aprire NIENTE.
  const primaTab = app.windows().length;
  await app.evaluate(({ app: a }, argv) => { a.emit('second-instance', {}, argv); }, ['electron.exe', '.', 'filo://manage/manage.html']);
  await new Promise((r) => setTimeout(r, 2500));
  const apertaGestione = app.windows().some((w) => { try { return new URL(w.url()).hostname === 'manage'; } catch (_) { return false; } });
  expect(apertaGestione, 'un filo:// scritto da una pagina qualsiasi non deve aprire pagine di Filo').toBe(false);
  expect(visto.redeems.length).toBe(0);

  // Poi l'invito vero: riscattato, e la pagina Crediti viene davanti a
  // raccontarlo.
  await app.evaluate(({ app: a }, argv) => { a.emit('second-instance', {}, argv); }, ['electron.exe', '.', 'filo://invito/ABCD-EFGH']);
  await expect.poll(() => visto.redeems.length, { timeout: 30000, intervals: [400] }).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe('ABCDEFGH');

  let crediti = null;
  const scadenza = Date.now() + 20000;
  while (Date.now() < scadenza && !crediti) {
    crediti = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'credits'; } catch (_) { return false; } }) || null;
    if (!crediti) await new Promise((r) => setTimeout(r, 200));
  }
  expect(crediti, 'la pagina Crediti non si è aperta dopo il collegamento').toBeTruthy();
  await expect(crediti.locator('#balance')).toHaveText('5.000', { timeout: 20000 });
  expect(primaTab).toBeGreaterThan(0);
});

test('un invito che arriva quando i crediti ci sono già lo dice, invece di tacere', async ({ app, openTab }) => {
  // Prima si entra normalmente.
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });

  // Poi arriva un secondo collegamento: non c'è niente da riscattare, e
  // sentirselo dire è meglio di un silenzio.
  visto.redeems = [];
  await app.evaluate(({ app: a }, argv) => { a.emit('second-instance', {}, argv); }, ['electron.exe', '.', 'filo://invito/ABCDEFGH']);
  await expect(page.locator('#walletNote')).toContainText('Hai già i crediti di Filo', { timeout: 20000 });
  expect(visto.redeems.length, 'un invito di troppo non deve essere speso').toBe(0);
});
