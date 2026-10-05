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
//     volta che Filo è il gestore del protocollo) non fa niente;
//   - dentro Filo (#664) il pulsante della pagina dell'invito e il tasto
//     destro sul link fanno lo stesso; il benvenuto lo racconta una scheda
//     sola; un saluto davanti al codice non lo nasconde.
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
const T_CLIC_DENTRO = 'dentro Filo il pulsante della pagina dell’invito riscatta, e la pagina resta; una pagina che lo spinge da sola no';
const T_TASTO_DESTRO = 'tasto destro su un link d’invito: «Riscatta l’invito» lo porta dentro Filo';
const T_BENVENUTO_UNA_VOLTA = 'con più schede nuove aperte il benvenuto compare in una sola, quella che guardi';
const T_SALUTO = 'un saluto che sembra un codice non si mangia il codice, nei Crediti e con /invito';

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

  // Due clic attaccati — quello che fa chiunque non sia sicuro che il primo
  // sia andato a segno — non devono lasciare «Copiato» al posto del link: la
  // riga restava così per sempre, e l'indirizzo da mandare non si rileggeva
  // più fino alla riapertura della pagina (terzo giro di verifica del #651).
  await primo.locator('.sn-wallet-invite-link').dblclick();
  await expect(primo.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222', { timeout: 10000 });
  await primo.locator('.sn-wallet-code').dblclick();
  await expect(primo.locator('.sn-wallet-code')).toHaveText('AAAA-2222', { timeout: 10000 });

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

  // Un invito col codice storto, invece, è stato CLICCATO da qualcuno: Filo
  // apre Crediti e dice cos'è andato storto, invece di non fare niente.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  const storto = await attendiPagina(app, 'credits');
  expect(storto, 'un invito storto porta comunque dove si legge il perché').toBeTruthy();
  await expect(storto.locator('#walletNote')).toContainText('otto caratteri', { timeout: 15000 });
  expect(seen.redeems, 'e non si spreca un giro dal server').toEqual([]);

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

// La pagina dell'invito com'è fatta: il codice a schermo e il pulsante che lo
// porta dentro Filo. Chi Filo ce l'ha già la apre anche DENTRO Filo, che è un
// browser (#664): lì il pulsante deve fare quello che fa da fuori.
const PAGINA_INVITO = `<!doctype html><html><head><meta charset="utf-8"><title>Il tuo invito a Filo</title></head>
<body style="font-family:sans-serif;padding:40px"><h1>Hai un invito</h1><p>Codice: ABCD-EFGH</p>
<p><a id="apri" href="filo://invito/ABCD-EFGH" style="display:inline-block;padding:16px 28px;background:#c66;color:#fff">Apri in Filo</a></p>
</body></html>`;

// Una pagina che spinge l'invito da sé, senza che nessuno clicchi: un clic
// finto, un rinvio, una finestra nuova.
const PAGINA_SPINGE = `<!doctype html><html><head><meta charset="utf-8"><title>spinge</title></head>
<body><h1>Una pagina qualsiasi</h1><a id="a" href="filo://invito/ABCD-EFGH">invito</a>
<script>setTimeout(function () {
  try { document.getElementById('a').click(); } catch (e) {}
  try { window.open('filo://invito/ABCD-EFGH', '_blank'); } catch (e) {}
  try { location.href = 'filo://invito/ABCD-EFGH'; } catch (e) {}
}, 300);</script></body></html>`;

test(T_CLIC_DENTRO, async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  // Su un altro host: openTab sceglie la scheda per host, e le due pagine non si devono confondere.
  const spinge = await testServer.openReady(openTab, PAGINA_SPINGE, { pubblico: true });
  await new Promise((r) => setTimeout(r, 3000));
  expect(seen.redeems, 'una pagina da sola non riscatta niente').toEqual([]);
  // Il contenuto si legge con evaluate: dopo una navigazione fermata i locator
  // di Playwright aspettano un caricamento che non arriva (succede anche col mailto:).
  expect(spinge.url()).toMatch(/^http:\/\/sito-pubblico\.test:/);
  expect(await spinge.evaluate(() => document.querySelector('h1').textContent), 'la scheda non finisce su un indirizzo che non esiste')
    .toBe('Una pagina qualsiasi');
  expect(await attendiPagina(app, 'invito', 0), 'nessuna scheda su filo://invito').toBeNull();

  const pagina = await testServer.openReady(openTab, PAGINA_INVITO);
  const indirizzo = pagina.url();
  // Due clic attaccati, come chi non è sicuro che il primo sia andato: un
  // riscatto solo, e il benvenuto non diventa «hai già i crediti».
  await pagina.locator('#apri').dblclick();
  await expect.poll(() => seen.redeems, { timeout: 20000 }).toEqual(['ABCDEFGH']);
  const credits = await attendiPagina(app, 'credits');
  expect(credits, 'il clic apre la pagina Crediti').toBeTruthy();
  await expect(credits.locator('#walletNote')).toContainText('Sei entrato con un invito', { timeout: 15000 });
  // La pagina dell'invito resta dov'era, col suo codice.
  expect(pagina.url()).toBe(indirizzo);
  await expect(pagina.locator('h1')).toHaveText('Hai un invito');
});

