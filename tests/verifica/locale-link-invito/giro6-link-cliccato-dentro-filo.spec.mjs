// Giro di verifica locale del ramo claude/link-invito — giro 6.
//
// Un invito viaggia in chat. Chi lo riceve e Filo ce l'ha già lo apre DENTRO
// Filo: la chat è una scheda come un'altra, il link ci si clicca sopra, e la
// pagina dell'invito si apre lì. Da lì l'invitato preme il pulsante che quella
// pagina gli mette davanti per portare il codice dentro Filo.
//
// I giri passati hanno provato il collegamento che arriva da FUORI (un'altra
// applicazione che lo consegna a Filo) e hanno provato che una pagina non
// riscatti DA SOLA, senza che nessuno abbia cliccato. Qui si prova la terza
// cosa: il clic vero di una persona su quel pulsante, dentro Filo.
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
      // Nessun invito che aspetta questa macchina: qui l'invito arriva solo
      // dal clic, e un riscatto automatico confonderebbe la misura.
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

// La pagina dell'invito com'è fatta: un pulsante grande che porta il codice
// dentro Filo. Niente script: a cliccare è una persona.
const PAGINA_INVITO = `<!doctype html><html><head><meta charset="utf-8"><title>Il tuo invito a Filo</title></head>
<body style="font-family:sans-serif;padding:40px">
<h1>Il tuo invito a Filo</h1>
<p>Codice: ABCD-EFGH</p>
<p><a id="apri" href="filo://invito/${CODICE}" style="display:inline-block;padding:16px 28px;background:#c66;color:#fff;text-decoration:none">Apri Filo</a></p>
</body></html>`;

test('il pulsante della pagina dell’invito, cliccato da una persona dentro Filo, porta il codice dentro', async ({ openTab, testServer }) => {
  test.setTimeout(180000);
  redeems = [];

  const pagina = await openTab(testServer.html(PAGINA_INVITO));
  await pagina.waitForLoadState('domcontentloaded');
  await expect(pagina.locator('#apri')).toBeVisible({ timeout: 20000 });

  // Il clic vero: nessuno script, il puntatore sul pulsante.
  await pagina.locator('#apri').click({ timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));

  // Cosa si ritrova davanti chi ha cliccato: serve al racconto del rilievo.
  let dove = '(la scheda è sparita)';
  try { dove = `${pagina.url()} — «${(await pagina.title()) || ''}»`; } catch (_) {}

  // Dal punto di vista di chi ha cliccato: l'invito è entrato in Filo.
  await expect
    .poll(() => redeems.length, { timeout: 45000, intervals: [500] })
    .toBeGreaterThan(0);
  expect(redeems[0], `dopo il clic la scheda mostra: ${dove}`).toBe(CODICE);
});
