// Verifica #590 — giro 7.
//
// Il giro 6 ha trovato che le due sorgenti della lista dei siti bloccati (i
// siti che l'utente SCRIVE e le liste pubbliche di pubblicità e tracciatori che
// Filo scarica da solo) erano diventate la stessa cosa, e che un link passato
// per un contatore di clic finiva contro un "Sito bloccato" col nome di un sito
// mai visto. Qui si guarda se quella porta è chiusa davvero.
//
// Porta AD — IL CONTATORE MESSO DIRITTO NEL LINK. Il giro 6 ha provato la forma
//            in cui il contatore arriva per RIMBALZO del server. Ma la forma
//            più comune è l'altra: l'indirizzo del contatore sta già
//            nell'attributo del link, ed è il contatore a rimbalzare poi
//            sull'articolo. È come sono fatti i link sponsorizzati, quelli
//            delle newsletter e quelli dei giornali.
// Porta AE — «APRI COMUNQUE» SU UN BLOCCO VENUTO DALLE LISTE PUBBLICHE. La
//            notifica offre il bottone: se lo si clicca, si apre qualcosa?
// Porta AF — L'ECCEZIONE DEL MOTORE DI RICERCA SUL DIVIETO SCRITTO DALL'UTENTE.
//            Chi si mette un sito in lista lo fa per non ricascarci: arrivarci
//            da una ricerca è il modo più naturale di ricascarci.
// Porta AG — UNA PAGINA CHE INSISTE. Il blocco di una navigazione top-level
//            annuncia una notifica ogni volta: una pagina che ci prova in
//            continuazione riempie l'angolo dello schermo da sola.

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
      html('<h1 id="t">SONO IL SITO DELLA LISTA</h1>');
      return;
    }
    if (host === CONTATORE) {
      // Il contatore di clic fa il suo mestiere: registra e rimbalza
      // sull'articolo vero.
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
    // Il link sponsorizzato: l'indirizzo del contatore sta GIÀ nel link.
    if (path === '/link-sponsorizzato') {
      html(`<a id="go" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    if (path === '/link-lista') {
      html(`<a id="go" href="http://${LISTA}:${porta}/pagina">vai</a>`);
      return;
    }
    if (path === '/articolo') {
      html('<h1 id="dest">ARTICOLO</h1>');
      return;
    }
    // Una pagina che insiste: riprova ad andare sul sito della lista, sempre.
    if (path === '/insiste') {
      html('<h1 id="i">insisto</h1><script>'
        + `let n=0; setInterval(() => { n++; location.href = "http://${LISTA}:${porta}/pagina?" + n; }, 120);`
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

const MAPPA = [LISTA, NORMALE, CONTATORE, MOTORE].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g7-');
  // Le liste pubbliche, com'è la macchina di un utente qualunque: Filo le
  // scarica da solo e le tiene qui. Le scriviamo a mano per non toccare la rete.
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

async function metti(lista, { listePubbliche = true } = {}) {
  await shell.evaluate(([h, lp]) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: lp, blacklist: h } } },
  }), [lista, listePubbliche]);
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

// ─── Porta AD: il contatore di clic scritto diritto nel link ─────────────────

test('AD1 — un link il cui indirizzo È il contatore di clic non deve far comparire «Sito bloccato»', async () => {
  // La lista scritta dall'utente è VUOTA: il contatore sta solo nelle liste
  // pubbliche. È la stessa cosa che il giro 6 ha chiesto per il contatore
  // raggiunto per rimbalzo — qui l'indirizzo del contatore sta già nel link,
  // che è la forma più comune dei link sponsorizzati e di quelli dei giornali.
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-sponsorizzato`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(3000);

  expect(
    (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t)),
    'la lista dei siti bloccati non c\'entra niente con un contatore di clic, '
    + 'né quando ci si arriva per rimbalzo né quando il suo indirizzo sta già nel link',
  ).toEqual([]);
});

