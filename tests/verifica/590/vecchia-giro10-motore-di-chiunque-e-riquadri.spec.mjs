// Verifica #590 — giro 10.
//
// I nove giri prima hanno chiuso le strade con cui si ARRIVA su un sito della
// lista e hanno sistemato cosa succede una volta arrivati. Qui si torna sul
// punto che la segnalazione nominava per primo — l'eccezione "vengo da un
// motore di ricerca" — da un lato che nessuno ha provato, e si prova l'ultimo
// modo rimasto di mettere una pagina dentro un'altra.
//
// Porta AS — UN MOTORE CHE SI COMPRA. La segnalazione chiedeva di ancorare al
//            nome dell'host la regola che riconosce le istanze SearX, e il giro
//            1 l'ha fatto: searx.qualunque.com non concede più l'eccezione. Ma
//            l'ancora tiene fermo solo il PEZZO DAVANTI: searx.<estensione>
//            resta buono, e quel nome lo registra chiunque per pochi euro. Da
//            lì l'eccezione vale, e con lei cade la lista.
// Porta AT — <object> e <embed>. Il giro 4 ha chiuso i riquadri incorporati
//            (<iframe>). Una pagina però ha altri due modi di mettersi dentro
//            un sito intero, e sono vecchi quanto il web.
// Porta AU — UN RIQUADRO CHE PORTA ALTROVE LA SCHEDA. Il riquadro incorporato
//            può cambiare l'indirizzo della SCHEDA che lo ospita (target=_top).

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';          // scritto a mano dall'utente
const NORMALE = 'giornale.test';        // una pagina qualunque
const FINTO = 'searx.cheap';            // un nome che chiunque registra
const FINTO_NO = 'searx.qualunque.com'; // controllo: il giro 1 l'ha chiuso
const MOTORE = 'www.google.com';        // un motore vero

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
    if (host === FINTO || host === FINTO_NO) {
      // La pagina che chiunque può pubblicare su un nome comprato: la serve al
      // percorso dei risultati, che è esattamente dove un'istanza SearX serve i
      // suoi (e su un nome proprio quel percorso lo si scrive come si vuole).
      const q = (req.url.split('?')[1] || '');
      if (path === '/search' && /vai/.test(q)) {
        html('<h1 id="f">finti risultati</h1><script>'
          + `setTimeout(() => { location.href = "http://${LISTA}:${porta}/pagina"; }, 200);`
          + '</script>');
        return;
      }
      if (path === '/search' && /scheda/.test(q)) {
        html('<h1 id="f">finti risultati</h1><script>'
          + `setTimeout(() => { window.open("http://${LISTA}:${porta}/pagina", "_blank"); }, 200);`
          + '</script>');
        return;
      }
      if (path === '/search' && /riquadro/.test(q)) {
        html('<h1 id="f">finti risultati</h1><script>'
          + 'setTimeout(() => { const f = document.createElement("iframe"); '
          + `f.src = "http://${LISTA}:${porta}/pagina"; f.width = 900; f.height = 600; `
          + 'document.body.appendChild(f); }, 200);'
          + '</script>');
        return;
      }
      html('<h1 id="f">finti risultati</h1>');
      return;
    }
    if (host === MOTORE) {
      html('<h1>motore</h1>');
      return;
    }
    // giornale.test — una pagina qualunque.
    if (path === '/object') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<object id="o" data="http://${LISTA}:${porta}/pagina" width="900" height="600"></object>`);
      return;
    }
    if (path === '/embed') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<embed id="e" src="http://${LISTA}:${porta}/pagina" width="900" height="600">`);
      return;
    }
    if (path === '/iframe-top') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<iframe id="f" src="http://${NORMALE}:${porta}/dentro-il-riquadro" width="600" height="400"></iframe>`);
      return;
    }
    if (path === '/dentro-il-riquadro') {
      html(`<a id="su" target="_top" href="http://${LISTA}:${porta}/pagina">portami fuori</a>`);
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

const MAPPA = [LISTA, NORMALE, FINTO, FINTO_NO, MOTORE]
  .map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g10-');
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

// C'è a schermo, da qualche parte (scheda o riquadro), la pagina del sito
// della lista?
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

// ─── Porta AS: un motore che si compra ───────────────────────────────────────
//
// La segnalazione: «l'eccezione "vengo da un motore di ricerca" usa la regex
// /(^|\.)searx\b/ senza ancora finale, quindi searx.qualunque.com la prende».
// L'ancora c'è, ma ancora solo la parte davanti: searx.<estensione> passa, e
// quel nome lo registra chiunque.

test('AS1 — una pagina su un nome searx comprato non deve aprire il sito della lista', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${FINTO}:${srv.porta}/search?q=vai`);
  await shell.waitForTimeout(2500);
  const aperto = await visibile();
  const dette = await notifiche();
  expect(
    aperto,
    'una pagina ospitata su un nome che chiunque registra (searx.<estensione>) si prende '
    + "l'eccezione del motore di ricerca e porta la scheda sul sito della lista: "
    + `notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('AS2 — dalla stessa pagina, il sito della lista aperto in una SCHEDA NUOVA', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${FINTO}:${srv.porta}/search?q=scheda`);
  await shell.waitForTimeout(2500);
  expect(await visibile(), 'la scheda nuova aperta da un finto motore comprato non deve arrivare').toBe(false);
});

test('AS3 — dalla stessa pagina, il sito della lista dentro un riquadro', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${FINTO}:${srv.porta}/search?q=riquadro`);
  await shell.waitForTimeout(2500);
  expect(await visibile(), 'il riquadro aperto da un finto motore comprato non deve caricare il sito della lista').toBe(false);
});

test('AS0 — controllo: il finto motore chiuso dal giro 1 resta chiuso', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${FINTO_NO}:${srv.porta}/search?q=vai`);
  await shell.waitForTimeout(2500);
  expect(await visibile(), 'searx.qualunque.com non deve concedere l\'eccezione (giro 1)').toBe(false);
});

// ─── Porta AT: <object> e <embed> ────────────────────────────────────────────

test('AT1 — un sito della lista messo dentro <object> non deve vedersi', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/object`);
  await shell.waitForTimeout(2500);
  const aperto = await visibile();
  const dette = await notifiche();
  expect(
    aperto,
    'il giro 4 ha chiuso i riquadri <iframe>; <object> mette dentro la pagina lo stesso sito intero '
    + `e non incontra la lista: notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('AT2 — lo stesso con <embed>', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/embed`);
  await shell.waitForTimeout(2500);
  expect(await visibile(), '<embed> mette dentro la pagina il sito della lista').toBe(false);
});

// ─── Porta AU: un riquadro che porta altrove la scheda ───────────────────────

test('AU — un riquadro incorporato non deve poter portare la SCHEDA sul sito della lista', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/iframe-top`);
  const pagina = await aspettaPaginaSu(NORMALE);
  expect(pagina, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await pagina.waitForSelector('#n', { timeout: 5000 });
  const riquadro = pagina.frames().find((f) => /dentro-il-riquadro/.test(f.url() || ''));
  expect(riquadro, 'il riquadro deve esserci').toBeTruthy();
  await riquadro.evaluate(() => document.getElementById('su').click());
  await shell.waitForTimeout(2500);
  const aperto = await visibile();
  const dette = await notifiche();
  expect(
    aperto,
    'un link dentro un riquadro incorporato, con target=_top, cambia indirizzo alla SCHEDA e '
    + `arriva sul sito della lista: notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});
