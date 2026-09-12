// Verifica #590 — giro 3. Le strade che restano per raggiungere un sito della
// lista dopo che il giro 1 ha chiuso le varianti dell'indirizzo e il rimbalzo
// del server, e il giro 2 ha rimesso in piedi "Apri comunque".
//
// Qui si guardano tre cose che il punto di passaggio unico dichiara di coprire
// ma che nessuno dei due giri precedenti ha provato:
//
// Porta G — l'ECCEZIONE "arrivo da un motore di ricerca". La decisione la
//           prende il nome del sito da cui si parte: se è un motore, il sito
//           della lista si apre. I motori però ospitano anche pagine di
//           chiunque, e soprattutto REINDIRIZZANO: un indirizzo del motore che
//           risponde "vai qui" verso il sito della lista è una strada che il
//           modello può percorrere scrivendo un indirizzo del tutto innocuo.
//
// Porta H — i tasti AVANTI/INDIETRO. Sono un cambio di indirizzo di una scheda
//           come gli altri: se l'utente mette un sito in lista mentre quel sito
//           è nella cronologia della scheda, il tasto indietro ce lo riporta.
//
// Porta I — la chip "Bloccato popup da <sito> — Apri". Il bottone passa dallo
//           stesso percorso di "Apri comunque", che dal giro 2 REGISTRA il sì
//           dell'utente per tutta la sessione: un clic su una chip che parla
//           solo di popup toglie il sito dalla lista dei siti bloccati fino a
//           che Filo resta aperto.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MOTORE = 'www.google.com'; // un motore di ricerca vero, per l'eccezione
const LISTA = 'blocked.test'; // il sito che l'utente ha messo in lista

// Un solo server per tutti gli host: il resolver li porta tutti sul loopback,
// quindi è l'intestazione Host a dire chi stiamo servendo.
async function alzaServer() {
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    if (host === MOTORE && path === '/url') {
      // È esattamente quello che fa il redirect di un motore di ricerca.
      res.writeHead(302, { Location: `http://${LISTA}:${porta}/arrivo` });
      res.end();
      return;
    }
    if (host === MOTORE && path === '/pagina') {
      // Una pagina OSPITATA sul dominio del motore, con un link al sito in
      // lista nella stessa scheda e uno che apre una scheda nuova.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><a id="go" href="http://${LISTA}:${porta}/arrivo">vai</a><a id="nuova" target="_blank" href="http://${LISTA}:${porta}/arrivo">scheda nuova</a>`);
      return;
    }
    if (path === '/arrivo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><h1 id="t">SONO IL SITO DELLA LISTA</h1>');
      return;
    }
    if (path === '/altrove') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><h1 id="altrove">ALTROVE</h1>');
      return;
    }
    if (path === '/apripopup') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><button id="b" onclick="window.open('http://${LISTA}:${porta}/arrivo','_blank','width=500,height=400')">apri</button>`);
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
  userData = cartellaTemporanea('filo-test-590g3-');
  app = await electron.launch({
    args: [
      ...argomentiScala,
      `--host-resolver-rules=MAP ${MOTORE} 127.0.0.1, MAP ${LISTA} 127.0.0.1`,
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

async function urlSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return snap.tabs.map((t) => t.url);
}

function quanteSu(urls, host) {
  return urls.filter((u) => { try { return new URL(u).hostname === host; } catch (_) { return false; } }).length;
}

async function paginaSuHost(ms = 6000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === LISTA; } catch (_) { return false; }
    });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
});

// ─── Porta G: l'eccezione "arrivo da un motore di ricerca" ───────────────────

test('G1 — Filo apre un indirizzo del motore che RIMBALZA sul sito della lista', async () => {
  await metti(LISTA);
  // L'indirizzo che il modello propone è quello di un motore di ricerca: non è
  // in lista e non lo sarà mai. È il server del motore a mandare la scheda sul
  // sito della lista.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${MOTORE}:${srv.porta}/url?q=x`);
  await shell.waitForTimeout(2500);
  const page = await paginaSuHost(1500);
  const caricata = page ? await page.evaluate(() => !!document.getElementById('t')).catch(() => false) : false;
  expect(caricata, 'la pagina del sito della lista non deve caricarsi').toBe(false);
  expect(quanteSu(await urlSchede(), LISTA), 'nessuna scheda deve finire sul sito della lista').toBe(0);
});

test('G2 — un link cliccato su una PAGINA ospitata dal dominio del motore', async () => {
  await metti(LISTA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${MOTORE}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2000);
  const pagine = app.windows().filter((w) => {
    try { return new URL(w.url()).hostname === MOTORE; } catch (_) { return false; }
  });
  expect(pagine.length, 'la pagina di partenza deve essersi aperta').toBeGreaterThan(0);
  const p = pagine[pagine.length - 1];
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(2000);
  expect(quanteSu(await urlSchede(), LISTA), 'il sito della lista non deve aprirsi').toBe(0);
});

// ─── Porta H: i tasti avanti/indietro ────────────────────────────────────────

test('H — il tasto indietro riporta su un sito messo in lista nel frattempo', async () => {
  // Lista vuota: l'utente naviga normalmente.
  await metti();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(1500);
  const p = await paginaSuHost();
  expect(p, 'la prima pagina si apre: la lista è vuota').not.toBeNull();
  await expect(p.locator('#t')).toBeVisible({ timeout: 8000 });

  // Stessa scheda, un'altra pagina: così nella cronologia c'è un "indietro".
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const id = snap.tabs[snap.tabs.length - 1].id;
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, `http://127.0.0.1:${srv.porta}/altrove`]);
  await shell.waitForTimeout(1500);

  // Adesso l'utente mette quel sito in lista: da qui in poi non deve più aprirsi.
  await metti(LISTA);

  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await shell.waitForTimeout(2000);

  expect(quanteSu(await urlSchede(), LISTA), 'il tasto indietro non deve riportare sul sito della lista').toBe(0);
});

// ─── Porta I: la chip dei popup dà un permesso che non promette ──────────────

test('I — «Apri» sulla chip dei popup toglie il sito dalla lista per tutta la sessione', async () => {
  await metti(LISTA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${srv.porta}/apripopup`);
  await shell.waitForTimeout(1500);
  const p = app.windows().find((w) => {
    try { return new URL(w.url()).pathname === '/apripopup'; } catch (_) { return false; }
  });
  expect(p, 'la pagina che apre il popup deve esserci').toBeTruthy();
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');

  // La chip dei popup parla SOLO di popup: non nomina la lista dei siti bloccati.
  const chip = shell.locator('.popup-chip');
  await expect(chip).toBeVisible({ timeout: 6000 });
  const testoChip = await chip.innerText();
  await chip.getByText('Apri', { exact: true }).first().click();
  await shell.waitForTimeout(2000);

  // Dopo quel clic, il sito della lista si apre da OGNI strada — compresa
  // l'azione del modello, che è quella che la segnalazione voleva chiudere.
  const esito = await app.evaluate((_e, u) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u }), `http://${LISTA}:${srv.porta}/arrivo`);
  expect(
    esito.executed,
    `il sito è ancora in lista: una chip che dice «${testoChip.replace(/\s+/g, ' ').trim()}» non deve autorizzarlo`,
  ).toBe(false);
});
