// Verifica #590 — giro 1. Le porte che restano aperte sulla lista dei siti
// bloccati DOPO che le strade della segnalazione (indirizzo scritto nella home,
// azione NAVIGA del modello, link) sono state chiuse.
//
// Qui non si ri-prova quello che la segnalazione chiedeva (lo fa già
// tests/siteBlock.spec.mjs): si prova a RAGGIUNGERE LO STESSO SITO scrivendo il
// suo indirizzo in una forma leggermente diversa, o facendocisi portare dal
// server. Se una di queste passa, il punto di passaggio unico c'è ma la
// decisione che prende è aggirabile — e tutte le strade cadono insieme, perché
// tutte chiedono a lui.
//
// Porta A — il punto finale dell'host ("bloccato.lan." invece di
//           "bloccato.lan"): per la rete è lo stesso nome (forma assoluta), per
//           il confronto con la lista no.
// Porta B — il rimbalzo del server (301/302): il controllo guarda l'indirizzo
//           cliccato, non quello dove il server manda davvero.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const HOST_LAN = 'bloccato.lan';

// Host finto che il fixture risolve a 127.0.0.1: serve dove la pagina bloccata
// deve davvero caricarsi se il blocco non scatta.
const HOST_BLOCCATO = 'blocked.test';

async function abilitaBlocco(shell, ...host) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: h } } },
  }), host);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// Gli indirizzi delle schede come li conosce il gestore: una scheda che tenta
// un host irraggiungibile resta comunque registrata su quell'indirizzo (la
// finestra mostra la pagina d'errore), quindi è qui che si vede se la scheda è
// nata o no — non nell'elenco delle finestre.
async function indirizziSchede(shell) {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return snap.tabs.map((t) => t.url);
}

function schedeSuHost(urls, host) {
  return urls.filter((u) => { try { return new URL(u).hostname === host; } catch (_) { return false; } }).length;
}

// ─── Porta A: il punto finale dell'host ──────────────────────────────────────

test('A1 — NAVIGA del modello verso «bloccato.lan.» (col punto finale) resta bloccato', async ({ app, shell }) => {
  await abilitaBlocco(shell, HOST_LAN);

  // È lo stesso sito: il punto finale è la forma assoluta del nome, la rete lo
  // risolve identico. Una pagina ostile che convince il modello può dettargli
  // questa forma esattamente come l'altra.
  const esito = await app.evaluate((_e, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }), `http://${HOST_LAN}./pagina`);

  expect(esito.executed, 'l\'apertura non deve essere eseguita').toBe(false);
  expect(esito.output && esito.output.blocked).toBe('site');
  expect(schedeSuHost(await indirizziSchede(shell), `${HOST_LAN}.`)).toBe(0);
});

test('A2 — indirizzo col punto finale scritto dall\'utente nella home resta bloccato', async ({ shell, openTab }) => {
  await abilitaBlocco(shell, HOST_LAN);

  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill(`/${HOST_LAN}.`);
  await input.press('Enter');
  await dash.waitForTimeout(2000);

  // Nessuna scheda deve essere nata su quell'host.
  expect(schedeSuHost(await indirizziSchede(shell), `${HOST_LAN}.`)).toBe(0);
});

test('A3 — link col punto finale cliccato in una pagina resta bloccato', async ({ shell, openTab, testServer }) => {
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

test('A4 — indirizzo col punto finale nella barra della shell resta bloccato', async ({ shell, openTab }) => {
  await abilitaBlocco(shell, HOST_BLOCCATO);

  // La quarta strada: rinavigare una scheda già aperta scrivendo l'indirizzo
  // nella barra (tabs:navigate). Con l'host risolvibile la pagina si carica
  // davvero, quindi qui non è un tentativo a vuoto.
  await openTab('filo://newtab/');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const id = snap.tabs[snap.tabs.length - 1].id;
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, `http://${HOST_BLOCCATO}./`]);
  await shell.waitForTimeout(2000);

  expect(schedeSuHost(await indirizziSchede(shell), `${HOST_BLOCCATO}.`)).toBe(0);
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
  return {
    porta,
    chiudi: async () => {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

test('B1 — un link che RIMBALZA (302) su un sito della lista resta bloccato', async ({ shell, openTab }) => {
  await abilitaBlocco(shell, HOST_BLOCCATO);
  const s = await serverConRimbalzo();
  try {
    const partenza = `http://127.0.0.1:${s.porta}/partenza`;
    const page = await openTab(partenza);
    await page.waitForSelector('#go', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('go').click());

    await page.waitForTimeout(1500);
    const arrivato = await page.evaluate(() => !!document.getElementById('t')).catch(() => false);
    expect(arrivato, 'la pagina del sito bloccato non deve caricarsi').toBe(false);
    expect(schedeSuHost(await indirizziSchede(shell), HOST_BLOCCATO)).toBe(0);
  } finally {
    await s.chiudi();
  }
});

test('B2 — un indirizzo aperto da Filo che RIMBALZA (302) su un sito della lista resta bloccato', async ({ shell }) => {
  await abilitaBlocco(shell, HOST_BLOCCATO);
  const s = await serverConRimbalzo();
  try {
    // Stessa strada dell'azione NAVIGA: l'indirizzo che il modello propone è
    // innocuo, il rimbalzo lo porta sul sito della lista.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${s.porta}/rimbalzo`);
    await shell.waitForTimeout(2500);
    expect(schedeSuHost(await indirizziSchede(shell), HOST_BLOCCATO)).toBe(0);
  } finally {
    await s.chiudi();
  }
});
