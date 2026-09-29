// Verifica #590 — giro 8.
//
// Il giro 7 ha chiesto che la lista dei siti bloccati non si mettesse in mezzo
// a un link che passa per un contatore di clic: quello che l'utente SCRIVE è un
// divieto e va detto, le liste pubbliche di pubblicità e tracciatori sono una
// potatura muta. La porta è chiusa per il link che cambia pagina alla scheda in
// cui si trova. Qui si guardano le strade che quel giro non ha percorso.
//
// Porta AH — IL LINK CHE SI APRE IN UNA SCHEDA NUOVA. target="_blank" è la
//            forma normale dei link sponsorizzati, di quelli delle newsletter e
//            di quelli dei giornali; Ctrl+clic e il clic centrale sono lo stesso
//            gesto chiesto a mano dall'utente su un link qualsiasi.
// Porta AI — IL LINK CHE IL MODELLO SCRIVE IN CHAT invece di aprirlo. Il
//            sistema gli dice espressamente di elencare i siti come link nel
//            testo quando li sta solo proponendo: quel link poi lo clicca
//            l'utente, e deve incontrare la lista come ogni altro.
// Porta AJ — IL PERMESSO FRA UNA FINESTRA E L'ALTRA, incognito compreso.
// Porta AK — L'ASPETTO della notifica con un nome di sito lungo, nei due temi.
// Porta AL — LA LISTA E IL PERMESSO DOPO UN RIAVVIO di Filo.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LISTA = 'bloccato.test';          // il sito che l'utente scrive a mano
const NORMALE = 'giornale.test';        // la pagina di partenza
const CONTATORE = 'contatore.test';     // sta SOLO nelle liste pubbliche
const LUNGO = 'un-nome-di-sito-davvero-molto-lungo-come-ne-esistono.esempio.test';

let app = null;
let shell = null;
let userData = null;
let srv = null;

const HOSTS = [LISTA, NORMALE, CONTATORE, LUNGO];
const MAPPA = HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ');

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

    if (host === LISTA || host === LUNGO) {
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
    if (path === '/articolo') { html('<h1 id="dest">ARTICOLO</h1>'); return; }
    // Il link sponsorizzato del giornale: si apre in una scheda NUOVA, com'è
    // fatto quasi sempre, e il suo indirizzo è quello del contatore.
    if (path === '/sponsor-blank') {
      html(`<a id="go" target="_blank" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    // Lo stesso link, ma senza target: cambia pagina alla scheda in cui sta.
    if (path === '/sponsor-stessa') {
      html(`<a id="go" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    // Un link qualunque verso un articolo qualunque: serve per Ctrl+clic.
    if (path === '/link-articolo') {
      html(`<a id="go" href="http://${CONTATORE}:${porta}/clic?u=articolo">leggi l'articolo</a>`);
      return;
    }
    if (path === '/link-lista-blank') {
      html(`<a id="go" target="_blank" href="http://${LISTA}:${porta}/pagina">vai</a>`);
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

function preparaUserData() {
  const dir = cartellaTemporanea('filo-test-590g8-');
  // Le liste pubbliche, com'è la macchina di un utente qualunque: Filo le
  // scarica da solo e le tiene qui. Le scriviamo a mano per non toccare la rete.
  mkdirSync(join(dir, 'adblock'), { recursive: true });
  writeFileSync(
    join(dir, 'adblock', 'lists.json'),
    JSON.stringify({ updatedAt: Date.now(), count: 1, domains: [CONTATORE] }),
    'utf8',
  );
  return dir;
}

async function avvia() {
  app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${MAPPA}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
}

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = preparaUserData();
  await avvia();
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

async function sitoDellaListaVisibile(host = LISTA) {
  for (const w of app.windows()) {
    if (w.isClosed()) continue;
    for (const f of w.frames()) {
      let h = '';
      try { h = new URL(f.url() || '').hostname; } catch (_) { continue; }
      if (h !== host) continue;
      if (await f.evaluate(() => !!document.getElementById('t')).catch(() => false)) return true;
    }
  }
  return false;
}

// L'articolo vero, cioè dove il contatore di clic rimbalza: è quello che
// l'utente voleva quando ha cliccato «leggi l'articolo».
async function aspettaArticolo(ms = 6000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of app.windows()) {
      if (w.isClosed()) continue;
      if ((w.url() || '').includes('/articolo')) return true;
    }
    await new Promise((r) => setTimeout(r, 200));
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

// ─── Porta AH: il link che si apre in una scheda nuova ───────────────────────

test('AH1 — un link sponsorizzato che si apre in una scheda NUOVA non deve far comparire «Sito bloccato»', async () => {
  // La lista scritta dall'utente è VUOTA: il contatore sta solo nelle liste
  // pubbliche. Il giro 7 ha chiesto che di quello Filo taccia. target="_blank"
  // è la forma in cui i link sponsorizzati e quelli dei giornali si aprono
  // quasi sempre.
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/sponsor-blank`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(3000);

  // Le notifiche si leggono SUBITO: spariscono da sole dopo pochi secondi.
  const nominaSubito = (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t));
  const articoloAperto = await aspettaArticolo();
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  expect(
    {
      nomina: nominaSubito,
      articoloAperto,
      schede: (snap?.tabs || []).map((t) => t.url),
    },
    'lo stesso identico gesto — cliccare un link sponsorizzato — non può finire '
    + 'in due modi diversi a seconda che il link si apra nella stessa scheda o '
    + 'in una nuova: il giro 7 ha chiesto che delle liste pubbliche Filo taccia, '
    + 'e che l\'articolo arrivi',
  ).toMatchObject({ nomina: [], articoloAperto: true });
});

test('AH4 — col blocco dei popup spento, una finestrella verso un contatore non deve nominarlo', async () => {
  // Chi spegne il blocco dei popup chiede di lasciar passare le finestrelle:
  // quello che arriva al posto della finestrella è una notifica che nomina un
  // sito mai visto.
  await metti([], { listePubbliche: true });
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { blockPopups: false } },
  }));
  await shell.waitForTimeout(400);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/qualunque`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina deve aprirsi').not.toBeNull();
  await p.evaluate((u) => window.open(u, '_blank', 'width=500,height=400'),
    `http://${CONTATORE}:${srv.porta}/clic?u=articolo`);
  await shell.waitForTimeout(3000);
  const dette = (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t));
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { blockPopups: true } },
  }));
  expect(
    dette,
    'delle liste pubbliche Filo tace: qui invece nomina il contatore',
  ).toEqual([]);
});

