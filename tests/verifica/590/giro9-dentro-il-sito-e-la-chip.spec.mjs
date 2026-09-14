// Verifica #590 — giro 9.
//
// Gli otto giri prima hanno chiuso le strade con cui si ARRIVA su un sito della
// lista. Qui si guarda cosa succede UNA VOLTA ARRIVATI per l'unica porta che
// resta aperta per scelta (l'eccezione "vengo dai risultati di una ricerca"), e
// si prova l'ultima superficie che decide da sé se un indirizzo è dell'utente o
// della pagina: la chip che compare quando il blocco dei popup ferma una
// finestrella.
//
// Porta AP — DENTRO IL SITO APERTO DA UNA RICERCA. L'eccezione fa entrare. Poi
//            il primo link interno, la ricarica e il tasto indietro chiedono di
//            nuovo alla lista, senza sapere niente di come ci si è arrivati: il
//            sito si vede e non si può usare. È la stessa forma del rilievo del
//            giro 2 su "Apri comunque" (il sì che non sopravviveva alla prima
//            pagina), che lì è stato chiuso ricordando il sì.
// Porta AQ — LA CHIP DEI POPUP. Il giro 8 ha chiesto che l'indirizzo scelto
//            dalla PAGINA non venga trattato come quello scritto dall'utente, e
//            ha chiuso link, Ctrl+clic, menu del tasto destro e finestrella col
//            blocco popup SPENTO. Col blocco popup acceso, che è come Filo esce
//            di fabbrica, la finestrella diventa una chip con un bottone "Apri":
//            quel bottone è l'unica strada rimasta fuori.
// Porta AR — UNA PAGINA CHE SI RISCRIVE L'INDIRIZZO. L'eccezione del motore di
//            ricerca adesso pretende un percorso di RISULTATI. Ma il percorso
//            una pagina se lo cambia da sola, dentro la propria origine, senza
//            ricaricare niente: chi pubblica una pagina su un nome di motore si
//            riprende l'eccezione con una riga.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';        // scritto a mano dall'utente
const NORMALE = 'giornale.test';      // la pagina di partenza
const CONTATORE = 'contatore.test';   // sta SOLO nelle liste pubbliche
const MOTORE = 'www.google.com';      // un motore di ricerca vero
const OSPITE = 'sites.google.com';    // il nome del motore, ma la pagina è di chiunque

