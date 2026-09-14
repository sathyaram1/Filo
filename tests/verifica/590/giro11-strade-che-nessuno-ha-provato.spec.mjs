// Verifica #590 — giro 11.
//
// I dieci giri prima hanno chiuso le strade con cui si ARRIVA su un sito della
// lista (indirizzo scritto, link, finestrella, azione del modello, rimbalzo del
// server, riquadro incorporato, <object>, <embed>, avanti/indietro, ricarica,
// rinvio scritto nella pagina, modulo inviato) e hanno stretto l'eccezione del
// motore di ricerca a un elenco di motori veri.
//
// Qui si provano i modi di portare una scheda altrove che NON passano né da un
// link, né da un rimbalzo 301/302, né da una riga di JavaScript:
//
// Porta AV — IL RINVIO DICHIARATO NELL'INTESTAZIONE. Il server risponde 200 con
//            la pagina, e in testa alla risposta scrive «fra zero secondi vai
//            qui». Non è un rimbalzo (non è un 301/302) e non è scritto nella
//            pagina (non è un meta refresh): è una terza cosa, vecchia quanto
//            il web e ancora usata.
// Porta AW — LA PAGINA DIVISA IN RIQUADRI (<frameset>/<frame>). Il giro 4 ha
//            chiuso <iframe> e il giro 10 <object> e <embed>. Resta il modo più
//            antico di mettere un sito intero dentro una pagina.
// Porta AY — IL LINK CHE APRE UNA SCHEDA NUOVA DA DENTRO UN RIQUADRO. Il giro
//            10 ha provato il link che cambia indirizzo alla scheda che ospita
//            il riquadro (target=_top); qui il riquadro apre una scheda nuova.
// Porta AZ — IL FILE PRESO DAL SITO DELLA LISTA. Una pagina qualunque offre da
//            scaricare un file che sta sul sito della lista.
// Porta BA — IL SITO MESSO IN LISTA MENTRE LO SI STA GUARDANDO.

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

let chieste = [];

async function alzaServer() {
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    chieste.push(`${host}${path}`);
    const html = (c, head = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...head });
      res.end(`<!doctype html><meta charset="utf-8">${c}`);
    };

    if (host === LISTA) {
      if (path === '/file.bin') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="preso.bin"',
        });
        res.end('dodici byte');
        return;
      }
      html('<h1 id="t">SONO IL SITO DELLA LISTA</h1>'
        + '<p><a id="dentro" href="/altra">un link interno</a></p>');
      return;
    }

    // giornale.test — la pagina qualunque da cui partono tutte le prove.
    if (path === '/intestazione') {
      // Il rinvio dichiarato dal SERVER in testa alla risposta: non è un
      // 301/302 e non è scritto dentro la pagina.
      html('<h1 id="n">pagina qualunque</h1>', {
        Refresh: `0; url=http://${LISTA}:${porta}/pagina`,
      });
      return;
    }
    if (path === '/frameset') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head>'
        + `<frameset rows="100%"><frame id="f" src="http://${LISTA}:${porta}/pagina"></frameset></html>`);
      return;
    }
    if (path === '/scheda-vuota') {
      html('<h1 id="n">pagina qualunque</h1><script>'
        + 'setTimeout(() => { const w = window.open("about:blank", "_blank"); '
        + `setTimeout(() => { try { w.location.href = "http://${LISTA}:${porta}/pagina"; } catch (e) {} }, 400); }, 200);`
        + '</script>');
      return;
    }
    if (path === '/riquadro-scheda') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<iframe id="r" src="http://${NORMALE}:${porta}/dentro-riquadro" width="600" height="400"></iframe>`);
      return;
    }
    if (path === '/dentro-riquadro') {
      html(`<a id="su" target="_blank" href="http://${LISTA}:${porta}/pagina">apri di là</a>`);
      return;
    }
    if (path === '/scarica') {
      html('<h1 id="n">pagina qualunque</h1>'
        + `<a id="d" download href="http://${LISTA}:${porta}/file.bin">prendi il file</a>`);
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
  userData = cartellaTemporanea('filo-test-590g11-');
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

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

async function notifiche() {
  return shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
  chieste = [];
});

// ─── Porta AV: il rinvio dichiarato nell'intestazione della risposta ─────────

test('AV — un rinvio dichiarato in testa alla risposta non deve portare sul sito della lista', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/intestazione`);
  await shell.waitForTimeout(3000);
  const aperto = await visibile();
  const dette = await notifiche();
  expect(
    aperto,
    'il server risponde con la pagina e in testa dichiara «fra zero secondi vai sul sito della '
    + 'lista»: non è un rimbalzo 301/302 (giro 2) né un rinvio scritto dentro la pagina (giro 5), '
    + `e la scheda ci arriva lo stesso. Notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('AV0 — controllo: senza la lista, quel rinvio porta davvero sul sito', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/intestazione`);
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'se con la lista vuota il rinvio non arriva, la prova qui sopra non dimostra niente',
  ).toBe(true);
});

// ─── Porta AW: la pagina divisa in riquadri ─────────────────────────────────

