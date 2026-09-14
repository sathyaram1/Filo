// Verifica #590 — giro 12, terza parte.
//
// L'unica eccezione dichiarata alla lista è «arrivo dai risultati di una
// ricerca». Il giro 9 ha già mostrato che quell'eccezione non sopravvive alla
// prima pagina (il link interno e la ricarica ricadono nel blocco), e su quel
// rilievo si è in attesa di una decisione dell'owner.
//
// Qui si guarda un pezzo PRIMA: il risultato di ricerca non porta quasi mai
// diritto all'articolo, passa per un indirizzo che rimbalza. E un risultato si
// apre in due modi, tutti e due normalissimi: cliccandolo (la scheda cambia
// pagina) oppure col tasto centrale / Ctrl+clic / target="_blank" (nasce una
// scheda nuova). Le due strade chiedono alla stessa decisione, ma solo una
// delle due si porta dietro la pagina di partenza.
//
// Porta BW — LO STESSO RISULTATO DI RICERCA, APERTO NEI DUE MODI.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';       // scritto a mano dall'utente
const MOTORE = 'www.google.com';     // il motore vero
const PONTE = 'rimbalzo.test';       // l'indirizzo che rimbalza sul risultato

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
    if (host === PONTE) {
      // Come sono fatti i risultati veri: l'indirizzo del risultato non è
      // quello dell'articolo, rimbalza.
      res.writeHead(302, { Location: `http://${LISTA}:${porta}/pagina` });
      res.end();
      return;
    }
    if (host === MOTORE && path === '/search') {
      html('<h1 id="r">risultati</h1>'
        + `<p><a id="stessa" href="http://${PONTE}:${porta}/vai">il risultato</a></p>`
        + `<p><a id="nuova" target="_blank" href="http://${PONTE}:${porta}/vai">lo stesso risultato</a></p>`
        + `<p><a id="diritto" href="http://${LISTA}:${porta}/pagina">il risultato senza rimbalzo</a></p>`
        + `<p><a id="dirittonuova" target="_blank" href="http://${LISTA}:${porta}/pagina">lo stesso, in una scheda nuova</a></p>`);
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

const MAPPA = [LISTA, MOTORE, PONTE].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g12c-');
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

// Apre i risultati di ricerca del motore vero e clicca il link chiesto.
async function daiRisultati(idLink) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u),
    `http://${MOTORE}:${srv.porta}/search?q=qualcosa`);
  const ris = await aspettaPagina('/search');
  expect(ris, 'la pagina dei risultati deve aprirsi').toBeTruthy();
  await ris.locator(`#${idLink}`).click();
  await shell.waitForTimeout(3500);
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── controlli: l'eccezione esiste davvero, nei due modi, sul link diritto ───

test('BW0 — controllo: dai risultati, il risultato senza rimbalzo si apre nella stessa scheda', async () => {
  await metti([LISTA]);
  await daiRisultati('diritto');
  expect(
    await visibile(),
    'è l\'eccezione dichiarata: chi arriva dai risultati di una ricerca l\'ha cercato lui',
  ).toBe(true);
});

test('BW1 — controllo: lo stesso risultato senza rimbalzo, aperto in una scheda nuova', async () => {
  await metti([LISTA]);
  await daiRisultati('dirittonuova');
  expect(
    await visibile(),
    'Ctrl+clic e target="_blank" sono l\'altro modo normale di aprire un risultato: la scheda '
    + 'nuova deve portare dove porta il clic normale',
  ).toBe(true);
});

// ─── Porta BW: il risultato che rimbalza, nei due modi ───────────────────────

test('BW2 — controllo: il risultato che rimbalza arriva, se il clic cambia pagina alla scheda', async () => {
  await metti([LISTA]);
  await daiRisultati('stessa');
  const dette = await notifiche();
  expect(
    await visibile(),
    `un risultato che passa per un indirizzo che rimbalza deve arrivare. Notifiche: ${JSON.stringify(dette)}`,
  ).toBe(true);
});

test('BW3 — lo stesso risultato che rimbalza, aperto in una scheda nuova, deve arrivare uguale', async () => {
  await metti([LISTA]);
  await daiRisultati('nuova');
  const dette = await notifiche();
  expect(
    await visibile(),
    'stesso risultato, stessa pagina di partenza, stesso rimbalzo: cambia solo che la scheda è '
    + 'nuova. La scheda appena nata non si porta dietro la pagina dei risultati, quindi il '
    + 'rimbalzo non trova più l\'eccezione e viene fermato a metà strada: resta una scheda vuota '
    + `e una notifica. Notifiche a schermo: ${JSON.stringify(dette)}`,
  ).toBe(true);
});