test('AD2 — controllo: lo stesso link verso il sito che l\'UTENTE ha messo in lista lo dice', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-lista`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(2500);

  expect(await sitoDellaListaVisibile(), 'il sito della lista non si deve aprire').toBe(false);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });
});

// ─── Porta AE: «Apri comunque» su un blocco delle liste pubbliche ────────────

test('AE1 — se la notifica offre «Apri comunque», cliccarlo deve aprire qualcosa', async () => {
  await metti([]);
  // L'utente scrive lui l'indirizzo del contatore (o ci arriva da un link): la
  // notifica gli offre «Apri comunque». Un bottone che non apre mai niente è
  // peggio di nessun bottone.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${CONTATORE}:${srv.porta}/clic`);
  // Dal dodicesimo giro il testo nomina la sorgente della regola: la notifica
  // si riconosce dal bottone, che è quello che questa prova verifica.
  const card = shell.locator('.shell-notif', { hasText: 'Apri comunque' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.getByText('Apri comunque').click();
  await shell.waitForTimeout(3000);

  // Il contatore rimbalza sull'articolo: dopo il sì dell'utente la scheda deve
  // arrivarci, non restare bianca.
  const arrivata = await aspettaPaginaSu(NORMALE, 6000);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const schede = (snap?.tabs || []).map((t) => ({ url: t.url, titolo: t.title }));
  expect(
    arrivata,
    'dopo «Apri comunque» deve caricarsi una pagina: se la richiesta viene '
    + 'annullata lo stesso, la scheda resta bianca e non c\'è più nessuna strada. '
    + `Schede aperte: ${JSON.stringify(schede)}`,
  ).not.toBeNull();
});

test('AE0 — controllo: «Apri comunque» sul sito scritto dall\'utente apre davvero', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.getByText('Apri comunque').click();
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'dopo il sì dell\'utente il sito si apre').toBe(true);
});

// ─── Porta AF: l'eccezione del motore sul divieto scritto dall'utente ────────

test('AF — un sito che l\'utente si è messo in lista non deve aprirsi dai risultati di una ricerca', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${MOTORE}:${srv.porta}/search?q=bloccato`);
  const g = await aspettaPaginaSu(MOTORE);
  expect(g, 'la pagina dei risultati deve aprirsi').not.toBeNull();
  await g.waitForSelector('#r', { timeout: 8000 });
  await g.evaluate(() => document.getElementById('r').click());
  await shell.waitForTimeout(2500);

  expect(
    await sitoDellaListaVisibile(),
    'chi si mette un sito in lista lo fa per non ricascarci, e cercarlo è il '
    + 'modo più naturale di ricascarci: l\'eccezione "arrivo da un motore" è '
    + 'nata per le liste pubbliche, non per il divieto scritto a mano',
  ).toBe(false);
});

// ─── Porta AG: una pagina che insiste ───────────────────────────────────────

test('AG — una pagina che riprova in continuazione non deve poter tenersi l\'angolo dello schermo', async () => {
  await metti([LISTA]);
  // Conta ogni card che NASCE, non quelle vive in un istante: lo stack ha già
  // un tetto di cinque, quindi guardandolo si vedrebbe sempre cinque e non si
  // capirebbe che dietro c'è una raffica che spinge fuori tutto il resto.
  await shell.evaluate(() => {
    window.__contaBlocchi = 0;
    const host = document.getElementById('shell-notifs') || document.body;
    window.__osservatore = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList?.contains('shell-notif')
            && /Sito bloccato/.test(n.innerText || '')) window.__contaBlocchi++;
        }
      }
    });
    window.__osservatore.observe(host, { childList: true, subtree: true });
  });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/insiste`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina deve aprirsi').not.toBeNull();
  await shell.waitForTimeout(5000);

  const quante = await shell.evaluate(() => {
    window.__osservatore?.disconnect();
    return window.__contaBlocchi;
  });
  expect(
    quante,
    'la ricarica chiesta dalla pagina lo dice una volta ogni cinque secondi; una '
    + `navigazione ripetuta no, e ne sono arrivate ${quante} in cinque secondi: `
    + 'lo stack tiene le ultime cinque e butta fuori tutto il resto, con il suono a ogni giro',
  ).toBeLessThanOrEqual(3);
});