async function alzaServer() {
  let porta = 0;
  const pagina = (corpo) => `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const html = (c) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(c));
    };

    if (host === LISTA) {
      if (path === '/dentro') {
        html('<h1 id="t2">SECONDA PAGINA DEL SITO DELLA LISTA</h1>');
        return;
      }
      // La prima pagina del sito, con un link interno: è la cosa che si fa
      // appena si arriva su un sito, cliccare qualcosa.
      html(`<h1 id="t">SONO IL SITO DELLA LISTA</h1>`
        + `<a id="dentro" href="http://${LISTA}:${porta}/dentro">un'altra pagina di qui</a>`);
      return;
    }
    if (host === CONTATORE) {
      res.writeHead(302, { Location: `http://${NORMALE}:${porta}/articolo` });
      res.end();
      return;
    }
    if (host === MOTORE) {
      if (path === '/search') {
        html(`<h1>risultati</h1><a id="r" href="http://${LISTA}:${porta}/pagina">il sito che cercavi</a>`);
        return;
      }
      html('<h1>motore</h1>');
      return;
    }
    if (host === OSPITE) {
      // Una pagina che chiunque può pubblicare sul nome del motore. Si riscrive
      // l'indirizzo nel percorso dei risultati (stessa origine: non serve
      // nessun permesso, e la pagina non si ricarica) e poi porta la scheda sul
      // sito della lista.
      if (path === '/finto-risultato') {
        html('<h1 id="o">pagina di chiunque, ospitata sul motore</h1><script>'
          + 'history.replaceState({}, "", "/search?q=qualcosa");'
          + `setTimeout(() => { location.href = "http://${LISTA}:${porta}/pagina"; }, 250);`
          + '</script>');
        return;
      }
      // La stessa riga, ma poi il sito della lista lo apre in una SCHEDA NUOVA.
      if (path === '/finto-risultato-scheda') {
        html('<h1 id="o">pagina di chiunque, ospitata sul motore</h1><script>'
          + 'history.replaceState({}, "", "/search?q=qualcosa");'
          + `setTimeout(() => { window.open("http://${LISTA}:${porta}/pagina", "_blank"); }, 250);`
          + '</script>');
        return;
      }
      // La stessa riga, ma il sito della lista se lo INCORPORA in un riquadro.
      if (path === '/finto-risultato-riquadro') {
        html('<h1 id="o">pagina di chiunque, ospitata sul motore</h1><script>'
          + 'history.replaceState({}, "", "/search?q=qualcosa");'
          + 'setTimeout(() => { const f = document.createElement("iframe"); '
          + `f.src = "http://${LISTA}:${porta}/pagina"; f.width = 900; f.height = 600; `
          + 'document.body.appendChild(f); }, 250);'
          + '</script>');
        return;
      }
      html('<h1 id="o">pagina di chiunque, ospitata sul motore</h1>');
      return;
    }
    if (path === '/articolo') {
      html('<h1 id="dest">ARTICOLO</h1>');
      return;
    }
    // La finestrella verso il contatore di clic: col blocco dei popup acceso
    // diventa una chip.
    if (path === '/finestrella-contatore') {
      html('<h1 id="n">pagina qualunque</h1><script>'
        + `window.open("http://${CONTATORE}:${porta}/clic", "_blank", "width=600,height=500");`
        + '</script>');
      return;
    }
    // La stessa cosa verso il sito che l'UTENTE ha messo in lista: qui la
    // notifica ci vuole, ed è il controllo che tiene onesta la porta AQ.
    if (path === '/finestrella-lista') {
      html('<h1 id="n">pagina qualunque</h1><script>'
        + `window.open("http://${LISTA}:${porta}/pagina", "_blank", "width=600,height=500");`
        + '</script>');
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

const MAPPA = [LISTA, NORMALE, CONTATORE, MOTORE, OSPITE]
  .map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g9-');
  // Le liste pubbliche come le ha un utente qualunque: Filo le scarica da solo.
  mkdirSync(join(userData, 'adblock'), { recursive: true });
  writeFileSync(
    join(userData, 'adblock', 'lists.json'),
    JSON.stringify({ updatedAt: Date.now(), count: 1, domains: [CONTATORE] }),
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

// C'è a schermo, da qualche parte, la pagina del sito della lista con
// quell'elemento dentro?
async function visibile(id) {
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

async function schedaAttiva() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  return snap.tabs.find((t) => t.id === snap.activeId) || snap.tabs[snap.tabs.length - 1] || null;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta AP: dentro il sito aperto da una ricerca ──────────────────────────

// L'eccezione "arrivo da una pagina di risultati" è dichiarata e il giro 7 l'ha
// già messa in mano all'owner. Quello che si prova qui è un'altra cosa: dato
// che l'eccezione fa entrare, il sito dev'essere USABILE. Se la prima pagina si
// vede e il primo clic dentro il sito viene fermato, all'utente il sito sembra
// rotto, non bloccato.

async function arrivaDallaRicerca() {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${MOTORE}:${srv.porta}/search?q=bloccato`);
  const risultati = await aspettaPaginaSu(MOTORE);
  expect(risultati, 'la pagina dei risultati deve aprirsi').not.toBeNull();
  await risultati.click('#r');
  const sito = await aspettaPaginaSu(LISTA);
  expect(sito, "l'eccezione del motore di ricerca fa entrare: la prima pagina del sito si vede").not.toBeNull();
  await sito.waitForSelector('#t', { timeout: 5000 });
  await pulisciNotifiche();
  return sito;
}

test('AP1 — dentro il sito arrivato da una ricerca, il primo link interno deve funzionare', async () => {
  const sito = await arrivaDallaRicerca();
  await sito.evaluate(() => document.getElementById('dentro').click());
  await shell.waitForTimeout(2000);
  const arrivata = await visibile('t2');
  const dette = await notifiche();
  expect(
    arrivata,
    'il sito si è aperto (l\'eccezione della ricerca), e il primo link cliccato DENTRO il sito non porta da nessuna parte: '
    + `notifiche a schermo ${JSON.stringify(dette)}. Il sito sembra rotto invece che bloccato, `
    + 'ed è la stessa forma del rilievo già chiuso su "Apri comunque", dove il sì viene ricordato',
  ).toBe(true);
});

test('AP2 — ricaricare il sito arrivato da una ricerca non deve dire «Sito bloccato»', async () => {
  await arrivaDallaRicerca();
  const t = await schedaAttiva();
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), t.id);
  await shell.waitForTimeout(1500);
  const dette = await notifiche();
  expect(
    dette.some((x) => /Sito bloccato/i.test(x)),
    'la pagina è a schermo perché l\'eccezione della ricerca l\'ha fatta entrare, e premere ricarica '
    + 'non la ricarica: non succede niente e arriva «Sito bloccato» su una pagina che si sta guardando. '
    + `Notifiche a schermo ${JSON.stringify(dette)}`,
  ).toBe(false);
});

test('AP3 — il tasto indietro deve riportare sui risultati della ricerca', async () => {
  const sito = await arrivaDallaRicerca();
  // Dentro il sito non si riesce ad andare (AP1), quindi la cronologia è
  // risultati → sito: indietro deve riportare ai risultati, che non sono in
  // lista e non c'entrano niente con il blocco.
  const t = await schedaAttiva();
  await shell.evaluate((i) => window.filoShell.tabs.back(i), t.id);
  await shell.waitForTimeout(1500);
  const tornato = await aspettaPaginaSu(MOTORE, 3000);
  expect(tornato, 'indietro dal sito bloccato deve riportare alla pagina dei risultati').not.toBeNull();
  expect(sito).not.toBeNull();
});

// ─── Porta AQ: la chip dei popup ─────────────────────────────────────────────

async function aspettaChip(ms = 6000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const n = await shell.evaluate(() => document.querySelectorAll('.popup-chip').length);
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function pulisciChip() {
  await shell.evaluate(() => document.querySelectorAll('.popup-chip').forEach((c) => c.remove()));
}

test('AQ1 — «Apri» sulla chip di una finestrella verso un contatore non deve nominare il contatore', async () => {
  // La lista scritta dall'utente è VUOTA: il contatore sta solo nelle liste
  // pubbliche. Il blocco dei popup è acceso, cioè come Filo esce di fabbrica.
  await metti([], { popup: true });
  await pulisciChip();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/finestrella-contatore`);
  expect(await aspettaChip(), 'col blocco popup acceso deve comparire la chip').toBe(true);
  await pulisciNotifiche();
  await shell.evaluate(() => {
    const c = document.querySelector('.popup-chip');
    [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apri').click();
  });
  await shell.waitForTimeout(1500);
  const dette = await notifiche();
  expect(
    dette.some((t) => /Sito bloccato/i.test(t)),
    'la chip promette di far passare QUELLA finestrella, e l\'indirizzo l\'ha scelto la pagina, non l\'utente: '
    + `«Sito bloccato» col nome del contatore non ci va. Notifiche a schermo ${JSON.stringify(dette)}. `
    + 'Con il blocco dei popup SPENTO lo stesso identico indirizzo passa in silenzio (giro 8, AH4)',
  ).toBe(false);
  await pulisciChip();
});

test('AQ2 — controllo: sulla stessa chip, il sito che l\'UTENTE ha messo in lista va detto', async () => {
  await metti([LISTA], { popup: true });
  await pulisciChip();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/finestrella-lista`);
  expect(await aspettaChip(), 'col blocco popup acceso deve comparire la chip').toBe(true);
  await pulisciNotifiche();
  await shell.evaluate(() => {
    const c = document.querySelector('.popup-chip');
    [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apri').click();
  });
  await shell.waitForTimeout(1500);
  const dette = await notifiche();
  expect(
    dette.some((t) => /Sito bloccato/i.test(t)),
    'il divieto scritto dall\'utente vale anche qui, e va detto',
  ).toBe(true);
  expect(await visibile('t'), 'e il sito della lista non si deve aprire').toBe(false);
  await pulisciChip();
});

// ─── Porta AR: la pagina che si riscrive l'indirizzo ─────────────────────────

test('AR — una pagina ospitata sul nome del motore non deve prendersi l\'eccezione riscrivendosi il percorso', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${OSPITE}:${srv.porta}/finto-risultato`);
  const ospite = await aspettaPaginaSu(OSPITE);
  expect(ospite, 'la pagina di chiunque, ospitata sul nome del motore, si apre (non è in lista)').not.toBeNull();
  await shell.waitForTimeout(2500);
  expect(
    await visibile('t'),
    'la pagina si è riscritta l\'indirizzo nel percorso dei risultati (stessa origine, nessun permesso, '
    + 'nessuna ricarica) e con quello si è presa l\'eccezione del motore di ricerca: il sito della lista si è aperto. '
    + 'È la stessa forma del difetto già chiuso due volte — prima il sito di chiunque che si spacciava per motore, '
    + 'poi la pagina di chiunque ospitata sul motore vero',
  ).toBe(false);
});

test('AR2 — la stessa riga, con il sito della lista aperto in una scheda NUOVA', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${OSPITE}:${srv.porta}/finto-risultato-scheda`);
  expect(await aspettaPaginaSu(OSPITE), 'la pagina ospite si apre').not.toBeNull();
  await shell.waitForTimeout(2500);
  expect(
    await visibile('t'),
    'stessa causa della porta AR: la pagina si riscrive il percorso e poi apre il sito della lista in una scheda nuova',
  ).toBe(false);
});

test('AR3 — la stessa riga, con il sito della lista dentro un riquadro incorporato', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${OSPITE}:${srv.porta}/finto-risultato-riquadro`);
  expect(await aspettaPaginaSu(OSPITE), 'la pagina ospite si apre').not.toBeNull();
  await shell.waitForTimeout(2500);
  expect(
    await visibile('t'),
    'stessa causa della porta AR: il riquadro incorporato chiede alla stessa decisione, e la pagina che lo ospita '
    + 'si è appena riscritta il percorso nei risultati',
  ).toBe(false);
});
