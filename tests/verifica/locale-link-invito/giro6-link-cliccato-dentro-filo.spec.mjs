// Giro di verifica locale del ramo claude/link-invito — giro 6.
//
// Le strade equivalenti, che nessun giro passato aveva guardato. Un invito
// viaggia in chat, e Filo è anche un browser: chi Filo ce l'ha già apre quel
// link DENTRO Filo, e la pagina dell'invito si presenta lì, col suo pulsante
// grande che promette di aprire Filo.
//
// I giri passati hanno provato il collegamento consegnato da FUORI, e hanno
// provato che una pagina non riscatti DA SOLA senza che nessuno abbia
// cliccato: quella porta deve restare chiusa. Qui si prova la terza cosa, che
// è un'altra: il clic vero di una persona, dentro Filo, e il tasto destro sul
// collegamento d'invito.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro. Server finto: un
// codice vero a usi contati non si brucia per una prova.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const CODICE = 'ABCDEFGH';

let server;
let redeems = [];

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
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      // Nessun invito che aspetta questa macchina: qui l'invito può entrare
      // solo dal clic, e un riscatto automatico confonderebbe la misura.
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
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
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

// La pagina dell'invito com'è fatta: il codice a schermo e un pulsante grande
// che porta il codice dentro Filo. Niente script: a cliccare è una persona.
const PAGINA_INVITO = `<!doctype html><html><head><meta charset="utf-8"><title>Il tuo invito a Filo</title></head>
<body style="font-family:sans-serif;padding:40px">
<h1>Hai un invito</h1>
<p>Codice: ABCD-EFGH</p>
<p><a id="apri" href="filo://invito/${CODICE}" style="display:inline-block;padding:16px 28px;background:#c66;color:#fff;text-decoration:none">Apri in Filo</a></p>
</body></html>`;

// Il messaggio com'è arrivato in chat: il solo collegamento.
const CHAT = `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head>
<body style="font-family:sans-serif;padding:40px">
<p>Anna: ciao! ecco il mio invito a Filo</p>
<p><a id="invito" href="https://filo.red/i/ABCD-EFGH">https://filo.red/i/ABCD-EFGH</a></p>
</body></html>`;

test('il pulsante della pagina dell’invito, cliccato da una persona dentro Filo, porta il codice dentro', async ({ app, openTab, testServer }) => {
  test.fail(true, 'dentro Filo il pulsante porta la scheda su un indirizzo interno che non esiste, e non riscatta niente');
  test.setTimeout(180000);
  redeems = [];

  const pagina = await testServer.openReady(openTab, PAGINA_INVITO);
  await expect(pagina.locator('#apri')).toBeVisible({ timeout: 20000 });

  // Il clic vero: nessuno script, il puntatore sul pulsante.
  await pagina.locator('#apri').click({ timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10000));

  // Dove è finito chi ha cliccato: serve al racconto del rilievo.
  const dove = app.windows().map((w) => w.url()).join(' · ');

  // Dal punto di vista di chi ha cliccato: l'invito è entrato in Filo.
  expect(redeems, `dopo il clic le schede aperte sono: ${dove}`).toContain(CODICE);
});

test('il tasto destro su un collegamento d’invito offre di portarlo dentro Filo', async ({ openTab, testServer }) => {
  test.fail(true, 'il menu offre apri, copia, salva e condividi, e niente che porti l’invito dentro');
  test.setTimeout(120000);

  const pagina = await testServer.openReady(openTab, CHAT);
  await pagina.locator('#invito').click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });

  // Solo le VOCI del menu: il riquadro della spiegazione del collegamento è
  // testo che arriva da un modello, e non è una strada per fare niente.
  const voci = (await menu.locator('.sn-menu-item').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  expect(
    voci.some((v) => /riscatt|invito|crediti/i.test(v)),
    `le voci sul collegamento d’invito sono: ${voci.join(' · ')}`,
  ).toBe(true);
});