test('AW — un sito della lista dentro un <frameset> non deve vedersi', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/frameset`);
  await shell.waitForTimeout(3000);
  const aperto = await visibile();
  const dette = await notifiche();
  expect(
    aperto,
    'il giro 4 ha chiuso <iframe> e il giro 10 <object> e <embed>: <frameset> mette dentro la '
    + `pagina lo stesso sito intero. Notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('AW0 — controllo: senza la lista, il riquadro del frameset carica davvero il sito', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/frameset`);
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'se con la lista vuota il frameset non carica niente, la prova qui sopra non dimostra niente',
  ).toBe(true);
});

// La porta AX (una scheda aperta bianca e riempita un istante dopo) in Filo non
// esiste: provata col controllo a lista vuota, quella pagina non arriva sul sito
// nemmeno quando la lista non c'è, perché una scheda aperta da una pagina non
// resta pilotabile da chi l'ha aperta. Le prove sono state tolte: non
// asserivano niente.

// ─── Porta AY: il link che apre una scheda nuova da dentro un riquadro ──────

test('AY — un link dentro un riquadro incorporato non deve aprire il sito della lista in una scheda nuova', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/riquadro-scheda`);
  const pagina = await aspettaPaginaSu(NORMALE);
  expect(pagina, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await pagina.waitForSelector('#n', { timeout: 5000 });
  const riquadro = pagina.frames().find((f) => /dentro-riquadro/.test(f.url() || ''));
  expect(riquadro, 'il riquadro deve esserci').toBeTruthy();
  await riquadro.evaluate(() => document.getElementById('su').click());
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'il giro 10 ha chiuso il link con target=_top; lo stesso link con target=_blank apre il sito '
    + 'della lista in una scheda nuova',
  ).toBe(false);
});

// ─── Porta AZ: il file preso dal sito della lista ───────────────────────────

test('AZ — un file offerto da una pagina qualunque ma ospitato sul sito della lista non deve arrivare', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/scarica`);
  const pagina = await aspettaPaginaSu(NORMALE);
  expect(pagina, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await pagina.waitForSelector('#d', { timeout: 5000 });
  chieste = [];
  await pagina.evaluate(() => document.getElementById('d').click());
  await shell.waitForTimeout(3000);
  expect(
    chieste.includes(`${LISTA}/file.bin`),
    'la lista dice «questo sito non deve arrivarmi»: il file preso dal sito della lista è la sola '
    + `cosa che ci arriva lo stesso. Richieste al server: ${JSON.stringify(chieste)}`,
  ).toBe(false);
});

test('AZ0 — controllo: senza la lista, quel file viene davvero chiesto al server', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/scarica`);
  const pagina = await aspettaPaginaSu(NORMALE);
  expect(pagina, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await pagina.waitForSelector('#d', { timeout: 5000 });
  chieste = [];
  await pagina.evaluate(() => document.getElementById('d').click());
  await shell.waitForTimeout(3000);
  expect(
    chieste.includes(`${LISTA}/file.bin`),
    `se con la lista vuota il file non viene nemmeno chiesto, la prova qui sopra non dimostra niente. Richieste: ${JSON.stringify(chieste)}`,
  ).toBe(true);
});

// ─── Porta AY2: il link dentro un riquadro, controllo ───────────────────────

test('AY0 — controllo: senza la lista, quel link apre davvero la scheda nuova', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/riquadro-scheda`);
  const pagina = await aspettaPaginaSu(NORMALE);
  expect(pagina, 'la pagina di partenza deve aprirsi').not.toBeNull();
  await pagina.waitForSelector('#n', { timeout: 5000 });
  const riquadro = pagina.frames().find((f) => /dentro-riquadro/.test(f.url() || ''));
  expect(riquadro, 'il riquadro deve esserci').toBeTruthy();
  await riquadro.evaluate(() => document.getElementById('su').click());
  await shell.waitForTimeout(3000);
  expect(
    await visibile(),
    'se con la lista vuota quel link non apre niente, la prova qui sopra non dimostra niente',
  ).toBe(true);
});

// ─── Porta BA: il sito messo in lista mentre lo si sta guardando ────────────

test('BA — un sito messo in lista mentre lo si guarda non deve restare a schermo', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const pagina = await aspettaPaginaSu(LISTA);
  expect(pagina, 'con la lista vuota il sito si deve aprire').not.toBeNull();
  await pagina.waitForSelector('#t', { timeout: 5000 });
  await metti([LISTA]);
  await shell.waitForTimeout(1500);
  expect(
    await visibile(),
    'l\'utente mette il sito in lista proprio mentre ce l\'ha davanti, ed è il caso più naturale '
    + 'di tutti: la pagina resta a schermo com\'era, e da lì ricarica, avanti/indietro e i link '
    + 'interni sono fermati, quindi la scheda resta ferma sul sito che aveva appena vietato',
  ).toBe(false);
});

test('BA2 — da quella scheda, il link interno deve portare da qualche parte', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const pagina = await aspettaPaginaSu(LISTA);
  expect(pagina, 'con la lista vuota il sito si deve aprire').not.toBeNull();
  await pagina.waitForSelector('#t', { timeout: 5000 });
  await metti([LISTA]);
  await pulisciNotifiche();
  await pagina.evaluate(() => document.getElementById('dentro').click()).catch(() => {});
  await shell.waitForTimeout(2000);
  const dette = await notifiche();
  expect(
    await visibile(),
    'dopo il divieto la scheda resta ferma sulla pagina vietata: il link interno viene fermato e '
    + `la scheda non si muove, quindi il sito vietato resta a schermo. Notifiche: ${JSON.stringify(dette)}`,
  ).toBe(false);
});
