// Verifica #590 — giro 2. Lo scavalco scelto dall'utente: "Apri comunque".
//
// La lista dei siti bloccati ha un solo scavalco dichiarato: il bottone sulla
// notifica. Il giro 1 ha chiuso le strade che portavano al sito SENZA
// permesso; qui si guarda l'altra metà — quando il permesso l'utente lo dà
// esplicitamente, il sito si apre davvero?
//
// Porta C — il controllo nuovo sui rimbalzi del server non sa niente dello
//           scavalco: il permesso vale per la prima richiesta e non per dove
//           il server manda la scheda subito dopo (http→https è quasi ogni
//           sito del web).
// Porta D — lo stesso permesso non sopravvive al primo link cliccato dentro
//           il sito appena aperto.
//
// Sanity: un indirizzo scritto senza schema davanti deve ancora APRIRSI, non
// solo essere controllato (il giro 1 ha aggiunto un rifiuto su questa forma).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const HOST = 'blocked.test'; // la fixture lo risolve al loopback

async function abilitaBlocco(shell, ...host) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: h } } },
  }), host);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// Server del sito "bloccato":
//   /rimbalza → 302 verso /dentro dello STESSO sito (il caso http→https)
//   /dentro   → pagina vera
//   /ingresso → pagina vera con un link verso /dentro
async function sitoConRimbalzo() {
  let porta = 0;
  const pagina = (corpo) => `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/rimbalza') {
      res.writeHead(302, { Location: `http://${HOST}:${porta}/dentro` });
      res.end();
      return;
    }
    if (path === '/dentro') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="dentro">SONO DENTRO</h1>'));
      return;
    }
    if (path === '/ingresso') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<h1 id="ingresso">INGRESSO</h1><a id="go" href="http://${HOST}:${porta}/dentro">avanti</a>`));
      return;
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  return {
    porta,
    chiudi: async () => {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// La Page del WebContentsView che sta su quell'host (se è nata).
async function paginaSuHost(app, host, ms = 6000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
    });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('C — «Apri comunque» su un sito che rimbalza: il sito deve aprirsi', async ({ app, shell }) => {
  await abilitaBlocco(shell, HOST);
  const s = await sitoConRimbalzo();
  try {
    const url = `http://${HOST}:${s.porta}/rimbalza`;

    // 1. tentativo normale: bloccato, e compare la notifica.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
    await expect(card).toBeVisible({ timeout: 6000 });

    // 2. l'utente sceglie: "Apri comunque". È l'unico scavalco dichiarato.
    await card.getByText('Apri comunque').click();

    // 3. il sito deve caricarsi davvero. Il rimbalzo porta alla pagina vera
    //    dello STESSO sito: è dove l'utente ha detto di voler andare.
    const page = await paginaSuHost(app, HOST);
    expect(page, 'la scheda sul sito deve esistere').not.toBeNull();
    await expect(page.locator('#dentro')).toBeVisible({ timeout: 8000 });
  } finally {
    await s.chiudi();
  }
});

test('D — dopo «Apri comunque», un link dentro il sito deve funzionare', async ({ app, shell }) => {
  await abilitaBlocco(shell, HOST);
  const s = await sitoConRimbalzo();
  try {
    const url = `http://${HOST}:${s.porta}/ingresso`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
    await expect(card).toBeVisible({ timeout: 6000 });
    await card.getByText('Apri comunque').click();

    const page = await paginaSuHost(app, HOST);
    expect(page, 'la scheda sul sito deve esistere').not.toBeNull();
    await expect(page.locator('#ingresso')).toBeVisible({ timeout: 8000 });

    // L'utente è dentro il sito che ha voluto aprire: navigarci dentro deve
    // funzionare, come in qualunque scheda.
    await page.evaluate(() => document.getElementById('go').click());
    await expect(page.locator('#dentro')).toBeVisible({ timeout: 8000 });
  } finally {
    await s.chiudi();
  }
});

test('E — un indirizzo senza schema davanti si apre ancora (non solo si controlla)', async ({ app, shell, testServer }) => {
  await abilitaBlocco(shell, 'altro.esempio');
  const url = testServer.html('<!doctype html><meta charset="utf-8"><h1 id="ok">APERTA</h1>');
  const nudo = url.replace(/^https?:\/\//, ''); // 127.0.0.1:PORTA/1

  const esito = await app.evaluate((_e, u) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u }), nudo);
  expect(esito.executed, 'l\'apertura deve riuscire').toBe(true);

  const page = await paginaSuHost(app, '127.0.0.1');
  expect(page).not.toBeNull();
  await expect(page.locator('#ok')).toBeVisible({ timeout: 8000 });
});
