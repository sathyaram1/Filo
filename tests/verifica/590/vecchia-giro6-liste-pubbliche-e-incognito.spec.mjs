// Verifica #590 — giro 6. Due cose che nessuno dei cinque giri prima aveva
// toccato.
//
// Porta AB — LE LISTE PUBBLICHE. La lista dei siti bloccati ha due sorgenti:
//            i siti che l'utente scrive a mano e le liste pubbliche dell'ad
//            blocker (di serie ACCESE). Il lavoro ha esteso il controllo ai
//            RIQUADRI incorporati in una pagina, e i riquadri sono esattamente
//            il posto dove vivono le pubblicità: una pagina qualunque del web
//            vero ne incorpora una decina, di domini diversi. Qui si guarda
//            cosa vede l'utente quando apre una pagina così.
// Porta AC — LA FINESTRA IN INCOGNITO. È una finestra con schede sue: la lista
//            dei siti bloccati deve valere anche lì, su tutte le strade.
//
// Le due porte stanno in un file solo perché condividono il mini server.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'blocked.test';       // scritto a mano dall'utente
const NORMALE = 'innocuo.test';     // la pagina di partenza
// I domini "pubblicitari": stanno nelle liste pubbliche, non nella lista
// dell'utente. Sono quattro, come su una pagina di giornale qualunque.
const PUBBLICITA = ['adserver.test', 'tracker.test', 'banner.test', 'metriche.test'];

async function alzaServer() {
  let porta = 0;
  const pagina = (corpo) => `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    if (host === LISTA) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="t">SONO IL SITO DELLA LISTA</h1>'));
      return;
    }
    if (PUBBLICITA.includes(host) && path !== '/clic') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<p id="ad">riquadro pubblicitario</p>'));
      return;
    }
    // Una pagina di giornale: testo, e quattro riquadri di quattro pubblicità
    // diverse. È la forma del web vero.
    if (path === '/giornale') {
      const riquadri = PUBBLICITA
        .map((h, i) => `<iframe id="ad${i}" src="http://${h}:${porta}/riquadro" width="300" height="80"></iframe>`)
        .join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<h1 id="n">Notizie del giorno</h1><p>testo</p>${riquadri}`));
      return;
    }
    // La stessa pagina, ma il riquadro è il sito che l'UTENTE ha messo in lista.
    if (path === '/incorpora-lista') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<h1 id="n">pagina</h1><iframe id="f" src="http://${LISTA}:${porta}/dentro" width="600" height="400"></iframe>`));
      return;
    }
    // Un link che passa per un CONTATORE DI CLIC prima di arrivare a
    // destinazione: è la forma di mezzo web (i link sponsorizzati, quelli dei
    // giornali, quelli delle newsletter), e i contatori stanno nelle liste
    // pubbliche.
    // Il link punta a un indirizzo del sito che si sta leggendo: è quello a
    // rimbalzare sul contatore, e solo dopo sull'articolo. Nessun controllo
    // vede il contatore finché il server non risponde.
    if (path === '/link-tracciato') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<a id="go" href="http://${NORMALE}:${porta}/vai-via">leggi l'articolo</a>`));
      return;
    }
    if (path === '/vai-via') {
      res.writeHead(302, { Location: `http://${PUBBLICITA[1]}:${porta}/clic` });
      res.end();
      return;
    }
    if (path === '/clic') {
      res.writeHead(302, { Location: `http://${NORMALE}:${porta}/destinazione` });
      res.end();
      return;
    }
    if (path === '/destinazione') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('<h1 id="dest">ARTICOLO</h1>'));
      return;
    }
    if (path === '/link') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(`<a id="go" href="http://${LISTA}:${porta}/arrivo">vai</a>`));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pagina('<h1 id="n">pagina qualunque</h1>'));
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

