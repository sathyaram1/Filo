// Verifica #590 — giro 1. Le porte che restano aperte sulla lista dei siti
// bloccati DOPO che le tre strade della segnalazione (indirizzo scritto nella
// home, azione NAVIGA del modello, link) sono state chiuse.
//
// Qui non si ri-prova quello che la segnalazione chiedeva (lo fa già
// tests/siteBlock.spec.mjs): si prova a RAGGIUNGERE LO STESSO SITO scrivendo
// il suo indirizzo in una forma leggermente diversa, o facendocisi portare
// dal server. Se una di queste passa, il punto di passaggio unico c'è ma la
// decisione che prende è aggirabile — e le quattro strade cadono tutte
// insieme, perché tutte chiedono a lui.
//
// Porta A — il punto finale dell'host ("bloccato.lan." invece di
//           "bloccato.lan"): per la rete è lo stesso nome (forma assoluta), per
//           il confronto con la lista no.
// Porta B — il rimbalzo del server (301/302): il controllo guarda l'indirizzo
//           cliccato, non quello dove il server manda davvero.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const HOST_LAN = 'bloccato.lan';

// Host finto che il fixture risolve a 127.0.0.1: serve alla porta B, dove la
// pagina bloccata deve davvero caricarsi se il blocco non scatta.
const HOST_BLOCCATO = 'blocked.test';

async function abilitaBlocco(shell, host) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [h] } } },
  }), host);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

function schedeSuHost(app, host) {
  return app.windows().filter((w) => {
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  }).length;
}

// ─── Porta A: il punto finale dell'host ──────────────────────────────────────

test('A1 — NAVIGA del modello verso «bloccato.lan.» (col punto finale) deve restare bloccato', async ({ app, shell }) => {
  await abilitaBlocco(shell, HOST_LAN);

  // È lo stesso sito: il punto finale è la forma assoluta del nome, la rete lo
  // risolve identico. Una pagina ostile che convince il modello può dettargli
  // questa forma esattamente come l'altra.
  const esito = await app.evaluate((_e, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }), `http://${HOST_LAN}./pagina`);

  expect(esito.executed, 'l\'apertura non deve essere eseguita').toBe(false);
  expect(esito.output && esito.output.blocked).toBe('site');
});

test('A2 — indirizzo col punto finale scritto dall\'utente nella home deve restare bloccato', async ({ app, shell, openTab }) => {
  await abilitaBlocco(shell, HOST_LAN);

  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill(`/${HOST_LAN}.`);
  await input.press('Enter');

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 8000 });

  await dash.waitForTimeout(600);
  expect(schedeSuHost(app, `${HOST_LAN}.`)).toBe(0);
});

test('A3 — link col punto finale cliccato in una pagina deve restare bloccato', async ({ app, shell, openTab, testServer }) => {
  await abilitaBlocco(shell, HOST_LAN);

  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="http://${HOST_LAN}./pagina">vai</a>`,
  );
  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(fromUrl);
});

// ─── Porta B: il rimbalzo del server ─────────────────────────────────────────
//
// Il mini server della fixture non sa fare i rimbalzi, quindi ne alziamo uno
// nostro: /partenza ha il link, /rimbalzo risponde 302 verso l'host in lista,
// /arrivo è la pagina che NON deve comparire.

async function serverConRimbalzo() {
  let porta = 0;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/rimbalzo') {
      res.writeHead(302, { Location: `http://${HOST_BLOCCATO}:${porta}/arrivo` });
      res.end();
      return;
    }
    if (path === '/arrivo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><h1 id="t">ARRIVATO SUL SITO BLOCCATO</h1>');
      return;
    }
    if (path === '/partenza') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><a id="go" href="http://127.0.0.1:${porta}/rimbalzo">vai</a>`);
      return;
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  return { server, porta, chiudi: async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

test('B1 — un link che RIMBALZA (302) su un sito della lista deve restare bloccato', async ({ shell, openTab }) => {
  await abilitaBlocco(shell, HOST_BLOCCATO);
  const s = await serverConRimbalzo();
  try {
    const partenza = `http://127.0.0.1:${s.porta}/partenza`;
    const page = await openTab(partenza);
    await page.waitForSelector('#go', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('go').click());

    // Nessuna pagina del sito in lista deve essere arrivata a schermo.
    await page.waitForTimeout(1500);
    const arrivato = await page.evaluate(() => !!document.getElementById('t')).catch(() => false);
    expect(arrivato, 'la pagina del sito bloccato non deve caricarsi').toBe(false);
    expect(new URL(page.url()).hostname, 'la scheda non deve finire sull\'host bloccato').not.toBe(HOST_BLOCCATO);
  } finally {
    await s.chiudi();
  }
});

test('B2 — un indirizzo aperto da Filo che RIMBALZA (302) su un sito della lista deve restare bloccato', async ({ app, shell, openTab }) => {
  await abilitaBlocco(shell, HOST_BLOCCATO);
  const s = await serverConRimbalzo();
  try {
    // Stessa strada dell'azione NAVIGA: l'indirizzo che il modello propone è
    // innocuo, il rimbalzo lo porta sul sito della lista.
    const page = await openTab(`http://127.0.0.1:${s.porta}/rimbalzo`);
    await page.waitForTimeout(1500);
    const arrivato = await page.evaluate(() => !!document.getElementById('t')).catch(() => false);
    expect(arrivato, 'la pagina del sito bloccato non deve caricarsi').toBe(false);
    expect(schedeSuHost(app, HOST_BLOCCATO)).toBe(0);
  } finally {
    await s.chiudi();
  }
});
