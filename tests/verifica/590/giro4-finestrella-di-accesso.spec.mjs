// Verifica #590 — giro 4. Le porte che restano dopo i tre giri precedenti.
//
// I giri 1-3 hanno chiuso: le quattro strade dichiarate (home, barra, link,
// azione del modello), le varianti dello stesso indirizzo, il rimbalzo del
// server, la chip dei popup, l'eccezione "arrivo da un motore di ricerca" e i
// tasti avanti/indietro comandati dalla shell.
//
// Qui si guardano le superfici che decidono qualcosa PRIMA di chiedere alla
// lista, e i cambi di pagina che non sono "una scheda che cambia indirizzo":
//
// Porta L — la FINESTRELLA DI ACCESSO. Una pagina qualsiasi che apre una
//           finestra il cui indirizzo somiglia a un accesso (un percorso
//           /login, /oauth, /signin, oppure un sito che è anche un fornitore di
//           identità) viene riconosciuta come login PRIMA che qualcuno guardi
//           la lista, e la finestra si apre. Il giro 3 aveva chiuso gli
//           spostamenti INTERNI a quella finestra, non il suo primo indirizzo.
//
// Porta M — la stessa cosa ripetuta: da dentro la finestrella di accesso si
//           apre una seconda finestrella, con la stessa scorciatoia.
//
// Porta N — il tasto RICARICA su una scheda ferma su un sito appena messo in
//           lista.
//
// Porta O — la pagina che torna indietro DA SOLA (history.back() scritto nella
//           pagina) verso un sito messo in lista nel frattempo.
//
// Porta P — il sito della lista mostrato dentro un riquadro incorporato.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'blocked.test'; // il sito che l'utente ha messo in lista
const NORMALE = 'innocuo.test'; // un sito qualunque, mai in lista

async function alzaServer() {
  let porta = 0;
  const pagina = (corpo) =>
    `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const bloccato = `http://${LISTA}:${porta}`;

    // Pagine SUL SITO DELLA LISTA.
    if (host === LISTA) {
      if (path === '/apri-secondo') {
        // Dentro la finestrella di accesso: ne apre una seconda, sempre
        // verso il sito della lista e sempre con un indirizzo da "accesso".
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pagina(`<h1 id="t">SONO IL SITO DELLA LISTA</h1><button id="b" onclick="window.open('${bloccato}/signin','_blank','width=480,height=420')">ancora</button>`));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<h1 id="t">SONO IL SITO DELLA LISTA</h1><a id="via" href="http://${NORMALE}:${porta}/altrove">via</a>`));
      return;
    }

    // Pagine su un sito qualunque.
    if (path === '/apri-login') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<button id="b" onclick="window.open('${bloccato}/login','_blank','width=500,height=400')">accedi</button>`));
      return;
    }
    if (path === '/apri-oauth') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<button id="b" onclick="window.open('${bloccato}/qualsiasi?client_id=1&redirect_uri=http%3A%2F%2Fx','_blank','width=500,height=400')">continua</button>`));
      return;
    }
    if (path === '/apri-secondo-livello') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<button id="b" onclick="window.open('${bloccato}/apri-secondo','_blank','width=500,height=400')">accedi</button>`));
      return;
    }
    if (path === '/incorpora') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<iframe id="f" src="${bloccato}/arrivo" style="width:100%;height:600px;border:0"></iframe>`));
      return;
    }
    if (path === '/torna') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="altrove">ALTROVE</h1><button id="b" onclick="history.back()">indietro</button>'));
      return;
    }
    if (path === '/altrove') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="altrove">ALTROVE</h1>'));
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
  userData = cartellaTemporanea('filo-test-590g4-');
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

// Ogni finestra/scheda che Filo tiene aperta su quell'host, qualunque sia il
// contenitore: una finestrella di accesso NON compare fra le schede.
function finestreSu(host) {
  return app.windows().filter((w) => {
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  });
}

async function aspettaFinestraSu(host, ms = 6000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const f = finestreSu(host);
    if (f.length) return f[f.length - 1];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function apriEClicca(path) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}${path}`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await p.waitForSelector('#b', { timeout: 8000 });
  await p.click('#b');
  return p;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
});

// ─── Porta L: il primo indirizzo della finestrella di accesso ────────────────

test('L1 — una pagina apre il sito della lista come finestrella di accesso (/login)', async () => {
  await metti(LISTA);
  await apriEClicca('/apri-login');
  await shell.waitForTimeout(2500);
  const f = finestreSu(LISTA);
  const caricata = f.length
    ? await f[f.length - 1].evaluate(() => !!document.getElementById('t')).catch(() => false)
    : false;
  expect(caricata, 'il sito della lista non deve comparire in una finestrella di accesso').toBe(false);
});

test('L2 — la stessa cosa con i parametri OAuth invece del percorso', async () => {
  await metti(LISTA);
  await apriEClicca('/apri-oauth');
  await shell.waitForTimeout(2500);
  const f = finestreSu(LISTA);
  const caricata = f.length
    ? await f[f.length - 1].evaluate(() => !!document.getElementById('t')).catch(() => false)
    : false;
  expect(caricata, 'il sito della lista non deve comparire in una finestrella di accesso').toBe(false);
});

test('L3 — la finestrella fermata non deve restare lì vuota', async () => {
  // Il sito non si apre, ed è giusto. Ma la finestrella è già NATA: resta a
  // schermo senza indirizzo, senza titolo e senza contenuto, e l'utente la deve
  // chiudere a mano. È lo stesso prezzo già pagato (e già tolto) per la scheda
  // rimasta vuota dopo un rimbalzo fermato.
  await metti(LISTA);
  await apriEClicca('/apri-login');
  await shell.waitForTimeout(3000);
  const vuote = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w.webContents.getURL())
    .length);
  expect(vuote, 'non deve restare aperta una finestra senza indirizzo').toBe(0);
});