test('AH0 — controllo: lo stesso link SENZA target, nella stessa scheda, tace già', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/sponsor-stessa`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(3000);
  const nomina = (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t));
  const articoloAperto = await aspettaArticolo();
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  expect(
    { nomina, articoloAperto },
    'nella stessa scheda Filo tace, ed è quello che il giro 7 chiedeva; ma '
    + 'l\'articolo non arriva lo stesso, e l\'utente resta dov\'era senza una '
    + `parola. Schede: ${JSON.stringify((snap?.tabs || []).map((t) => t.url))}`,
  ).toEqual({ nomina: [], articoloAperto: true });
});

test('AH6 — controllo del banco di prova: con le liste pubbliche spente l\'articolo arriva', async () => {
  // Serve a dire che il contatore e il rimbalzo funzionano, e che a fermare
  // l'articolo è la lista e non il banco di prova. Le liste pubbliche fermano
  // da due posti diversi: la decisione sulla navigazione (useAdblockLists) e
  // il filtro delle richieste (security.adblock.enabled). Qui si spengono
  // tutti e due.
  await metti([], { listePubbliche: false });
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { adblock: { enabled: false } } },
  }));
  await shell.waitForTimeout(500);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/sponsor-stessa`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  const arrivato = await aspettaArticolo();
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { adblock: { enabled: true } } },
  }));
  expect(arrivato, 'senza liste pubbliche il link arriva').toBe(true);
});

test('AH7 — il filtro delle richieste da solo non deve fermare la pagina che la scheda apre', async () => {
  // Le liste pubbliche fermano da due posti. Qui si lascia acceso SOLO il
  // filtro delle richieste (quello che pota la pubblicità dentro le pagine) e
  // si spegne la loro voce nella decisione sulla navigazione: se l'articolo
  // non arriva nemmeno così, a fermarlo è il filtro, che sta annullando anche
  // la pagina che la scheda sta aprendo.
  await metti([], { listePubbliche: false });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/sponsor-stessa`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  expect(
    await aspettaArticolo(),
    'il filtro delle richieste esiste per potare quello che una pagina si tira '
    + 'dentro, non per annullare la pagina che l\'utente sta aprendo',
  ).toBe(true);
});

test('AH5 — «Apri in una nuova scheda» dal tasto destro sullo stesso link: stessa cosa', async () => {
  // La voce del menu del tasto destro fa esattamente window.open(href): è la
  // terza forma dello stesso gesto, e la sceglie l'utente a mano.
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-articolo`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => window.open(document.getElementById('go').href, '_blank', 'noopener'));
  await shell.waitForTimeout(3000);
  expect(
    (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t)),
    'stesso link, stesso contatore, terza strada: non può nominarlo',
  ).toEqual([]);
});

