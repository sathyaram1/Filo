// Verifica #590 — giro 12.
//
// Gli undici giri prima hanno chiuso le strade con cui si ARRIVA su un sito
// della lista. Qui si provano quattro cose che nessuno di quei giri ha toccato,
// tutte sul CONFINE fra il blocco e ciò che resta a schermo dopo:
//
// Porta BB — LA FINESTRELLA DI ACCESSO CHE RIMBALZA. Il giro 4 ha chiuso la
//            finestrella il cui PRIMO indirizzo sta in lista: lì la finestra
//            non nasce affatto. Ma un indirizzo di accesso innocuo che il
//            server rimbalza sul sito della lista la fa nascere lo stesso, e
//            il rimbalzo viene fermato un istante dopo: cosa resta a schermo?
//            Per la scheda lo stesso caso è già stato pagato e tolto (giro 2:
//            la scheda rimasta vuota viene chiusa).
// Porta BC — DUPLICA SCHEDA. Il giro 11 ha trovato che un sito messo in lista
//            mentre lo si guarda resta a schermo. Da quella scheda la voce
//            «Duplica» del menu del tasto destro è a un clic di distanza.
// Porta BD — IL MODULO INVIATO VERSO UNA SCHEDA NUOVA. Il giro 5 ha provato il
//            modulo che cambia pagina alla scheda in cui sta (GET e POST);
//            con target="_blank" la strada è un'altra (la scheda nuova).
// Porta BE — L'APERTURA CHIESTA AL MODELLO IN SECONDO PIANO. NAVIGA ha un
//            parametro `background`: la scheda nasce dietro, senza passare in
//            primo piano. È la forma in cui una pagina ostile chiederebbe
//            l'apertura per farsi notare il meno possibile.
// Porta BF — LA BARRA DELL'INDIRIZZO DOPO UN BLOCCO. Se dopo un rifiuto la
//            barra resta sull'indirizzo bloccato, dice all'utente che si trova
//            su un sito su cui non è.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';   // scritto a mano dall'utente
const NORMALE = 'giornale.test'; // una pagina qualunque

