// Le DUE SORGENTI della lista dei siti bloccati (#590) — e2e.
//
// Sotto lo stesso interruttore ci sono due cose diverse:
//   • i siti che l'UTENTE scrive nelle Preferenze: un divieto. Quel sito non
//     deve arrivargli davanti da nessuna strada, e quando viene fermato glielo
//     si dice;
//   • le liste pubbliche di pubblicità e tracciatori che Filo scarica da solo
//     (accese di serie, decine di migliaia di domini): una potatura, che il
//     filtro delle richieste fa già in silenzio su ogni pagina.
//
// La differenza conta nei due posti in cui il controllo è stato esteso: dove
// si PASSA (il rimbalzo del server) e dove ci si INCORPORA (un riquadro dentro
// una pagina). Sono esattamente i due posti dove vive la pubblicità, quindi
// applicarci anche le liste pubbliche voleva dire una notifica per ogni
// tracciatore di ogni pagina, e un link che rimbalza su un contatore di clic
// (i link sponsorizzati, quelli dei giornali, quelli delle newsletter) che non
// arrivava più all'articolo.
//
// Qui si asserisce che le due sorgenti si comportano in due modi diversi, e
// che il divieto scritto dall'utente continua a valere su tutte e due le
// strade: il rimbalzo era il modo più comodo di aggirarlo.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from './helpers/scala.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LISTA = 'blocked.test';       // scritto a mano dall'utente
const NORMALE = 'innocuo.test';     // la pagina di partenza
// I domini delle liste pubbliche: pubblicità e contatori di clic.
const PUBBLICITA = ['adserver.test', 'tracker.test', 'banner.test', 'metriche.test'];
const CONTATORE = PUBBLICITA[1];

async function alzaServer() {
  let porta = 0;
  const pagina = (corpo) => `<!doctype html><meta charset="utf-8">${corpo}`;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const path = req.url.split('?')[0];
    const html = (corpo) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(corpo));
    };
    if (host === LISTA) { html('<h1 id="t">SITO DELLA LISTA</h1>'); return; }
    if (host === CONTATORE && path === '/clic') {
      res.writeHead(302, { Location: `http://${NORMALE}:${porta}/destinazione` });
      res.end();
      return;
    }
    if (PUBBLICITA.includes(host)) { html('<p id="ad">riquadro pubblicitario</p>'); return; }
    // Una pagina di giornale: testo e quattro riquadri pubblicitari di quattro
    // domini diversi. È la forma normale di mezzo web.
    if (path === '/giornale' || path === '/giornale2') {
      const riquadri = PUBBLICITA
        .map((h, i) => `<iframe id="ad${i}" src="http://${h}:${porta}/riquadro" width="300" height="80"></iframe>`)
        .join('');
      html(`<h1 id="n">Notizie</h1>${riquadri}`);
      return;
    }
    // Le stesse pagine, ma il riquadro è il sito che l'utente ha messo in lista.
    if (path === '/incorpora' || path === '/incorpora2') {
      html(`<h1 id="n">pagina</h1><iframe id="f" src="http://${LISTA}:${porta}/dentro" width="600" height="400"></iframe>`);
      return;
    }
    // Un link che non punta diritto all'articolo: rimbalza prima sul contatore.
    if (path === '/link-tracciato') {
      html(`<a id="go" href="http://${NORMALE}:${porta}/vai-via">leggi l'articolo</a>`);
      return;
    }
    // La forma più comune dello stesso link: l'indirizzo del contatore sta già
    // scritto nel link, ed è lui a rimbalzare poi sull'articolo. Sono fatti
    // così i link sponsorizzati, quelli delle newsletter e quelli dei giornali.
    if (path === '/link-sponsorizzato') {
      html(`<a id="go" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    // Lo stesso link, ma fatto per aprirsi in una SCHEDA NUOVA: è così che si
    // aprono quasi sempre i link sponsorizzati e quelli dei giornali.
    if (path === '/link-sponsorizzato-blank') {
      html(`<a id="go" target="_blank" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    if (path === '/vai-via') {
      res.writeHead(302, { Location: `http://${CONTATORE}:${porta}/clic` });
      res.end();
      return;
    }
    if (path === '/destinazione') { html('<h1 id="dest">ARTICOLO</h1>'); return; }
    // Un link che rimbalza sul sito che l'utente ha messo in lista.
    if (path === '/link-alla-lista') {
      html(`<a id="go" href="http://${NORMALE}:${porta}/vai-alla-lista">vai</a>`);
      return;
    }
    if (path === '/vai-alla-lista') {
      res.writeHead(302, { Location: `http://${LISTA}:${porta}/arrivo` });
      res.end();
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

const MAPPA = [LISTA, NORMALE, ...PUBBLICITA].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-liste-');
  // Le liste pubbliche come le ha la macchina di un utente qualunque: Filo le
  // scarica da solo e le tiene qui. Le scriviamo per non toccare la rete.
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

async function metti(lista) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: true, blacklist: h } } },
  }), lista);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) await shell.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  await shell.waitForTimeout(300);
}

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