const CHAT = `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head>
<body style="font-family:sans-serif;padding:40px"><p>Anna: ecco il mio invito a Filo</p>
<p><a id="invito" href="https://filo.red/i/ABCD-EFGH">https://filo.red/i/ABCD-EFGH</a></p>
<p><a id="altro" href="https://filo.red/">il sito di Filo</a></p></body></html>`;

async function vociDelMenu(pagina, sel) {
  await pagina.locator(sel).click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });
  const voci = (await menu.locator('.sn-menu-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  return { menu, voci };
}

test(T_TASTO_DESTRO, async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  const pagina = await testServer.openReady(openTab, CHAT);

  // Un link di filo.red che non è un invito non ha la voce.
  const altro = await vociDelMenu(pagina, '#altro');
  expect(altro.voci.some((v) => /Riscatta/.test(v)), altro.voci.join(' · ')).toBe(false);
  await pagina.keyboard.press('Escape');
  await expect(altro.menu).toBeHidden({ timeout: 10000 });

  const { menu, voci } = await vociDelMenu(pagina, '#invito');
  expect(voci.findIndex((v) => /Riscatta l’invito/.test(v)), `prima voce del collegamento: ${voci.join(' · ')}`).toBeGreaterThanOrEqual(0);
  await pagina.screenshot({ path: 'tests/.shots/664-tasto-destro-invito.png' });
  await menu.locator('.sn-menu-item', { hasText: 'Riscatta l’invito' }).click();
  await expect.poll(() => seen.redeems, { timeout: 20000 }).toEqual(['ABCDEFGH']);
  const credits = await attendiPagina(app, 'credits');
  expect(credits, 'la voce apre la pagina Crediti').toBeTruthy();
  await expect(credits.locator('#walletNote')).toContainText('Sei entrato con un invito', { timeout: 15000 });
});

function schedeNuove(app) {
  return app.windows().filter((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
}

test(T_BENVENUTO_UNA_VOLTA, async ({ app, shell }) => {
  test.setTimeout(180000);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => schedeNuove(app).length, { timeout: 20000 }).toBe(3);
  for (const h of schedeNuove(app)) await h.waitForFunction(() => !!window.SN_CONFIRM_UI, null, { timeout: 20000 });

  // Il collegamento arriva da fuori mentre Filo è acceso: riscatta e porta
  // davanti la pagina Crediti, che lo racconta a modo suo.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD-EFGH'], process.cwd()); });
  await expect.poll(() => seen.redeems, { timeout: 20000 }).toEqual(['ABCDEFGH']);
  const credits = await attendiPagina(app, 'credits');
  await expect(credits.locator('#walletNote')).toContainText('Sei entrato con un invito', { timeout: 15000 });

  // L'utente torna alle schede nuove, una per una: il benvenuto lo trova
  // nella prima che guarda, e lì soltanto.
  const ids = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .filter((t) => String(t.url || '').startsWith('filo://newtab')).map((t) => t.id));
  expect(ids.length).toBe(3);
  const visti = [];
  for (const id of ids) {
    await shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
    await new Promise((r) => setTimeout(r, 2500));
    const testi = await Promise.all(schedeNuove(app).map((h) => confirmText(h).catch(() => '')));
    visti.push(testi.filter((t) => t.includes('Sei entrato con un invito')).length);
  }
  expect(visti, 'schede col benvenuto dopo ogni passaggio').toEqual([1, 1, 1]);
});

test(T_SALUTO, async ({ openTab }) => {
  test.setTimeout(120000);
  // A pari segni («CARA SARA» è otto lettere buone, in maiuscolo come il
  // codice), il server dice che il primo non esiste e Filo prova il secondo.
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'CARA SARA, ecco il codice: ABCDEFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#walletNote')).toContainText('riscattato', { timeout: 15000 });
  expect(seen.redeems).toEqual(['CARASARA', 'ABCDEFGH']);

  // Dalla chat della home, col messaggio com'è arrivato: il codice scritto
  // come si mostra passa davanti al saluto, e non si spreca un giro.
  seen.redeems.length = 0;
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#input');
  await home.fill('#input', '/invito Cara Sara, ecco il codice: ABCD-EFGH');
  await home.press('#input', 'Enter');
  await expect(home.locator('#bubbles .dash-bubble-filo').last()).toContainText('Invito riscattato', { timeout: 15000 });
  expect(seen.redeems).toEqual(['ABCDEFGH']);
});