async function alzaServer() {
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const html = (c) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">${c}`);
    };

    if (host === LISTA) {
      html('<h1 id="t">SONO IL SITO DELLA LISTA</h1>');
      return;
    }

    // giornale.test — la pagina qualunque da cui partono tutte le prove.
    if (path === '/login') {
      // Un indirizzo che SOMIGLIA a un accesso (basta il percorso /login) e che
      // il server rimbalza sul sito della lista.
      res.writeHead(302, { Location: `http://${LISTA}:${porta}/pagina` });
      res.end();
      return;
    }
    if (path === '/signin') {
      html('<h1 id="acc">la pagina di accesso vera</h1>');
      return;
    }
    if (path === '/apre-accesso') {
      // Il clic ce lo mette l'utente: senza un gesto vero Chromium non apre
      // nessuna finestrella, e la prova resterebbe verde a vuoto.
      html('<h1 id="n">pagina qualunque</h1>'
        + `<button id="b" onclick="window.open('http://${NORMALE}:${porta}/login',`
        + " '_blank', 'width=500,height=400')\">accedi</button>");
      return;
    }
    if (path === '/apre-accesso-diritto') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<button id="b" onclick="window.open('http://${NORMALE}:${porta}/signin',`
        + " '_blank', 'width=500,height=400')\">accedi</button>");
      return;
    }
    if (path === '/modulo-scheda-nuova') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<form id="m" method="post" target="_blank" action="http://${LISTA}:${porta}/pagina">`
        + '<input name="a" value="1"></form>'
        + '<script>setTimeout(() => document.getElementById("m").submit(), 200);</script>');
      return;
    }
    html('<h1 id="n">pagina qualunque</h1>');
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

const MAPPA = [LISTA, NORMALE].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g12-');
  mkdirSync(join(userData, 'adblock'), { recursive: true });
  writeFileSync(
    join(userData, 'adblock', 'lists.json'),
    JSON.stringify({ updatedAt: Date.now(), count: 0, domains: [] }),
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

async function metti(lista, { listePubbliche = true, popup = true } = {}) {
  await shell.evaluate(([h, lp, bp]) => window.filoShell.message({
    type: 'update_settings',
    settings: {
      security: {
        blockPopups: bp,
        siteBlock: { enabled: true, useAdblockLists: lp, blacklist: h },
      },
    },
  }), [lista, listePubbliche, popup]);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) {
    await shell.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  }
  await shell.waitForTimeout(300);
}

// C'è a schermo, da qualche parte (scheda, riquadro, finestrella), la pagina
// del sito della lista?
async function visibile(id = 't') {
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      let h = '';
      try { h = new URL(f.url() || '').hostname; } catch (_) { continue; }
      if (h !== LISTA) continue;
      if (await f.evaluate((x) => !!document.getElementById(x), id).catch(() => false)) return true;
    }
  }
  return false;
}

// Le finestre VERE di Filo, viste dal main process: la shell, le finestrelle di
// accesso, le finestre incognito. Le finestre di servizio (menu del tasto
// destro, suggerimento) caricano un data: e non contano.
async function finestreDiFilo() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
    let url = '';
    try { url = w.webContents.getURL() || ''; } catch (_) {}
    let titolo = '';
    try { titolo = w.getTitle() || ''; } catch (_) {}
    return {
      url,
      titolo,
      visibile: (() => { try { return w.isVisible(); } catch (_) { return false; } })(),
      larghezza: (() => { try { return w.getBounds().width; } catch (_) { return 0; } })(),
    };
  }).filter((w) => !w.url.startsWith('data:')));
}

async function schede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return snap.tabs;
}

function schedeSu(tabs, host) {
  return tabs.filter((t) => { try { return new URL(t.url).hostname === host; } catch (_) { return false; } });
}

function finestreSu(host) {
  return app.windows().filter((w) => {
    if (w.isClosed()) return false;
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  });
}

async function aspettaPaginaSu(host, ms = 8000) {
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

// Apre la pagina che ospita il bottone e lo clicca: la finestrella di accesso
// nasce da un gesto vero dell'utente, come nella vita.
async function cliccaAccedi(percorso) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}${percorso}`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina che ospita il bottone deve aprirsi').toBeTruthy();
  await p.locator('#b').click();
}

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

async function notifiche() {
  return shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta BB: la finestrella di accesso che rimbalza ────────────────────────

test('BB0 — controllo: senza la lista, quella finestrella arriva davvero sul sito', async () => {
  await metti([]);
  await cliccaAccedi('/apre-accesso');
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'se con la lista vuota la finestrella non ci arriva, le prove qui sotto non dimostrano niente',
  ).toBe(true);
});

test('BB1 — la finestrella di accesso non deve arrivare sul sito della lista per rimbalzo', async () => {
  await metti([LISTA]);
  await cliccaAccedi('/apre-accesso');
  await shell.waitForTimeout(3000);
  expect(await visibile(), 'il rimbalzo dentro la finestrella deve essere fermato').toBe(false);
});

test('BB2 — fermato il rimbalzo, non deve restare a schermo una finestrella vuota', async () => {
  await metti([LISTA]);
  await cliccaAccedi('/apre-accesso');
  await shell.waitForTimeout(3500);
  const finestre = await finestreDiFilo();
  // La finestrella fermata non ha mai caricato niente: né indirizzo né titolo.
  const vuote = finestre.filter((w) => !w.url || w.url === 'about:blank');
  expect(
    vuote.length,
    'la finestrella di accesso era già nata quando il rimbalzo è stato fermato: resta a schermo '
    + 'senza indirizzo, senza titolo e senza contenuto, e va chiusa a mano. Per la SCHEDA lo '
    + 'stesso caso è già stato chiuso (la scheda rimasta vuota viene chiusa da sola). '
    + `Finestre viste: ${JSON.stringify(finestre)}`,
  ).toBe(0);
});

test('BB3 — controllo: una finestrella di accesso che NON rimbalza resta aperta e carica', async () => {
  await metti([LISTA]);
  await cliccaAccedi('/apre-accesso-diritto');
  await shell.waitForTimeout(3000);
  const finestre = await finestreDiFilo();
  expect(
    finestre.some((w) => w.url.includes('/signin')),
    'una finestrella di accesso legittima deve continuare ad aprirsi: se la chiusura della '
    + `finestra vuota la portasse via, sarebbe peggio del difetto. Finestre: ${JSON.stringify(finestre)}`,
  ).toBe(true);
});

