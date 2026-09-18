// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// Un invito si riscatta una volta sola e lega per sempre l'installazione a chi
// l'ha invitata: è una porta che si chiude alle spalle. Adesso quella porta la
// può spingere anche un collegamento scritto da una pagina qualsiasi, e Filo È
// un browser — quelle pagine girano dentro Filo. Qui si prova a farle
// riscattare un invito SENZA che nessuno abbia cliccato niente: riquadro
// incorporato, finestra nuova, clic finto, e rinvio della pagina.
//
// Server finto: nessun codice vero viene toccato.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        redeems.push(String((body.data && body.data.code) || ''));
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 } });
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

// Le strade che una pagina può prendere da sola: un riquadro incorporato, una
// finestra nuova, un clic che non ha fatto nessuno, un rinvio.
const PASSIVA = `<!doctype html><html><head><meta charset="utf-8"><title>una pagina qualsiasi</title></head>
<body>
<h1>Una pagina qualsiasi</h1>
<a id="ancora" href="filo://invito/AAAA2222">niente di che</a>
<iframe id="dentro" src="filo://invito/BBBB3333" width="10" height="10"></iframe>
<script>
  try { window.open('filo://invito/CCCC4444', '_blank'); } catch (e) {}
  setTimeout(function () { try { document.getElementById('ancora').click(); } catch (e) {} }, 400);
</script>
</body></html>`;

const RINVIO = `<!doctype html><html><head><meta charset="utf-8"><title>rinvio</title></head>
<body><h1>rinvio</h1>
<script>setTimeout(function () { try { location.href = 'filo://invito/DDDD5555'; } catch (e) {} }, 400);</script>
</body></html>`;

test('una pagina qualsiasi non riscatta un invito da sola, senza che nessuno abbia cliccato', async ({ app, openTab, testServer }) => {
  test.setTimeout(180000);
  redeems = [];

  const page = await openTab(testServer.html(PASSIVA));
  await page.waitForTimeout(3000);
  console.log('TAB:', page.url());
  console.log('FINESTRE:', app.windows().map((w) => w.url()).join(' | '));
  console.log('HTML:', (await page.content().catch(() => '')).slice(0, 400));
  await page.waitForTimeout(8000);

  await openTab(testServer.html(RINVIO));
  await new Promise((r) => setTimeout(r, 8000));

  expect(redeems, `una pagina ha fatto riscattare da sola i codici ${redeems.join(', ') || '(nessuno)'}`).toEqual([]);
});