test('AH2 — Ctrl+clic su un link sponsorizzato («aprilo dietro») non deve far comparire «Sito bloccato»', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-articolo`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  // Ctrl+clic: il gesto di "aprilo dietro, io continuo a leggere qui".
  await p.evaluate(() => {
    const a = document.getElementById('go');
    a.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, ctrlKey: true, metaKey: true, button: 0,
    }));
  });
  await shell.waitForTimeout(3000);

  expect(
    (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t)),
    'aprire un link dietro è un gesto ordinario di ogni browser: non può '
    + 'nominare all\'utente un sito che non ha mai visto',
  ).toEqual([]);
});

test('AH3 — controllo: il sito che l\'UTENTE ha messo in lista, in una scheda nuova, lo dice e non si apre', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${NORMALE}:${srv.porta}/link-lista-blank`);
  const p = await aspettaPaginaSu(NORMALE);
  expect(p, 'la pagina col link deve aprirsi').not.toBeNull();
  await p.waitForSelector('#go', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('go').click());
  await shell.waitForTimeout(2500);

  expect(await sitoDellaListaVisibile(), 'il sito della lista non si deve aprire').toBe(false);
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first())
    .toBeVisible({ timeout: 6000 });
});

// ─── Porta AI: il link che il modello scrive in chat invece di aprirlo ───────

test('AI — un link verso il sito della lista aperto dalla chat deve essere fermato', async () => {
  // Il sistema dice espressamente al modello: se stai solo PROPONENDO dei siti,
  // non usare NAVIGA, elencali come link nel testo. Quel link lo clicca poi
  // l'utente, ed è un'altra strada verso la stessa cosa: deve incontrare la
  // lista come tutte le altre.
  await metti([LISTA]);
  const dest = `http://${LISTA}:${srv.porta}/pagina`;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://dashboard/dashboard.html');
  await shell.waitForTimeout(1500);
  const home = app.windows().find((w) => !w.isClosed() && w.url().includes('dashboard'));
  expect(home, 'la home deve aprirsi').toBeTruthy();
  // Il link come lo renderebbe la chat: un <a> nel testo della risposta.
  await home.evaluate((u) => {
    const a = document.createElement('a');
    a.id = '__provaLink';
    a.href = u;
    a.target = '_blank';
    a.textContent = 'il sito che ti propongo';
    document.body.appendChild(a);
  }, dest);
  await home.evaluate(() => document.getElementById('__provaLink').click());
  await shell.waitForTimeout(2500);

  expect(
    await sitoDellaListaVisibile(),
    'il link che il modello propone in chat è una strada come le altre verso '
    + 'lo stesso sito: la lista deve valere anche lì',
  ).toBe(false);
});

// ─── Porta AJ: il permesso fra una finestra e l'altra ────────────────────────

