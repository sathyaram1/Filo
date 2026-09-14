// Verifica #590 — giro 13.
//
// Due strade che nessuno dei dodici giri aveva percorso.
//
// PORTA CA — L'ECCEZIONE DEL MOTORE, PRESA DA UN SOTTODOMINIO.
//   L'eccezione «arrivo dai risultati di una ricerca» è stata stretta tre
//   volte: prima ancorando il nome (giro 1), poi pretendendo un percorso di
//   RISULTATI (giro 3), poi elencando i motori veri invece di descriverli
//   (giro 10). Quello che resta è un prodotto fra due insiemi larghi: il nome
//   vale per SUFFISSO (quindi ogni sottodominio di un motore), e i percorsi
//   sono un elenco UNICO valido per tutti i motori insieme (/search, /s,
//   /web, /html, …). Basta un sottodominio su cui il motore lascia pubblicare
//   a chiunque, servito a uno di quei percorsi, perché la pagina di un
//   estraneo si prenda l'eccezione.
//   Il caso reale: le pagine degli autori di Baidu stanno su
//   baijiahao.baidu.com e il loro indirizzo è /s?id=…, cioè uno dei percorsi
//   dell'elenco.
//
// PORTA CB — IL SITO DELLA LISTA COME RISORSA DI UN'ALTRA PAGINA.
//   Il giro 4 ha chiuso i riquadri incorporati dicendo che erano «l'ultimo
//   modo rimasto di mettere un sito della lista davanti agli occhi di chi non
//   lo voleva più vedere». Non lo erano: un'immagine, un filmato o uno script
//   serviti dal sito della lista continuano ad arrivare, e un'immagine grande
//   quanto lo schermo è esattamente la stessa cosa del riquadro grande quanto
//   lo schermo.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';               // scritto a mano dall'utente
const MOTORE = 'www.google.com';             // il motore vero, controllo
const AUTORE = 'baijiahao.baidu.com';        // sottodominio di un motore vero,
//                                              dove pubblica chiunque
const QUALUNQUE = 'qualunque.test';          // una pagina senza privilegi

// Un PNG 1×1, per provare che un'immagine è arrivata davvero.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==',
  'base64',
);

async function alzaServer() {
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const html = (c) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">${c}`);
    };

    if (host === LISTA) {
      if (path === '/foto.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
        return;
      }
      if (path === '/suo.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end('window.__ARRIVATO_DALLA_LISTA = true;');
        return;
      }
      html('<h1 id="t">SONO IL SITO DELLA LISTA</h1>');
      return;
    }

    // La pagina dei RISULTATI del motore vero: è l'eccezione dichiarata.
    if (host === MOTORE && path === '/search') {
      html('<h1 id="r">risultati</h1>'
        + `<p><a id="vai" href="http://${LISTA}:${porta}/pagina">il risultato</a></p>`);
      return;
    }

    // La pagina di un ESTRANEO, ospitata su un sottodominio del motore, al
    // percorso che l'elenco dei percorsi di ricerca riconosce.
    if (host === AUTORE && path === '/s') {
      if (query.includes('auto=1')) {
        html('<h1 id="a">articolo</h1>'
          + `<script>location.href='http://${LISTA}:${porta}/pagina'</script>`);
        return;
      }
      if (query.includes('riquadro=1')) {
        html('<h1 id="a">articolo</h1>'
          + `<iframe id="dentro" style="width:100vw;height:100vh;border:0" src="http://${LISTA}:${porta}/pagina"></iframe>`);
        return;
      }
      html('<h1 id="a">articolo di un autore qualunque</h1>'
        + `<p><a id="vai" href="http://${LISTA}:${porta}/pagina">guarda qui</a></p>`
        + `<p><a id="nuova" target="_blank" href="http://${LISTA}:${porta}/pagina">guarda qui, di là</a></p>`);
      return;
    }

    if (host === QUALUNQUE) {
      if (path === '/immagine') {
        html('<h1 id="q">una pagina qualunque</h1>'
          + `<img id="im" style="width:100vw;height:100vh" src="http://${LISTA}:${porta}/foto.png">`);
        return;
      }
      if (path === '/immagine-buona') {
        html('<h1 id="q">una pagina qualunque</h1>'
          + `<img id="im" style="width:100vw;height:100vh" src="http://${QUALUNQUE}:${porta}/foto.png">`);
        return;
      }
      if (path === '/foto.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
        return;
      }
      if (path === '/script') {
        html('<h1 id="q">una pagina qualunque</h1>'
          + `<script src="http://${LISTA}:${porta}/suo.js"></script>`);
        return;
      }
      html('<h1 id="q">una pagina qualunque</h1>'
        + `<p><a id="vai" href="http://${LISTA}:${porta}/pagina">guarda qui</a></p>`);
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

const MAPPA = [LISTA, MOTORE, AUTORE, QUALUNQUE].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g13-');
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

async function metti(lista) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: true, blacklist: h } } },
  }), lista);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) {
    await shell.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  }
  await shell.waitForTimeout(300);
}

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

