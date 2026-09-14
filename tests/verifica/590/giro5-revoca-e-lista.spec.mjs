// Verifica #590 — giro 5, seconda metà. L'altra faccia della lista: il
// PERMESSO che l'utente dà a mano, e il CAMPO in cui scrive la lista.
//
// I giri 1-4 hanno chiuso le strade per cui un sito della lista arriva a
// schermo. Il giro 3 ha chiesto che un permesso si possa vedere e togliere, e
// il giro 4 che lo si ritrovi in Preferenze quando la notifica se n'è andata:
// il giro 4 ha però controllato solo che il permesso si VEDA. Qui si controlla
// che togliendolo il sito torni davvero bloccato, su ogni strada, e che le due
// strade per toglierlo (la notifica e le Preferenze) facciano la stessa cosa.
//
// Porta V — «Rimetti il blocco» dalle Preferenze: il sito torna bloccato su
//           tutte le strade (apertura chiesta dal modello, indirizzo scritto
//           dall'utente, link in una pagina).
// Porta W — «Rimetti il blocco» sulla notifica: stessa cosa, stessa strada
//           gemella.
// Porta X — l'elenco dei permessi con le Preferenze GIÀ aperte: un permesso
//           dato mentre la pagina è lì deve potersi vedere senza riaprirla.
// Porta Y — le voci di lista che non possono funzionare vengono DETTE, non
//           accettate e ignorate (il difetto del giro 2, nella sua forma più
//           comune: la stella e il punto davanti al nome).
// Porta Z — il campo della lista sotto abuso: diecimila caratteri, soli spazi,
//           HTML. Non deve rompersi né bloccare tutto il web.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'blocked.test';
const NORMALE = 'innocuo.test';

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

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g5b-');
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

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

// L'utente prova ad aprire il sito e sulla notifica dice di sì.
async function dicoDiSi() {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  const avviso = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(avviso).toBeVisible({ timeout: 6000 });
  await avviso.getByText('Apri comunque', { exact: true }).first().click();
  const aperta = await aspettaFinestraSu(LISTA);
  expect(aperta, '«Apri comunque» deve aprire davvero').not.toBeNull();
  return aperta;
}