// ─── Porta BC: Duplica scheda ────────────────────────────────────────────────

test('BC — duplicare una scheda su un sito finito in lista non deve aprirne una seconda', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2500);
  const prima = schedeSu(await schede(), LISTA);
  expect(prima.length, 'la scheda di partenza deve esserci').toBe(1);

  // Adesso l'utente mette quel sito in lista, mentre ce l'ha davanti.
  await metti([LISTA]);
  await pulisciNotifiche();

  await shell.evaluate((id) => window.filoShell.tabs.duplicate(id), prima[0].id);
  await shell.waitForTimeout(2500);

  const dopo = schedeSu(await schede(), LISTA);
  const dette = await notifiche();
  expect(
    dopo.length,
    'la voce «Duplica» del menu del tasto destro apre una scheda NUOVA su quell\'indirizzo: '
    + 'è una nuova apertura come le altre e deve incontrare la lista. '
    + `Schede sul sito della lista: ${dopo.length}. Notifiche: ${JSON.stringify(dette)}`,
  ).toBe(1);
});

// ─── Porta BD: il modulo inviato verso una scheda nuova ──────────────────────

test('BD0 — controllo: senza la lista, il modulo con target=_blank arriva davvero', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/modulo-scheda-nuova`);
  await shell.waitForTimeout(3000);
  expect(await visibile(), 'senza lista il modulo deve arrivare sul sito').toBe(true);
});

test('BD — un modulo inviato verso una scheda nuova non deve aprire il sito della lista', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/modulo-scheda-nuova`);
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'il giro 5 ha chiuso il modulo che cambia pagina alla scheda in cui sta; con target="_blank" '
    + 'la scheda è un\'altra',
  ).toBe(false);
});

// ─── Porta BE: l'apertura chiesta al modello in secondo piano ────────────────

test('BE — NAVIGA in secondo piano verso il sito della lista deve essere fermato', async () => {
  await metti([LISTA]);
  const esito = await app.evaluate((_e, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }),
  `http://${LISTA}:${srv.porta}/pagina`);
  await shell.waitForTimeout(1500);
  expect(esito.executed, 'l\'apertura in secondo piano non deve essere eseguita').toBe(false);
  expect(schedeSu(await schede(), LISTA).length, 'nessuna scheda sul sito della lista').toBe(0);
});

test('BE2 — e la chat lo dice anche quando la scheda sarebbe nata dietro', async () => {
  await metti([LISTA]);
  const esito = await app.evaluate((_e, url) =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }),
  `http://${LISTA}:${srv.porta}/pagina`);
  expect(
    esito.output && esito.output.blocked,
    `l'esito deve dire che a fermare è stata la lista. Esito: ${JSON.stringify(esito)}`,
  ).toBe('site');
});

// ─── Porta BF: la barra dell'indirizzo dopo un blocco ────────────────────────

test('BF — dopo un blocco la scheda non deve dichiarare di stare sul sito della lista', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2000);
  const tabs = await schede();
  const mia = tabs.find((t) => { try { return new URL(t.url).hostname === NORMALE; } catch (_) { return false; } });
  expect(mia, 'la scheda di partenza deve esserci').toBeTruthy();

  await shell.evaluate(([id, u]) => window.filoShell.tabs.navigate(id, u),
    [mia.id, `http://${LISTA}:${srv.porta}/pagina`]);
  await shell.waitForTimeout(2000);

  const dopo = (await schede()).find((t) => t.id === mia.id);
  expect(await visibile(), 'il sito non deve aprirsi').toBe(false);
  expect(
    dopo && new URL(dopo.url).hostname,
    'la scheda è rimasta dov\'era: l\'indirizzo che la shell mostra deve essere quello della '
    + `pagina che si vede, non quello rifiutato. Scheda: ${JSON.stringify(dopo)}`,
  ).toBe(NORMALE);
});