async function notifiche() {
  return shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

async function aspettaPagina(pezzo, ms = 10000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of app.windows().reverse()) {
      if (w.isClosed()) continue;
      if (!String(w.url() || '').includes(pezzo)) continue;
      const viva = await w.evaluate(() => true).catch(() => false);
      if (viva) return w;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Il sito della lista è a schermo? (in una scheda o dentro un riquadro)
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

async function apri(url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta CA — l'eccezione presa da un sottodominio del motore ──────────────

test('CA0 — controllo: dai risultati veri del motore il sito della lista si apre (eccezione dichiarata)', async () => {
  await metti([LISTA]);
  await apri(`http://${MOTORE}:${srv.porta}/search?q=qualcosa`);
  const ris = await aspettaPagina('/search');
  expect(ris, 'la pagina dei risultati deve aprirsi').toBeTruthy();
  await ris.evaluate(() => document.getElementById('vai').click());
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'è l\'eccezione dichiarata: chi arriva dai risultati di una ricerca l\'ha cercato lui',
  ).toBe(true);
});

test('CA0b — controllo: da una pagina senza privilegi lo stesso link viene fermato', async () => {
  await metti([LISTA]);
  await apri(`http://${QUALUNQUE}:${srv.porta}/pagina`);
  const p = await aspettaPagina('qualunque.test');
  expect(p, 'la pagina qualunque deve aprirsi').toBeTruthy();
  await p.evaluate(() => document.getElementById('vai').click());
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'controllo: senza l\'eccezione il link deve essere fermato, altrimenti le prove qui sotto '
    + 'sarebbero verdi a vuoto',
  ).toBe(false);
});

test('CA1 — la pagina di un estraneo ospitata su un sottodominio del motore non deve prendersi l\'eccezione', async () => {
  await metti([LISTA]);
  await apri(`http://${AUTORE}:${srv.porta}/s?id=1234567890`);
  const art = await aspettaPagina('/s?id=');
  expect(art, 'l\'articolo deve aprirsi').toBeTruthy();
  await art.evaluate(() => document.getElementById('vai').click());
  await shell.waitForTimeout(3000);
  const dette = await notifiche();
  expect(
    await visibile(),
    'l\'eccezione vale per il nome di un motore CONFRONTATO PER SUFFISSO (quindi ogni suo '
    + 'sottodominio) più un elenco di percorsi valido per tutti i motori insieme. Un sottodominio '
    + 'su cui il motore lascia pubblicare a chiunque, servito a uno di quei percorsi, è la pagina '
    + 'di un estraneo che si prende il permesso di scavalcare il divieto scritto dall\'utente. '
    + `Notifiche a schermo: ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('CA2 — nemmeno portandoci la scheda da sola, senza un clic', async () => {
  await metti([LISTA]);
  await apri(`http://${AUTORE}:${srv.porta}/s?id=1234567890&auto=1`);
  await shell.waitForTimeout(3500);
  const dette = await notifiche();
  expect(
    await visibile(),
    'se la pagina dell\'estraneo può anche eseguire codice, non le serve nemmeno il clic '
    + `dell'utente. Notifiche a schermo: ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('CA3 — nemmeno dentro un riquadro grande quanto lo schermo', async () => {
  await metti([LISTA]);
  await apri(`http://${AUTORE}:${srv.porta}/s?id=1234567890&riquadro=1`);
  await shell.waitForTimeout(3500);
  const dette = await notifiche();
  expect(
    await visibile(),
    'il riquadro incorporato chiede la stessa decisione, e la pagina che lo ospita è quella che '
    + `concede l'eccezione. Notifiche a schermo: ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('CA4 — nemmeno in una scheda nuova aperta da quella pagina', async () => {
  await metti([LISTA]);
  await apri(`http://${AUTORE}:${srv.porta}/s?id=1234567890`);
  const art = await aspettaPagina('/s?id=');
  expect(art, 'l\'articolo deve aprirsi').toBeTruthy();
  await art.evaluate(() => document.getElementById('nuova').click());
  await shell.waitForTimeout(3500);
  const dette = await notifiche();
  expect(
    await visibile(),
    `la scheda nuova si porta dietro la pagina che l'ha chiesta. Notifiche: ${JSON.stringify(dette)}`,
  ).toBe(false);
});

// ─── Porta CB — il sito della lista come risorsa di un'altra pagina ──────────

async function immagineArrivata(pezzoUrl) {
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      if (!String(f.url() || '').includes(pezzoUrl)) continue;
      const ok = await f.evaluate(() => {
        const im = document.getElementById('im');
        return !!(im && im.naturalWidth > 0);
      }).catch(() => null);
      if (ok !== null) return ok;
    }
  }
  return null;
}

test('CB0 — controllo: un\'immagine di un sito che non è in lista arriva', async () => {
  await metti([LISTA]);
  await apri(`http://${QUALUNQUE}:${srv.porta}/immagine-buona`);
  await aspettaPagina('/immagine-buona');
  await shell.waitForTimeout(2000);
  expect(
    await immagineArrivata('/immagine-buona'),
    'controllo: le immagini normali devono arrivare, altrimenti la prova qui sotto è verde a vuoto',
  ).toBe(true);
});

test('CB1 — un\'immagine servita dal sito della lista, grande quanto lo schermo, non deve arrivare', async () => {
  await metti([LISTA]);
  await apri(`http://${QUALUNQUE}:${srv.porta}/immagine`);
  await aspettaPagina('/immagine');
  await shell.waitForTimeout(2000);
  const dette = await notifiche();
  expect(
    await immagineArrivata('/immagine'),
    'il giro 4 ha chiuso i riquadri incorporati dicendo che erano l\'ultimo modo rimasto di '
    + 'mettere un sito della lista davanti agli occhi di chi non lo voleva più vedere. '
    + 'Un\'immagine grande quanto lo schermo è la stessa cosa, e la sceglie la pagina, non '
    + `l'utente. Notifiche a schermo: ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('CB2 — nemmeno uno script servito dal sito della lista deve girare dentro un\'altra pagina', async () => {
  await metti([LISTA]);
  await apri(`http://${QUALUNQUE}:${srv.porta}/script`);
  await aspettaPagina('/script');
  await shell.waitForTimeout(2000);
  let arrivato = null;
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      if (!String(f.url() || '').includes('/script')) continue;
      const r = await f.evaluate(() => !!window.__ARRIVATO_DALLA_LISTA).catch(() => null);
      if (r !== null) arrivato = r;
    }
  }
  expect(
    arrivato,
    'stessa porta dell\'immagine: la lista guarda solo dove va la SCHEDA, e tutto quello che una '
    + 'pagina si tira dentro dal sito della lista continua ad arrivare',
  ).toBe(false);
});