const MAPPA = [LISTA, NORMALE, ...PUBBLICITA].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g6-');
  // LE LISTE PUBBLICHE, com'è la macchina di un utente qualunque: Filo le
  // scarica da solo (StevenBlack + EasyList, decine di migliaia di domini
  // pubblicitari) e le tiene qui. Le scriviamo a mano per non toccare la rete.
  mkdirSync(join(userData, 'adblock'), { recursive: true });
  writeFileSync(
    join(userData, 'adblock', 'lists.json'),
    JSON.stringify({ updatedAt: Date.now(), count: PUBBLICITA.length, domains: PUBBLICITA }),
    'utf8',
  );
  app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${MAPPA}`, '.'],
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

async function metti(lista, { listePubbliche = true } = {}) {
  await shell.evaluate(([h, lp]) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: lp, blacklist: h } } },
  }), [lista, listePubbliche]);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede(w = shell) {
  const snap = await w.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) {
    await w.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  }
  await w.waitForTimeout(300);
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

async function sitoDellaListaVisibile() {
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      let h = '';
      try { h = new URL(f.url() || '').hostname; } catch (_) { continue; }
      if (h !== LISTA) continue;
      if (await f.evaluate(() => !!document.getElementById('t')).catch(() => false)) return true;
    }
  }
  return false;
}

async function pulisciNotifiche(w = shell) {
  await w.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

// Quante notifiche ha davanti l'utente, e cosa dicono.
async function notifiche(w = shell) {
  return w.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta AB: le liste pubbliche dentro i riquadri ──────────────────────────

test('AB — una pagina con le sue pubblicità non deve riempire lo schermo di notifiche', async () => {
  // La lista scritta a mano dall'utente è VUOTA: qui a fermare i riquadri sono
  // soltanto le liste pubbliche dell'ad blocker, che Filo ha sempre applicato
  // in silenzio (annulla la richiesta e non dice niente).
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/giornale`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina deve aprirsi').not.toBeNull();
  await shell.waitForTimeout(3000);

  const viste = await notifiche();
  const perRiquadri = viste.filter((t) => t.includes('non è stato caricato'));
  expect(
    perRiquadri.length,
    `aprendo una pagina qualunque l'ad blocker deve restare silenzioso come è sempre stato; invece è arrivata una notifica per ogni dominio pubblicitario: ${JSON.stringify(perRiquadri)}`,
  ).toBe(0);
});

test('AB2 — controllo: il sito che l\'UTENTE ha messo in lista, dentro un riquadro, lo dice', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/incorpora-lista`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina deve aprirsi').not.toBeNull();
  await shell.waitForTimeout(3000);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve caricarsi dentro un riquadro').toBe(false);
  const viste = await notifiche();
  expect(
    viste.filter((t) => t.includes('non è stato caricato')).length,
    'del riquadro tolto per la lista scritta dall\'utente si deve dire una volta',
  ).toBe(1);
});

// Scritta durante il giro come "l'articolo deve arrivare", e corretta dopo
// averla guardata meglio: l'articolo non arriva nemmeno senza la lista, perché
// le richieste verso i domini delle liste pubbliche le annulla il filtro delle
// richieste, che viene prima ed esisteva già. Quello che il lavoro aveva
// aggiunto, e che qui si controlla, è la notifica "Sito bloccato" che nominava
// all'utente un contatore di clic mai visto offrendogli di aprirlo.
test('AB3 — un link che passa per un contatore di clic non deve far comparire «Sito bloccato»', async () => {
  // Anche qui la lista scritta dall'utente è vuota: il contatore sta solo nelle
  // liste pubbliche dell'ad blocker. Un link così è la forma normale dei link
  // sponsorizzati, di quelli dei giornali e delle newsletter.
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-tracciato`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(3000);

  expect(
    await notifiche(),
    'la lista dei siti bloccati non c\'entra niente con un contatore di clic',
  ).toEqual([]);
});

// ─── Porta AC: la finestra in incognito ──────────────────────────────────────

test('AC — in incognito la lista dei siti bloccati vale come nella finestra normale', async () => {
  await metti([LISTA]);
  await shell.evaluate(() => window.filoShell.openIncognito());

  // La shell della finestra incognito.
  let inc = null;
  const fine = Date.now() + 10000;
  while (Date.now() < fine && !inc) {
    inc = app.windows().find((w) => !w.isClosed() && (w.url() || '').includes('incognito=1')) || null;
    if (!inc) await new Promise((r) => setTimeout(r, 200));
  }
  expect(inc, 'la finestra incognito deve aprirsi').not.toBeNull();
  await inc.waitForLoadState('domcontentloaded');
  await inc.waitForTimeout(800);

  // 1) apertura chiesta dal modello / dalla barra della home.
  await inc.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await inc.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'in incognito il sito della lista non deve aprirsi').toBe(false);
  await expect(inc.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });

  // 2) un link cliccato in una pagina.
  await pulisciNotifiche(inc);
  await inc.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link`);
  const q = await aspettaFinestraSu(NORMALE);
  expect(q, 'la pagina col link deve aprirsi in incognito').not.toBeNull();
  await q.waitForSelector('#go', { timeout: 8000 });
  await q.evaluate(() => document.getElementById('go').click());
  await inc.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'nemmeno da un link, in incognito').toBe(false);

  await inc.evaluate(() => window.close()).catch(() => {});
});