// ─── Porta M: la finestrella che ne apre un'altra ────────────────────────────

test('M — da dentro la finestrella, una seconda finestrella sullo stesso sito', async () => {
  await metti(LISTA);
  await apriEClicca('/apri-secondo-livello');
  const prima = await aspettaFinestraSu(LISTA, 4000);
  test.skip(!prima, 'la prima finestrella non si è aperta: questa porta la copre L1');
  await prima.waitForSelector('#b', { timeout: 8000 });
  await prima.click('#b');
  await shell.waitForTimeout(2500);
  const tutte = finestreSu(LISTA);
  expect(tutte.length, 'la finestrella non deve poterne aprire una seconda sul sito della lista').toBeLessThan(2);
});

// ─── Porta N: il tasto ricarica ──────────────────────────────────────────────

test('N — ricaricare una scheda ferma su un sito messo in lista nel frattempo', async () => {
  await metti(); // lista vuota: l'utente ci arriva normalmente
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  const p = await aspettaFinestraSu(LISTA);
  expect(p, 'con la lista vuota il sito si apre').not.toBeNull();
  await expect(p.locator('#t')).toBeVisible({ timeout: 8000 });

  await metti(LISTA); // adesso l'utente lo mette in lista

  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const id = snap.tabs[snap.tabs.length - 1].id;
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await shell.waitForTimeout(2500);

  const ancora = finestreSu(LISTA);
  const viva = ancora.length
    ? await ancora[ancora.length - 1].evaluate(() => !!document.getElementById('t')).catch(() => false)
    : false;
  expect(viva, 'ricaricare non deve ricaricare un sito che adesso è in lista').toBe(false);
});

// ─── Porta O: la pagina che torna indietro da sola ───────────────────────────

test('O — history.back() scritto nella pagina riporta sul sito della lista', async () => {
  await metti();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  const p = await aspettaFinestraSu(LISTA);
  expect(p, 'con la lista vuota il sito si apre').not.toBeNull();
  await p.waitForSelector('#via', { timeout: 8000 });
  // Stessa scheda, una pagina che sa tornare indietro da sola.
  await p.evaluate((u) => { document.getElementById('via').href = u; document.getElementById('via').click(); },
    `http://${NORMALE}:${srv.porta}/torna`);
  const q = await aspettaFinestraSu(NORMALE);
  expect(q, 'la seconda pagina deve aprirsi nella stessa scheda').not.toBeNull();
  await q.waitForSelector('#b', { timeout: 8000 });

  await metti(LISTA); // l'utente mette in lista il sito che ha appena lasciato

  await q.click('#b'); // history.back()
  await shell.waitForTimeout(2500);

  const ancora = finestreSu(LISTA);
  const viva = ancora.length
    ? await ancora[ancora.length - 1].evaluate(() => !!document.getElementById('t')).catch(() => false)
    : false;
  expect(viva, 'la pagina non deve poter tornare da sola sul sito della lista').toBe(false);
});

// ─── Porta P: il riquadro incorporato ────────────────────────────────────────

test('P — il sito della lista dentro un riquadro incorporato', async () => {
  await metti(LISTA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/incorpora`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina che incorpora deve aprirsi').not.toBeNull();
  await p.waitForSelector('#f', { timeout: 8000 });
  await shell.waitForTimeout(2500);
  // Il riquadro è di un altro sito, quindi dal documento che lo ospita non si
  // può guardare dentro: lo si chiede a chi vede i riquadri per davvero.
  let testo = '';
  for (const f of p.frames()) {
    let host = '';
    try { host = new URL(f.url()).hostname; } catch (_) { /* about:blank */ }
    if (host !== LISTA) continue;
    testo = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  }
  expect(testo.trim(), 'il contenuto del sito della lista non deve comparire nel riquadro').toBe('');
});

// ─── Porta Q: il permesso dato a mano si vede e si toglie? ───────────────────

test('Q — dopo «Apri comunque» il permesso si deve poter ritrovare e togliere', async () => {
  await metti(LISTA);
  // L'utente prova ad aprirlo, e sulla notifica dice di sì.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  const avviso = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(avviso).toBeVisible({ timeout: 6000 });
  await avviso.getByText('Apri comunque', { exact: true }).first().click();
  const aperta = await aspettaFinestraSu(LISTA);
  expect(aperta, '«Apri comunque» deve aprire davvero').not.toBeNull();

  // Il sì vale per tutta la sessione. Passata la notifica che lo annuncia,
  // l'utente deve poterlo ritrovare: la pagina delle Preferenze da cui ha
  // scritto la lista è l'unico posto dove andrebbe a cercarlo.
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://security/security.html');
  const pref = await aspettaFinestraSu(''); // le pagine interne non hanno hostname http
  const prefPage = pref || app.windows().find((w) => w.url().includes('security.html'));
  expect(prefPage, 'la pagina Sicurezza deve aprirsi').toBeTruthy();
  await prefPage.waitForLoadState('domcontentloaded');
  await prefPage.waitForTimeout(1200);
  const corpo = await prefPage.evaluate(() => document.body.innerText);
  expect(
    corpo.includes(LISTA) && /aperto|permess|comunque|consentit/i.test(corpo),
    'il permesso dato a mano deve essere visibile (e revocabile) dove l\'utente ha scritto la lista',
  ).toBe(true);
});