async function apriPreferenze() {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const fine = Date.now() + 8000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => !w.isClosed() && (w.url() || '').includes('security.html'));
    if (p && await p.evaluate(() => !!document.getElementById('sec-siteblock-blacklist')).catch(() => false)) {
      return p;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta V: togliere il permesso dalle Preferenze ──────────────────────────

test('V — «Rimetti il blocco» dalle Preferenze riblocca su tutte le strade', async () => {
  await metti(LISTA);
  await dicoDiSi();
  await chiudiTutteLeSchede();
  await pulisciNotifiche();

  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1200);

  // Il permesso si vede, e ha un bottone per toglierlo.
  const vociPrima = await pref.evaluate(() => {
    const ul = document.getElementById('sec-siteblock-allowed-list');
    return ul ? [...ul.querySelectorAll('li')].map((li) => li.innerText) : [];
  });
  expect(vociPrima.join(' '), 'il permesso dato a mano deve comparire in Preferenze').toContain(LISTA);

  // Lo togliamo dal bottone della sua riga: è la strada che resta all'utente
  // quando la notifica se n'è andata.
  await pref.evaluate(() => {
    const ul = document.getElementById('sec-siteblock-allowed-list');
    ul.querySelector('li button').click();
  });
  await pref.waitForTimeout(1200);

  const vociDopo = await pref.evaluate(() => {
    const ul = document.getElementById('sec-siteblock-allowed-list');
    return ul ? [...ul.querySelectorAll('li')].map((li) => li.innerText) : [];
  });
  expect(vociDopo.length, 'tolto il permesso, la riga deve sparire').toBe(0);

  // E adesso il sito deve tornare bloccato DAVVERO, su ogni strada.
  // 1) l'apertura chiesta dal modello.
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'dopo «Rimetti il blocco» il sito non deve più aprirsi').toBe(false);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });

  // 2) l'indirizzo riscritto nella barra di una scheda aperta.
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'la pagina di partenza deve aprirsi').not.toBeNull();
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const id = snap.tabs.find((t) => (t.url || '').includes(NORMALE)).id;
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, `http://${LISTA}:${srv.porta}/arrivo`]);
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'nemmeno dalla barra deve riaprirsi').toBe(false);

  // 3) un link cliccato in una pagina.
  await pulisciNotifiche();
  await chiudiTutteLeSchede();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link`);
  const q = await aspettaFinestraSu(NORMALE);
  expect(q, 'la pagina col link deve aprirsi').not.toBeNull();
  await q.waitForSelector('#go', { timeout: 8000 });
  await q.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'nemmeno da un link deve riaprirsi').toBe(false);
});

// ─── Porta W: togliere il permesso dalla notifica ────────────────────────────

test('W — «Rimetti il blocco» sulla notifica fa la stessa cosa', async () => {
  await metti(LISTA);
  await dicoDiSi();

  // La notifica che annuncia il permesso ha il suo bottone per toglierlo.
  const avviso = shell.locator('.shell-notif', { hasText: 'resta aperto' });
  await expect(avviso).toBeVisible({ timeout: 6000 });
  await avviso.getByText('Rimetti il blocco', { exact: true }).first().click();
  await shell.waitForTimeout(600);

  await chiudiTutteLeSchede();
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'tolto il permesso dalla notifica, il sito non deve aprirsi').toBe(false);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });
});

// ─── Porta X: le Preferenze già aperte ───────────────────────────────────────

// ATTENZIONE, questa prova resta ROSSA di proposito e NON è una regressione.
// Il server ha messo questo rilievo fuori dal giro di correzione (lo apre come
// feedback a parte), quindi chi correggeva non poteva toccarlo. Resta qui
// perché è la memoria del difetto: quando quel feedback verrà chiuso, diventerà
// verde da sola.
test('X — un permesso dato mentre le Preferenze sono aperte si deve poter vedere lì', async () => {
  await metti(LISTA);
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  // Nessun permesso ancora: il riquadro è nascosto.
  const primaVisibile = await pref.evaluate(() => {
    const b = document.getElementById('sec-siteblock-allowed-box');
    return !!b && b.style.display !== 'none';
  });
  expect(primaVisibile, 'senza permessi il riquadro non deve comparire').toBe(false);

  // L'utente, da un'altra scheda, dice di sì a un sito.
  await dicoDiSi();

  // Torna sulle Preferenze, che erano rimaste aperte: il permesso c'è?
  await pref.waitForTimeout(1500);
  const voci = await pref.evaluate(() => {
    const ul = document.getElementById('sec-siteblock-allowed-list');
    return ul ? [...ul.querySelectorAll('li')].map((li) => li.innerText) : [];
  });
  expect(
    voci.join(' '),
    'il permesso deve vedersi anche nelle Preferenze rimaste aperte, senza doverle riaprire',
  ).toContain(LISTA);
});

test('X2 — la lista cambiata altrove non deve essere riscritta indietro da una pagina ferma', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  // L'utente chiede a Filo di bloccare un sito (o lo blocca da un'altra
  // strada) mentre le Preferenze sono lì aperte.
  await metti(LISTA);

  // Poi torna sulle Preferenze e tocca una qualunque altra manopola di quella
  // pagina, che salva tutto il riquadro Sicurezza insieme.
  await pref.evaluate(() => {
    const c = document.getElementById('sec-block-popups');
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pref.waitForTimeout(1200);

  // Il sito deve essere ancora bloccato: nessuno ha chiesto di sbloccarlo.
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(
    await sitoDellaListaVisibile(),
    'toccare un\'altra manopola delle Preferenze non deve cancellare il sito dalla lista',
  ).toBe(false);
});

// ─── Porta Y: le voci che non possono funzionare ─────────────────────────────

async function scriviLista(pref, testo) {
  await pref.evaluate((t) => {
    const el = document.getElementById('sec-siteblock-blacklist');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, testo);
  await pref.waitForTimeout(900);
  return pref.evaluate(() => {
    const e = document.getElementById('sec-siteblock-blacklist-error');
    return { visibile: !!e && e.style.display !== 'none', testo: e ? e.textContent : '' };
  });
}

test('Y — le voci che non possono bloccare niente vengono dette, non ignorate', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  // Le forme più comuni che un utente scrive da sé: la stella davanti al nome
  // (la forma dei filtri), il punto davanti, il nome senza estensione, un
  // indirizzo numerico.
  for (const voce of ['*.esempio.com', '.esempio.com', 'esempio', '10.0.0.5']) {
    const esito = await scriviLista(pref, voce);
    expect(esito.visibile, `la voce «${voce}» non blocca niente: l'avviso deve dirlo`).toBe(true);
    expect(esito.testo, `l'avviso deve nominare «${voce}»`).toContain(voce);
  }

  // E una voce buona non deve far comparire nessun avviso.
  const buona = await scriviLista(pref, 'esempio.com');
  expect(buona.visibile, 'una voce valida non deve far comparire avvisi').toBe(false);
});

