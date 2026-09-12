// Verifica #590 — giro 5. I modi in cui una PAGINA porta la scheda altrove
// senza che nessuno clicchi un link.
//
// I giri 1-4 hanno chiuso: le quattro strade dichiarate (home, barra, link,
// azione del modello), le varianti dello stesso indirizzo, il rimbalzo del
// server (301/302), la chip dei popup, l'eccezione "arrivo da un motore di
// ricerca", avanti/indietro, la ricarica, i riquadri incorporati, la
// finestrella di accesso, e il permesso di «Apri comunque» (che dura, si vede
// e si toglie).
//
// Restano fuori i cambi di indirizzo che NON sono né un clic né un 301: quelli
// che la pagina scrive dentro di sé.
//
// Porta R — il RINVIO AUTOMATICO scritto nella pagina
//           (<meta http-equiv="refresh">). È il rimbalzo che non passa dal
//           server: lo scrive chi fa la pagina, e mezzo web lo usa.
// Porta S — il MODULO: una pagina qualsiasi che invia un form verso il sito
//           della lista, in GET e in POST.
// Porta T — il riquadro incorporato che ci arriva per RIMBALZO del server: il
//           giro 4 ha chiuso il riquadro che punta diritto al sito della lista.
// Porta U — l'indirizzo cambiato dalla pagina via JavaScript (controllo: deve
//           essere già chiuso).

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'blocked.test';
const NORMALE = 'innocuo.test';

async function alzaServer() {
  let porta = 0;
  const pagina = (corpo) => `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const bloccato = `http://${LISTA}:${porta}`;

    if (host === LISTA) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="t">SONO IL SITO DELLA LISTA</h1>'));
      return;
    }

    // R — rinvio automatico scritto nella pagina.
    if (path === '/rinvio-subito') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<meta http-equiv="refresh" content="0;url=${bloccato}/arrivo"><h1 id="p">un attimo…</h1>`));
      return;
    }
    if (path === '/rinvio-ritardo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<meta http-equiv="refresh" content="1;url=${bloccato}/arrivo"><h1 id="p">un attimo…</h1>`));
      return;
    }

    // S — modulo verso il sito della lista.
    if (path === '/modulo-get') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<form id="f" method="GET" action="${bloccato}/arrivo"><input name="q" value="x"><button id="b" type="submit">invia</button></form>`));
      return;
    }
    if (path === '/modulo-post') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<form id="f" method="POST" action="${bloccato}/arrivo"><input name="q" value="x"><button id="b" type="submit">invia</button></form>`));
      return;
    }

    // T — riquadro incorporato che ci arriva per rimbalzo del server.
    if (path === '/salta-nel-riquadro') {
      res.writeHead(302, { Location: `${bloccato}/arrivo` });
      res.end();
      return;
    }
    if (path === '/incorpora-rimbalzo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<iframe id="f" src="http://${NORMALE}:${porta}/salta-nel-riquadro" style="width:100%;height:600px;border:0"></iframe>`));
      return;
    }

    // U — controllo: l'indirizzo cambiato da JavaScript.
    if (path === '/js-vai') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<button id="b" onclick="location.href='${bloccato}/arrivo'">vai</button>`));
      return;
    }
    if (path === '/js-sostituisci') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<button id="b" onclick="location.replace('${bloccato}/arrivo')">vai</button>`));
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

let app = null;
let shell = null;
let userData = null;
let srv = null;

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g5-');
  app = await electron.launch({
    args: [
      ...argomentiScala,
      `--host-resolver-rules=MAP ${LISTA} 127.0.0.1, MAP ${NORMALE} 127.0.0.1`,
      '.',
    ],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app?.close(); } catch (_) {}
  try { await srv?.chiudi(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null; srv = null;
});

async function metti(...host) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: h } } },
  }), host);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) {
    await shell.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  }
  await shell.waitForTimeout(300);
}

function finestreSu(host) {
  return app.windows().filter((w) => {
    if (w.isClosed()) return false;
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  });
}

async function aspettaFinestraSu(host, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of finestreSu(host).reverse()) {
      const viva = await w.evaluate(() => true).catch(() => false);
      if (viva) return w;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Il sito della lista è arrivato a schermo? Guarda ogni finestra e ogni
// riquadro dentro di essa: il contenuto conta dovunque si veda.
async function sitoDellaListaVisibile() {
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      const url = f.url() || '';
      let h = '';
      try { h = new URL(url).hostname; } catch (_) { continue; }
      if (h !== LISTA) continue;
      const c = await f.evaluate(() => !!document.getElementById('t')).catch(() => false);
      if (c) return true;
    }
  }
  return false;
}

async function apriPagina(path) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}${path}`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina di partenza deve aprirsi').not.toBeNull();
  return p;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
});

// ─── Porta R: il rinvio automatico scritto nella pagina ──────────────────────

test('R1 — <meta refresh> immediato verso il sito della lista', async () => {
  await metti(LISTA);
  await apriPagina('/rinvio-subito');
  await shell.waitForTimeout(3000);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});

test('R2 — <meta refresh> ritardato verso il sito della lista', async () => {
  await metti(LISTA);
  await apriPagina('/rinvio-ritardo');
  await shell.waitForTimeout(4000);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});

test('R3 — e quando ferma, lo dice', async () => {
  await metti(LISTA);
  await apriPagina('/rinvio-subito');
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });
});

// ─── Porta S: il modulo ──────────────────────────────────────────────────────

test('S1 — un modulo inviato in GET verso il sito della lista', async () => {
  await metti(LISTA);
  const p = await apriPagina('/modulo-get');
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');
  await shell.waitForTimeout(3000);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});

test('S2 — lo stesso modulo in POST', async () => {
  await metti(LISTA);
  const p = await apriPagina('/modulo-post');
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');
  await shell.waitForTimeout(3000);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});

// ─── Porta T: il riquadro che ci arriva per rimbalzo ─────────────────────────

test('T — il riquadro incorporato che rimbalza sul sito della lista', async () => {
  await metti(LISTA);
  await apriPagina('/incorpora-rimbalzo');
  await shell.waitForTimeout(3500);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve caricarsi dentro un riquadro').toBe(false);
});

// ─── Porta U: controllo, l'indirizzo cambiato da JavaScript ──────────────────

test('U1 — location.href verso il sito della lista', async () => {
  await metti(LISTA);
  const p = await apriPagina('/js-vai');
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});

test('U2 — location.replace verso il sito della lista', async () => {
  await metti(LISTA);
  const p = await apriPagina('/js-sostituisci');
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve arrivare a schermo').toBe(false);
});