function notifiche() {
  return shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

async function aspettaFinestraSu(host, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const viste = app.windows().filter((w) => {
      if (w.isClosed()) return false;
      try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
    });
    for (const w of viste.reverse()) {
      if (await w.evaluate(() => true).catch(() => false)) return w;
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

// L'articolo vero, cioè dove il contatore di clic rimbalza: è quello che
// l'utente voleva quando ha cliccato il link.
async function articoloArrivato(ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of app.windows()) {
      if (!w.isClosed() && (w.url() || '').includes('/destinazione')) return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function apri(path) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}${path}`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina di partenza deve aprirsi').not.toBeNull();
  return p;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── le liste pubbliche restano mute ────────────────────────────────────────

test('una pagina con le sue pubblicità non porta nessuna notifica', async () => {
  await metti([]); // la lista scritta dall'utente è vuota
  await apri('/giornale');
  await shell.waitForTimeout(2500);
  const viste = await notifiche();
  expect(
    viste.filter((t) => t.includes('non è stato caricato')),
    'il blocco della pubblicità è sempre stato muto e deve restarlo',
  ).toEqual([]);
});

// Qui si asserisce che l'ARTICOLO ARRIVA, non solo che nessuno dice niente
// (#590, ottavo giro). Prima le liste pubbliche fermavano il link da due posti:
// il filtro delle richieste annullava il documento che la scheda stava
// aprendo, e la decisione sulla navigazione fermava la scheda. Il risultato era
// che il link non portava da nessuna parte comunque lo si aprisse, e per sette
// giri nessuno se n'è accorto perché si guardava solo la notifica.
test('un link che rimbalza su un contatore di clic porta all\'articolo, senza dire niente', async () => {
  await metti([]);
  const p = await apri('/link-tracciato');
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  expect(await articoloArrivato(), 'l\'utente ha cliccato «leggi l\'articolo»').toBe(true);
  expect(
    await notifiche(),
    'la lista dei siti bloccati non c\'entra niente con un contatore di clic',
  ).toEqual([]);
});

// La stessa cosa nell'altra forma, che è la più comune (#590, settimo giro):
// l'indirizzo del contatore sta già scritto nel link.
test('un link il cui indirizzo È il contatore di clic porta all\'articolo, senza dire niente', async () => {
  await metti([]);
  const p = await apri('/link-sponsorizzato');
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  expect(await articoloArrivato(), 'l\'utente ha cliccato «leggi l\'articolo»').toBe(true);
  expect(
    (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t)),
    'un contatore di clic non è un sito che l\'utente abbia messo in lista, '
    + 'e nominarglielo offrendogli di aprirlo è la voce sbagliata',
  ).toEqual([]);
});

// Lo stesso link aperto in una SCHEDA NUOVA (#590, ottavo giro). È la forma in
// cui i link sponsorizzati si aprono quasi sempre, ed era rimasta fuori: lì
// l'indirizzo passava per il gate delle schede, che lo trattava come se
// l'avesse scritto l'utente.
test('lo stesso link in una scheda nuova porta all\'articolo, senza dire niente', async () => {
  await metti([]);
  const p = await apri('/link-sponsorizzato-blank');
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  expect(await articoloArrivato(), 'l\'articolo si deve aprire nella scheda nuova').toBe(true);
  expect((await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t))).toEqual([]);
});

// E con Ctrl+clic o il clic centrale, cioè "aprilo dietro, io continuo a
// leggere qui": stesso gesto, stessa risposta.
test('Ctrl+clic sullo stesso link porta all\'articolo, senza dire niente', async () => {
  await metti([]);
  const p = await apri('/link-sponsorizzato');
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => {
    document.getElementById('go').dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, ctrlKey: true, metaKey: true, button: 0,
    }));
  });
  expect(await articoloArrivato(), 'l\'articolo si deve aprire nella scheda dietro').toBe(true);
  expect((await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t))).toEqual([]);
});

// L'eccezione alla regola: l'indirizzo l'ha fornito l'utente. Lì una richiesta
// esplicita che finisce nel nulla senza una parola sembra un guasto.
test('l\'indirizzo scritto dall\'utente lo dice anche quando a fermarlo sono le liste pubbliche', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${CONTATORE}:${srv.porta}/clic`);
  // Il testo nomina la sorgente della regola (#590, dodicesimo giro): qui la
  // notifica si riconosce dal bottone, che è quello che questa prova verifica.
  const card = shell.locator('.shell-notif', { hasText: 'Apri comunque' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  // E il bottone deve aprire davvero (#590, ottavo giro): finché il filtro
  // delle richieste annullava anche il documento della scheda, quel sì non
  // arrivava da nessuna parte e restava una scheda bianca.
  await card.getByText('Apri comunque').click();
  expect(await articoloArrivato(), '«Apri comunque» è l\'unica via d\'uscita: deve aprire').toBe(true);
});

// ─── il divieto scritto dall'utente vale anche lì ───────────────────────────

test('il sito scritto in lista resta fermato dentro un riquadro, e lo dice una volta', async () => {
  await metti([LISTA]);
  await apri('/incorpora');
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'il sito della lista non deve caricarsi in un riquadro').toBe(false);
  const viste = await notifiche();
  expect(viste.filter((t) => t.includes('non è stato caricato')).length).toBe(1);
});

test('il sito scritto in lista resta fermato anche se ci si arriva per un rimbalzo', async () => {
  await metti([LISTA]);
  const p = await apri('/link-alla-lista');
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'il rimbalzo non deve aggirare la lista').toBe(false);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });
});