test('AJ — il sì dato in una finestra in incognito non deve valere nella finestra normale', async () => {
  await metti([LISTA]);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let incognito = null;
  const fine = Date.now() + 10000;
  while (Date.now() < fine && !incognito) {
    incognito = app.windows().find((w) => !w.isClosed() && (w.url() || '').includes('incognito=1')) || null;
    if (!incognito) await new Promise((r) => setTimeout(r, 200));
  }
  expect(incognito, 'la finestra in incognito deve aprirsi').toBeTruthy();
  await incognito.waitForLoadState('domcontentloaded');
  await incognito.waitForTimeout(800);

  await incognito.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const card = incognito.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByText('Apri comunque').click();
  await shell.waitForTimeout(2500);

  // Ora la finestra NORMALE: il sì è stato dato in incognito, che l'utente apre
  // proprio per non portarsi dietro niente.
  await pulisciNotifiche();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina?normale`);
  await shell.waitForTimeout(2500);
  const dette = (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t));
  const aperto = await sitoDellaListaVisibile();
  // E la seconda porta sulla stessa causa: quel sì è anche SCRITTO nell'elenco
  // dei siti sbloccati a mano, che l'utente legge nella pagina Sicurezza delle
  // Preferenze della finestra NORMALE.
  const elenco = await shell.evaluate(() => window.filoShell.message({ type: 'site_block_allowed' }));
  const scritti = (elenco && elenco.hosts) || [];
  await incognito.evaluate(() => window.close()).catch(() => {});

  expect(
    {
      fermato: dette.length > 0,
      sitoAperto: aperto,
      scrittoNellePreferenze: scritti.includes(LISTA),
    },
    'una finestra in incognito è il posto in cui quello che si fa non resta: '
    + 'un «Apri comunque» dato lì non può togliere il blocco anche di là, '
    + 'né lasciare il nome del sito scritto nelle Preferenze della finestra normale',
  ).toEqual({ fermato: true, sitoAperto: false, scrittoNellePreferenze: false });
});

// ─── Porta AO: «Apri comunque» premuto due volte in fretta ──────────────────

test('AO — «Apri comunque» premuto in fretta non deve aprire tre schede dello stesso sito', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 8000 });
  const bottone = card.getByText('Apri comunque');
  await bottone.click({ force: true }).catch(() => {});
  await bottone.click({ force: true }).catch(() => {});
  await bottone.click({ force: true }).catch(() => {});
  await shell.waitForTimeout(3000);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const suLista = (snap?.tabs || []).filter((t) => (t.url || '').includes(LISTA));
  expect(
    suLista.length,
    `un doppio clic sul bottone della notifica non deve lasciare una pila di schede: ${JSON.stringify(suLista.map((t) => t.url))}`,
  ).toBeLessThanOrEqual(1);
});

// ─── Porta AK: l'aspetto della notifica ─────────────────────────────────────

test('AK — la notifica con un nome di sito lungo sta dentro, nei due temi', async () => {
  await metti([LUNGO]);
  const temi = {};
  for (const tema of ['chiaro', 'scuro']) {
    await chiudiTutteLeSchede();
    await pulisciNotifiche();
    await shell.evaluate((t) => window.filoShell.message({
      type: 'update_settings', settings: { theme: t === 'scuro' ? 'dark' : 'light' },
    }), tema);
    await app.evaluate(({ nativeTheme }, t) => {
      nativeTheme.themeSource = t === 'scuro' ? 'dark' : 'light';
    }, tema);
    await shell.waitForTimeout(1000);
    temi[tema] = await shell.evaluate(() => ({
      media: window.matchMedia('(prefers-color-scheme: dark)').matches,
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LUNGO}:${srv.porta}/pagina`);
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await shell.screenshot({ path: `tests/.shots/590-giro8-notifica-${tema}.png` });
    const box = await card.boundingBox();
    const vp = shell.viewportSize() || { width: 1280, height: 800 };
    expect(box, 'la notifica deve avere un riquadro').not.toBeNull();
    expect(
      box.x + box.width,
      `tema ${tema}: la notifica col nome di sito lungo esce dallo schermo`,
    ).toBeLessThanOrEqual(vp.width + 1);
    // Il nome del sito si deve leggere per intero o essere accorciato con
    // grazia, non uscire dal riquadro.
    const sborda = await card.evaluate((n) => {
      const el = [...n.querySelectorAll('*')].concat([n]);
      return el.some((e) => e.scrollWidth > e.clientWidth + 2);
    });
    expect(sborda, `tema ${tema}: il testo della notifica sborda dal riquadro`).toBe(false);
  }
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { theme: 'system' },
  }));
  // ATTENZIONE per chi rilancia questa prova: nel contenitore senza schermo
  // delle routine la shell risponde SEMPRE col tema chiaro, sia passando dalle
  // Preferenze sia forzando il tema di sistema — i due scatti escono uguali e
  // il tema scuro resta non verificato. Su una macchina con uno schermo vero i
  // due valori qui sotto divergono, ed è lì che il confronto vale davvero.
  expect(temi.chiaro, 'il giro deve aver misurato il tema chiaro').toBeTruthy();
  expect(temi.scuro, 'il giro deve aver misurato anche il secondo scatto').toBeTruthy();
});

// ─── Porta AL: la lista e il permesso dopo un riavvio ───────────────────────

test('AL — dopo un riavvio la lista blocca ancora e il sì di prima non vale più', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByText('Apri comunque').click();
  await shell.waitForTimeout(2500);
  expect(await sitoDellaListaVisibile(), 'prima del riavvio il sì vale').toBe(true);

  await app.close();
  await avvia();
  await shell.waitForTimeout(1500);
  await chiudiTutteLeSchede();
  await pulisciNotifiche();

  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/dopo`);
  await shell.waitForTimeout(2500);
  expect(
    await sitoDellaListaVisibile(),
    'il sì dura una sessione: dopo il riavvio la lista che l\'utente ha scritto '
    + 'deve tornare a valere',
  ).toBe(false);
  expect(
    (await notifiche()).filter((t) => /Sito bloccato|liste di pubblicità/.test(t)).length,
    'e il blocco si deve dire',
  ).toBeGreaterThan(0);
});