// ─── Porta AA: il sito scritto in lista e la pagina chiusa subito ────────────

test('AA — il sito scritto nella lista si deve bloccare anche se si chiude subito la pagina', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  // L'utente SCRIVE il sito nel campo — come si scrive a mano, carattere per
  // carattere — e poi chiude la pagina senza toccare nient'altro. Non ha
  // cliccato nessun «Salva»: in questa pagina non c'è.
  await pref.evaluate((h) => {
    const el = document.getElementById('sec-siteblock-blacklist');
    el.focus();
    document.execCommand('insertText', false, h);
  }, LISTA);
  await pref.waitForTimeout(400);
  await chiudiTutteLeSchede();
  await shell.waitForTimeout(800);

  // Il sito deve essere bloccato: è quello che l'utente ha appena chiesto.
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(
    await sitoDellaListaVisibile(),
    'il sito scritto in lista deve bloccare anche se la pagina viene chiusa subito dopo',
  ).toBe(false);
});

// Controllo del meccanismo: senza questo, le due prove qui sotto sarebbero
// rosse anche solo perché la scrittura simulata non arriva nel campo. Qui il
// campo viene lasciato (blur) prima di provare: il sito DEVE bloccare.
test('AA0 — controllo: scritto in lista e lasciato il campo, il sito blocca', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  await pref.evaluate((h) => {
    const el = document.getElementById('sec-siteblock-blacklist');
    el.focus();
    document.execCommand('insertText', false, h);
    el.blur();
  }, LISTA);
  await pref.waitForTimeout(1200);

  await chiudiTutteLeSchede();
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(
    await sitoDellaListaVisibile(),
    'scritto e lasciato il campo, il sito deve bloccare: è la prova che la scrittura arriva',
  ).toBe(false);
});

test('AA2 — lo stesso, passando a un\'altra scheda invece di chiudere', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  await pref.evaluate((h) => {
    const el = document.getElementById('sec-siteblock-blacklist');
    el.focus();
    document.execCommand('insertText', false, h);
  }, LISTA);
  await pref.waitForTimeout(400);

  // L'utente passa a un'altra scheda per andare a provare il sito che ha
  // appena messo in lista: è la cosa più naturale da fare subito dopo.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/`);
  await shell.waitForTimeout(1200);

  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/arrivo`);
  await shell.waitForTimeout(2500);
  expect(
    await sitoDellaListaVisibile(),
    'il sito scritto in lista deve bloccare anche passando a un\'altra scheda',
  ).toBe(false);
});

// ─── Porta Z: il campo della lista sotto abuso ───────────────────────────────

test('Z — diecimila caratteri, soli spazi e HTML nel campo della lista', async () => {
  await metti();
  const pref = await apriPreferenze();
  expect(pref, 'la pagina Sicurezza deve aprirsi').not.toBeNull();
  await pref.waitForTimeout(1000);

  await scriviLista(pref, 'x'.repeat(10000));
  await scriviLista(pref, '   \n\t  \n   ');
  await scriviLista(pref, '<script>alert(1)</script>\nesempio.com');
  // La pagina è ancora viva e il campo risponde.
  const viva = await pref.evaluate(() => !!document.getElementById('sec-siteblock-blacklist'));
  expect(viva, 'il campo deve restare vivo dopo gli input limite').toBe(true);

  // E soprattutto: dopo tutto questo la lista non deve aver bloccato IL WEB.
  // Una voce spazzatura che finisse in lista come suffisso vuoto fermerebbe
  // qualunque sito.
  await scriviLista(pref, '   ');
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/`);
  const p = await aspettaFinestraSu(NORMALE);
  expect(p, 'con la lista vuota un sito qualunque deve aprirsi').not.toBeNull();
});