test('del riquadro fermato si dice di nuovo quando la scheda cambia pagina', async () => {
  await metti([LISTA]);
  const p = await apri('/incorpora');
  await shell.waitForTimeout(2000);
  expect((await notifiche()).filter((t) => t.includes('non è stato caricato')).length).toBe(1);

  // Stessa scheda, pagina diversa, stesso sito incorporato: l'utente ha davanti
  // un'altra pagina potata e deve sapere perché.
  await pulisciNotifiche();
  await p.evaluate((u) => { window.location.href = u; }, `http://${NORMALE}:${srv.porta}/incorpora2`);
  await shell.waitForTimeout(3000);
  expect(
    (await notifiche()).filter((t) => t.includes('non è stato caricato')).length,
    'il conto di cosa è già stato detto riparte a ogni pagina, non a ogni scheda',
  ).toBe(1);
});

// #590 (dodicesimo giro) — CHI HA MESSO QUEL DIVIETO.
//
// Quando l'indirizzo lo fornisce l'utente, le liste pubbliche parlano: è
// l'unico caso, ed è giusto, perché una richiesta esplicita che finisce nel
// nulla senza una parola sembra un guasto. Ma parlavano con le parole del
// divieto dell'utente ("Sito bloccato: <nome>"), parola per parola, e di quel
// nome in Preferenze non c'è traccia: chi lo cercava nella propria lista non
// lo trovava, e niente gli diceva quale regola l'avesse fermato né dove si
// spegne. Senza la correzione il primo test qui sotto è rosso.
test('un sito fermato dalle liste pubbliche nomina la sorgente della regola', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${CONTATORE}:${srv.porta}/clic`);
  const card = shell.locator('.shell-notif', { hasText: 'Apri comunque' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  const testo = await card.innerText();
  expect(testo, 'il nome del sito va detto comunque').toContain(CONTATORE);
  expect(
    testo,
    'deve dire da dove viene la regola, con le stesse parole dell\'interruttore che la spegne '
    + 'in Preferenze, altrimenti è indistinguibile da un divieto scritto dall\'utente',
  ).toMatch(/liste di pubblicità e tracciatori/);
});

test('il divieto scritto dall\'utente resta "Sito bloccato", con il suo nome', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const card = shell.locator('.shell-notif', { hasText: 'Apri comunque' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  const testo = await card.innerText();
  expect(testo).toContain('Sito bloccato');
  expect(testo).toContain(LISTA);
  expect(testo, 'quel divieto l\'ha scritto lui: non c\'entrano le liste pubbliche')
    .not.toMatch(/liste di pubblicità/);
});
