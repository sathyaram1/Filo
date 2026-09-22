// LE STATISTICHE DEI FEEDBACK — la nona scheda di Gestione (feedback #496).
//
// COSA DEVE ESSERE VERO
//   1. la scheda c'è accanto a quella del Red Team e apre il suo pannello;
//   2. la finestra di riferimento si sceglie, e i numeri la seguono davvero:
//      la stessa lista dà risposte diverse su «7 giorni» e su «Tutto»;
//   3. il filtro per creatore vale su tutta la scheda — si possono vedere i
//      soli dati dell'esploratore o delle altre routine in cloud;
//   4. i tre conteggi chiesti ci sono, e «Feedback ricevuti» si espande nella
//      divisione per categoria (e per mittente);
//   5. i LAVORATI si contano sulla data di lavorazione, non su quella d'invio:
//      un feedback vecchio lavorato ieri è lavoro di ieri;
//   6. la torta dei giri ha una fetta per gruppo, con quanti lavori ci sono
//      dentro, e i fermati sono una fetta a parte che non sposta la media;
//   7. quando il registro delle esecuzioni non copre la finestra chiesta, la
//      pagina lo DICE invece di far passare un minimo per un totale;
//   8. si legge su tema chiaro e su tema scuro.
//
// COME
//   Negli spec non c'è né una sessione da proprietario né Firestore: i dati
//   delle due sorgenti si iniettano con `__mgTest.setFsData`, e da lì in poi
//   gira il codice vero — i conti di src/shared/feedbackStats.js e tutta la
//   resa della pagina.

import { test, expect } from './fixtures/electron.mjs';
import { oggiFa } from './helpers/istanti.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

// Le date si costruiscono a partire da ADESSO: le finestre sono relative, e
// una data fissa scritta nel test scadrebbe da sola dopo qualche settimana.
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

function fb(over = {}) {
  return Object.assign({
    _id: 'fs-' + Math.random().toString(36).slice(2),
    seq: 1, subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: g(1),
    status: 'todo',
    text: 'testo', name: 'titolo', images: [],
  }, over);
}

async function apri(page, dati) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  // La lista a sinistra resta vuota: questa scheda legge l'INSIEME per conto
  // suo, e mescolarle nasconderebbe proprio l'errore che si vuole escludere.
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
  await expect(page.locator('#mgFsBody')).toBeVisible();
}

// Il numero di un riquadro, letto come lo legge l'owner. `data-fs-id` sta su
// tutti i riquadri, anche su quelli che non si aprono.
const tile = (page, id) => page.locator(`[data-fs-id="${id}"] .mg-tile-n`);

// Una fetta di ciambella si clicca SULLA FETTA, non al centro del suo
// rettangolo: per un mezzo anello quel centro cade nel buco. Il punto si
// prende sull'arco esterno e si tira dentro di dieci pixel.
async function cliccaFetta(page, group) {
  const svg = await page.locator('#mgFsPie').boundingBox();
  const p = await page.locator(`#mgFsPie [data-group="${group}"]`).evaluate((el) => {
    const q = el.getPointAtLength(el.getTotalLength() * 0.25);
    return { x: q.x, y: q.y };
  });
  const dx = p.x - 100, dy = p.y - 100;
  const d = Math.hypot(dx, dy) || 1;
  await page.mouse.click(svg.x + p.x - (dx / d) * 12, svg.y + p.y - (dy / d) * 12);
}

// ── 1. La scheda esiste e si apre ───────────────────────────────────────────

test('#496 — la scheda «Statistiche feedback» sta accanto a quella del Red Team e apre il suo pannello', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  const nuova = page.locator('.mg-tab[data-tab="fbstats"]');
  const redteam = page.locator('.mg-tab[data-tab="stats"]');
  await expect(nuova).toHaveText('Statistiche feedback');
  await expect(redteam).toHaveText('Statistiche Red Team');
  // Una accanto all'altra, nell'ordine: prima i feedback, poi il red team.
  const xNuova = (await nuova.boundingBox()).x;
  const xRed = (await redteam.boundingBox()).x;
  expect(xNuova).toBeLessThan(xRed);

  await nuova.click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#panel-stats')).not.toHaveClass(/mg-panel--active/);
});

test('#496 — chi non gestisce i feedback non vede i numeri, e la pagina lo dice', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.loadFsData());
  await expect(page.locator('#mgFsDenied')).toBeVisible();
  await expect(page.locator('#mgFsBody')).toBeHidden();

  // …e se l'accesso arriva mentre la scheda è aperta, la scheda se ne accorge
  // da aperta invece di restare sul rifiuto finché non si cambia scheda.
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setFsData({ feedbacks: [], workerLog: [] }));
  await expect(page.locator('#mgFsDenied')).toBeHidden();
  await expect(page.locator('#mgFsBody')).toBeVisible();
});

// ── 2. La finestra di riferimento ───────────────────────────────────────────

test('#496 — la finestra di riferimento si sceglie e i numeri la seguono', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, createdAt: g(1) }),
      fb({ seq: 2, createdAt: g(3) }),
      fb({ seq: 3, createdAt: g(40) }),
      fb({ seq: 4, createdAt: g(300) }),
    ],
    workerLog: [],
  });

  await page.locator('[data-fs-range="7g"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');
  await page.locator('[data-fs-range="90g"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('3');
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('4');

  // La pasticca scelta si vede scelta (non è solo lo stato interno).
  await expect(page.locator('[data-fs-range="tutto"]')).toHaveClass(/mg-chip--on/);
  await expect(page.locator('[data-fs-range="7g"]')).not.toHaveClass(/mg-chip--on/);
});

test('#496 — «Scegli tu» apre le due date, e la finestra parte da lì', async ({ openTab }) => {
  const page = await openTab(URL);
  const oggi = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dieciFa = new Date(Date.now() - 10 * GIORNO);
  const cinqueFa = new Date(Date.now() - 5 * GIORNO);

  await apri(page, {
    feedbacks: [
      fb({ seq: 1, createdAt: g(2) }),    // fuori (troppo recente)
      fb({ seq: 2, createdAt: g(7) }),    // dentro
      fb({ seq: 3, createdAt: g(8) }),    // dentro
      fb({ seq: 4, createdAt: g(20) }),   // fuori (troppo vecchio)
    ],
    workerLog: [],
  });

  await expect(page.locator('#mgFsCustom')).toBeHidden();
  await page.locator('[data-fs-range="custom"]').click();
  await expect(page.locator('#mgFsCustom')).toBeVisible();
  await page.locator('#mgFsFrom').fill(iso(dieciFa));
  await page.locator('#mgFsTo').fill(iso(cinqueFa));
  await page.locator('#mgFsTo').dispatchEvent('change');
  await expect(tile(page, 'ricevuti')).toHaveText('2');
  expect(iso(oggi)).toBeTruthy();   // la data di oggi si costruisce (guardia del formato)
});

// ── 3. Il filtro per creatore ───────────────────────────────────────────────

test('#496 — il filtro per creatore mostra i soli dati di chi si è scelto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, clientId: 'agent:prober', createdAt: g(1) }),
      fb({ seq: 2, clientId: 'agent:prober', createdAt: g(2) }),
      fb({ seq: 3, clientId: 'routine:verifier', createdAt: g(2) }),
      fb({ seq: 4, clientId: 'utente-vero', createdAt: g(2) }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('4');

  // Solo l'esploratore.
  await page.locator('[data-fs-creator="prober"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');
  // …più la verifica: il filtro somma, non sostituisce.
  await page.locator('[data-fs-creator="verifier"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('3');
  // «Tutti» rimette tutto com'era: si può togliere ciò che si è messo.
  await page.locator('[data-fs-creator="__tutti"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('4');
  await expect(page.locator('[data-fs-creator="__tutti"]')).toHaveClass(/mg-chip--on/);

  // Ogni pasticca dice quanto contiene, come la barra delle sezioni.
  await expect(page.locator('[data-fs-creator="prober"] .mg-chip-n')).toHaveText('2');
});

// ── 4. I riquadri e il dettaglio per categoria ──────────────────────────────

test('#496 — «Feedback ricevuti» si apre e mostra la divisione per categoria e per mittente', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo', clientId: 'utente-a', createdAt: g(1) }),
      fb({ seq: 2, status: 'todo', clientId: 'utente-b', createdAt: g(1) }),
      fb({ seq: 3, status: 'spam', clientId: 'agent:prober', createdAt: g(1) }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();

  // Chiuso, il dettaglio non c'è.
  await expect(page.locator('.mg-fs-detail')).toHaveCount(0);
  await page.locator('[data-fs-tile="ricevuti"]').click();
  const det = page.locator('.mg-fs-detail');
  await expect(det).toBeVisible();
  await expect(det.locator('[data-fs-bar="todo"] .mg-bar-n')).toHaveText('2');
  await expect(det.locator('[data-fs-bar="spam"] .mg-bar-n')).toHaveText('1');
  // …e la seconda metà: chi li ha mandati.
  await expect(det.locator('[data-fs-bar="user"] .mg-bar-n')).toHaveText('2');
  await expect(det.locator('[data-fs-bar="prober"] .mg-bar-n')).toHaveText('1');

  // Si può aprire, quindi si può chiudere.
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await expect(page.locator('.mg-fs-detail')).toHaveCount(0);
});

test('#496 — esplorazioni lanciate e lanci per mestiere vengono dal registro delle esecuzioni', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 5, clientId: 'agent:prober', createdAt: g(1) })],
    workerLog: [
      { role: 'prober', startedAt: g(1), num: '' },
      { role: 'prober', startedAt: g(2), num: '' },
      { role: 'prober', startedAt: g(3), num: '' },
      { role: 'verifier', startedAt: g(2), num: '5' },
      { role: 'secaudit', startedAt: g(2), num: '5' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  await expect(tile(page, 'prober')).toHaveText('3');
  await expect(tile(page, 'lanci')).toHaveText('5');
  await page.locator('[data-fs-tile="lanci"]').click();
  await expect(page.locator('.mg-fs-detail [data-fs-bar="prober"] .mg-bar-n')).toHaveText('3');
  await expect(page.locator('.mg-fs-detail [data-fs-bar="verifier"] .mg-bar-n')).toHaveText('1');
});

// ── 5. Due sorgenti, due date ───────────────────────────────────────────────

test('#496 — un feedback vecchio lavorato ieri conta come lavoro di ieri, non come arrivo di ieri', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 88, createdAt: g(300), status: 'done' })],
    workerLog: [
      { role: 'new-work', startedAt: g(1), num: '88' },
      { role: 'verifier', startedAt: g(1), num: '88' },
    ],
  });
  await page.locator('[data-fs-range="7g"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('0');
  await expect(tile(page, 'lavorati')).toHaveText('1');
});

// ── 6. La torta dei giri ────────────────────────────────────────────────────

test('#496 — la torta dice quante critiche è costato ogni lavoro, e i fermati sono a parte', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'done' }),                                    // 1 verifica → subito
      fb({ seq: 2, status: 'done' }),                                    // 3 verifiche → 2 critiche
      fb({ seq: 3, status: 'design', statusReason: 'loop' }),            // fermato
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(5), num: '1' },
      { role: 'verifier', startedAt: g(5), num: '2' },
      { role: 'verifier', startedAt: g(4), num: '2' },
      { role: 'verifier', startedAt: g(3), num: '2' },
      { role: 'verifier', startedAt: g(2), num: '3' },
      { role: 'verifier', startedAt: g(1), num: '3' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  // Una fetta per gruppo, col suo conteggio: si asserisce QUALI fette ci sono.
  const fette = await page.locator('#mgFsPie [data-group]').evaluateAll(
    (els) => els.map((e) => [e.dataset.group, e.dataset.n]));
  expect(Object.fromEntries(fette)).toEqual({ g0: '1', g2: '1', fermati: '1' });
  // La legenda specchia le fette.
  await expect(page.locator('#mgFsLegend li[data-group="g2"]')).toContainText('2 critiche');

  // La media sta nel buco della ciambella e NON conta il fermato:
  // (0 + 2) / 2 = 1.0.
  await expect(page.locator('#mgFsPieMid b')).toHaveText('1,0');

  // E i due esiti che il grafico non racconta da solo.
  await expect(page.locator('[data-fs-esito="fermati"] b')).toHaveText('1');
});

test('#496 — un lavoro passato che ha lasciato indietro dei rilievi si conta a parte', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 7, status: 'done' }),
      fb({ seq: 7, subSeq: 1, clientId: 'routine:residuo', status: 'todo' }),
      fb({ seq: 8, status: 'done' }),
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(2), num: '7' },
      { role: 'verifier', startedAt: g(2), num: '8' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('[data-fs-esito="rimandati"] b')).toHaveText('1');
});

test('#496 — senza lavori verificati la torta lo dice, non disegna una ciambella vuota', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1 })], workerLog: [] });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('#mgFsPie [data-group]')).toHaveCount(0);
  // La ciambella vuota si toglie: la frase sta sotto il titolo della sezione,
  // non schiacciata nel buco di un anello che non c'è.
  await expect(page.locator('#mgFsPieVuoto')).toContainText('Nessun lavoro verificato');
});

// ── 7. La copertura si dichiara ─────────────────────────────────────────────

test('#496 — se il registro non copre la finestra la pagina lo dice, invece di dare un minimo per un totale', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1, createdAt: g(200) })],
    workerLog: [{ role: 'prober', startedAt: g(4), num: '' }],
  });

  // Finestra dentro il registro: nessun avviso da dare.
  await page.locator('[data-fs-range="oggi"]').click();
  await expect(page.locator('#mgFsNota')).toBeHidden();

  // Finestra più larga del registro: si dichiara da dove partono i conti.
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(page.locator('#mgFsNota')).toBeVisible();
  await expect(page.locator('#mgFsNota')).toContainText('registro delle esecuzioni');
});

test('#496 — una lettura incompleta delle segnalazioni non passa per un totale', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1 })], workerLog: [], complete: false });
  await expect(page.locator('#mgFsNota')).toBeVisible();
  await expect(page.locator('#mgFsNota')).toContainText('minimi, non totali');
});

test('#496 — se il registro non si legge la pagina lo dice invece di mostrare zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1 })], workerLog: [], logOk: false });
  await expect(page.locator('#mgFsNota')).toContainText('non si è letto');
});

// ── 8. Input limite ─────────────────────────────────────────────────────────

test('#496 — senza dati la scheda resta leggibile e non inventa numeri', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [], workerLog: [] });
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('0');
  await expect(tile(page, 'lavorati')).toHaveText('0');
  await expect(page.locator('#mgFsTrendAxis')).toContainText('Nessuna segnalazione');
  // Aprire un riquadro vuoto dice che è vuoto, non lascia un buco.
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await expect(page.locator('.mg-fs-detail')).toContainText('Niente in questa finestra');
});

test('#496 — molti dati: la scheda regge e raggruppa le colonne invece di fare un pettine', async ({ openTab }) => {
  const page = await openTab(URL);
  const tanti = [];
  const log = [];
  for (let i = 0; i < 400; i += 1) {
    tanti.push(fb({ seq: i + 1, createdAt: g(i % 300), status: i % 3 ? 'done' : 'todo' }));
    log.push({ role: 'verifier', startedAt: g(i % 300), num: String(i + 1) });
  }
  await apri(page, { feedbacks: tanti, workerLog: log });
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('400');
  // Le colonne non sono 300: oltre due mesi si raggruppa.
  const colonne = await page.locator('.mg-fs-trend-col').count();
  expect(colonne).toBeGreaterThan(0);
  expect(colonne).toBeLessThan(100);
  // E niente scorrimento laterale della pagina.
  const geo = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  }));
  expect(geo.sw).toBeLessThanOrEqual(geo.cw + 1);
});

// ── 8-bis. Quello che i numeri non devono nascondere ────────────────────────

test('#496 — la divisione per categoria chiama ogni stato col suo nome', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo' }), fb({ seq: 2, status: 'done' }),
      fb({ seq: 3, status: 'spam' }), fb({ seq: 4, status: 'working' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  const nomi = await page.locator('.mg-fs-detail .mg-bar-row[data-fs-bargroup="categorie"] .mg-bar-label')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  expect(nomi.length).toBe(4);
  expect(new Set(nomi).size, `nomi ripetuti: ${JSON.stringify(nomi)}`).toBe(4);
  for (const n of nomi) expect(n).not.toMatch(/ignoto/i);
});

test('#496 — la barra di una riga si riempie, e una riga da 3 è più lunga di una da 1', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo' }), fb({ seq: 2, status: 'todo' }),
      fb({ seq: 3, status: 'todo' }), fb({ seq: 4, status: 'done' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  const misure = await page.locator('.mg-fs-detail .mg-bar-row[data-fs-bargroup="categorie"] .mg-bar-fill')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(misure.length).toBe(2);
  for (const w of misure) expect(w).toBeGreaterThan(0);
  expect(misure[0]).toBeGreaterThan(misure[1]);
});

test('#496 — col filtro acceso le pasticche degli altri mittenti dicono ancora quanti sono', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, clientId: 'agent:prober' }), fb({ seq: 2, clientId: 'agent:prober' }),
      fb({ seq: 3, clientId: 'utente-a' }), fb({ seq: 4, clientId: 'utente-b' }), fb({ seq: 5, clientId: 'utente-c' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('[data-fs-creator="user"] .mg-chip-n')).toHaveText('3');
  await page.locator('[data-fs-creator="prober"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');
  await expect(page.locator('[data-fs-creator="user"] .mg-chip-n')).toHaveText('3');
});

test('#496 — un lavoro ancora in mezzo al giro non è «passato subito»', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 10, status: 'working' }), fb({ seq: 11, status: 'revision_capability' })],
    workerLog: [
      { role: 'verifier', startedAt: g(1), num: '10' },
      { role: 'verifier', startedAt: g(1), num: '11' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('#mgFsPie [data-group]')).toHaveCount(0);
  await expect(page.locator('#mgFsPieVuoto')).toContainText('via libera');
  await expect(page.locator('[data-fs-esito="aperti"] b')).toHaveText('2');
});

test('#496 — quante critiche è costato un lavoro non cambia con la finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 20, status: 'done', createdAt: g(12) })],
    workerLog: [
      { role: 'verifier', startedAt: g(10), num: '20' },
      { role: 'verifier', startedAt: g(5), num: '20' },
      { role: 'verifier', startedAt: g(0), num: '20' },
    ],
  });
  for (const finestra of ['30g', '7g', 'oggi']) {
    await page.locator(`[data-fs-range="${finestra}"]`).click();
    const fette = await page.locator('#mgFsPie [data-group]').evaluateAll(
      (els) => Object.fromEntries(els.map((e) => [e.dataset.group, e.dataset.n])));
    expect(fette, `finestra ${finestra}`).toEqual({ g2: '1' });
  }
});

test('#496 — una segnalazione senza data leggibile non sparisce in silenzio da «Tutto»', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1 }), fb({ seq: 2, createdAt: null }), fb({ seq: 3, createdAt: 'non una data' })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('1');
  await expect(page.locator('#mgFsNota')).toContainText('data d\'arrivo leggibile');
});

test('#496 — «Tutto» prende anche una segnalazione con l\'orologio avanti', async ({ openTab }) => {
  const page = await openTab(URL);
  const domani = new Date(Date.now() + 3 * GIORNO).toISOString();
  await apri(page, { feedbacks: [fb({ seq: 1 }), fb({ seq: 2, createdAt: domani })], workerLog: [] });
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');
});

test('#496 — le date sotto il grafico si leggono come tutte le altre della scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1, createdAt: g(2) }), fb({ seq: 2, createdAt: g(0) })], workerLog: [] });
  await page.locator('[data-fs-range="7g"]').click();
  const testo = await page.locator('#mgFsTrendAxis').innerText();
  expect(testo).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  expect(testo, 'la forma tecnica 2026-08-25 non è una data da leggere').not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

// ── 8-ter. Da un numero alle segnalazioni che lo compongono ─────────────────

test('#496 — una riga della ripartizione si apre sulle segnalazioni che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'todo', name: 'Primo in coda' }),
      fb({ seq: 2, status: 'todo', name: 'Secondo in coda' }),
      fb({ seq: 3, status: 'done', name: 'Risolto' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await expect(page.locator('#mgFsDrill')).toBeHidden();

  await page.locator('.mg-fs-detail .mg-bar-row[data-fs-bar="todo"]').click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('2 segnalazioni');
  await expect(page.locator('#mgFsDrillList .mg-fs-drill-row')).toHaveCount(2);
  await expect(page.locator('#mgFsDrillList')).toContainText('Primo in coda');
  await expect(page.locator('#mgFsDrillList')).not.toContainText('Risolto');

  // Si apre, quindi si chiude.
  await page.locator('#mgFsDrillClose').click();
  await expect(page.locator('#mgFsDrill')).toBeHidden();
});

test('#496 — anche una fetta della torta e una colonna del grafico si aprono su cosa contano', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'done', name: 'Passato al primo colpo', createdAt: g(1) }),
      fb({ seq: 2, status: 'done', name: 'Costato due giri', createdAt: g(1) }),
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(3), num: '2' },
      { role: 'verifier', startedAt: g(2), num: '2' },
      { role: 'verifier', startedAt: g(1), num: '2' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  await cliccaFetta(page, 'g2');
  await expect(page.locator('#mgFsDrillList')).toContainText('Costato due giri');
  await expect(page.locator('#mgFsDrillList')).not.toContainText('Passato al primo colpo');

  // La voce di legenda gemella fa la stessa cosa della fetta.
  await page.locator('#mgFsLegend li[data-group="g0"]').click();
  await expect(page.locator('#mgFsDrillList')).toContainText('Passato al primo colpo');

  // E una colonna del grafico degli arrivi. Le colonne dei giorni VUOTI non
  // sono pulsanti: dietro non hanno niente da aprire, e non fingono di averlo.
  await page.locator('button.mg-fs-trend-col').first().click();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('Arrivate il');
  await expect(page.locator('#mgFsDrillList .mg-fs-drill-row')).toHaveCount(2);
});

test('#496 — il tasto destro su un numero offre di vedere cosa ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1, status: 'todo', name: 'Una in coda' }), fb({ seq: 2, status: 'done' })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-id="ricevuti"]').click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Copia riga e numero');
  await menu.locator('.sn-select-option', { hasText: 'Mostra' }).click();
  await expect(page.locator('#mgFsDrillList .mg-fs-drill-row')).toHaveCount(2);
});

test('#496 — dall\'elenco si arriva alla segnalazione vera', async ({ openTab }) => {
  const page = await openTab(URL);
  const uno = fb({ seq: 1, status: 'todo', name: 'Una in coda', _id: 'fs-uno' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((f) => window.__mgTest.setData([f]), uno);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((f) => window.__mgTest.setFsData({ feedbacks: [f], workerLog: [] }), uno);
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-id="ricevuti"]').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Mostra' }).click();
  await page.locator('#mgFsDrillList .mg-fs-drill-row').first().click();
  // La segnalazione è aperta nella colonna di sinistra, nella sua sezione.
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('.mg-item--selected')).toHaveAttribute('data-id', 'fs-uno');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-fbstats')).not.toHaveClass(/mg-panel--active/);
});

// ── 8-quater. La scheda aperta segue quello che succede ─────────────────────

test('#496 — la scheda aperta si rimette in pari da sola, come il resto della pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  const A = fb({ _id: 'fs-a', seq: 1, _updateTime: 't1' });
  const B = fb({ _id: 'fs-b', seq: 2, _updateTime: 't1' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((a) => window.__mgTest.setData([a]), A);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((a) => window.__mgTest.setFsData({ feedbacks: [a], workerLog: [] }), A);
  await page.locator('[data-fs-range="30g"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('1');

  await page.evaluate(({ A, B }) => {
    window.__liveState = {
      versions: [{ _id: 'fs-a', _updateTime: 't1' }, { _id: 'fs-b', _updateTime: 't1' }],
      docs: { 'fs-a': A, 'fs-b': B },
    };
    window.__mgTest.setLiveSources({
      listVersions: async () => window.__liveState.versions,
      getMany: async (ids) => ids.map((id) => window.__liveState.docs[id]).filter(Boolean),
    });
  }, { A, B });
  await page.evaluate(() => window.__mgTest.pollNow());
  await expect(tile(page, 'ricevuti')).toHaveText('2');
});

// ── 9. I due temi ───────────────────────────────────────────────────────────

test('#496 — la scheda si legge su tema chiaro e su tema scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  // Dati vari, non due righe: una scheda si guarda piena, o non si vede se una
  // fetta sparisce, se la legenda va a capo o se una colonna del grafico
  // diventa una macchia (CLAUDE.md § Verifica, modifica visiva).
  const mittenti = ['utente-a', 'utente-b', 'agent:prober', 'routine:verifier', 'owner:me', 'local:sessione', 'filo:auto'];
  const stati = ['todo', 'done', 'spam', 'design', 'aligned', 'archived', 'working'];
  const feedbacks = [];
  const workerLog = [];
  for (let i = 0; i < 42; i += 1) {
    const num = i + 1;
    feedbacks.push(fb({
      seq: num,
      clientId: mittenti[i % mittenti.length],
      status: stati[i % stati.length],
      createdAt: g(i % 26),
      reviewedAt: i % 4 === 0 ? g(Math.max(0, (i % 26) - 2)) : undefined,
    }));
    // Da zero a tre verifiche: la torta ha tutte le sue fette.
    for (let v = 0; v <= i % 4; v += 1) workerLog.push({ role: 'verifier', startedAt: g((i % 26)), num: String(num) });
    workerLog.push({ role: 'new-work', startedAt: g(i % 26), num: String(num) });
    if (i % 5 === 0) workerLog.push({ role: 'secaudit', startedAt: g(i % 26), num: String(num) });
    if (i % 3 === 0) workerLog.push({ role: 'prober', startedAt: g(i % 26), num: '' });
  }
  // Due lavori fermati che aspettano l'owner, e uno che ha lasciato rilievi.
  feedbacks.push(fb({ seq: 90, status: 'design', statusReason: 'loop', createdAt: g(6) }));
  feedbacks.push(fb({ seq: 91, status: 'revision_security', livelli: { l4: { esito: 'fail' } }, createdAt: g(4) }));
  feedbacks.push(fb({ seq: 3, subSeq: 1, clientId: 'routine:residuo', status: 'todo', createdAt: g(5) }));
  workerLog.push({ role: 'verifier', startedAt: g(6), num: '90' });
  workerLog.push({ role: 'verifier', startedAt: g(4), num: '91' });

  await apri(page, { feedbacks, workerLog });
  await page.locator('[data-fs-range="30g"]').click();

  const fondi = [];
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    fondi.push(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

    // Le fette esistono e hanno un colore pieno in tutti e due i temi.
    const fette = await page.locator('#mgFsPie [data-group]').evaluateAll((els) => els.map((e) => ({
      fill: getComputedStyle(e).fill, box: e.getBoundingClientRect().width,
    })));
    expect(fette.length, `tema ${tema}`).toBeGreaterThan(0);
    for (const f of fette) {
      expect(f.fill, `tema ${tema}`).not.toBe('rgba(0, 0, 0, 0)');
      expect(f.box, `tema ${tema}`).toBeGreaterThan(4);
    }
    // La pasticca scelta si distingue da quelle spente.
    const [on, off] = await Promise.all([
      page.locator('[data-fs-range="30g"]').evaluate((e) => getComputedStyle(e).backgroundColor),
      page.locator('[data-fs-range="7g"]').evaluate((e) => getComputedStyle(e).backgroundColor),
    ]);
    expect(on, `tema ${tema}`).not.toBe(off);
    await page.screenshot({ path: `tests/.shots/statistiche-feedback-${tema}.png`, fullPage: true });

    // …e con la ripartizione aperta e l'elenco delle segnalazioni contate:
    // sono le due superfici che si guardano più a lungo.
    await page.locator('[data-fs-tile="ricevuti"]').click();
    await page.locator('.mg-fs-detail .mg-bar-row--click').first().click();
    await expect(page.locator('#mgFsDrill')).toBeVisible();
    // Le barre si riempiono davvero, in tutti e due i temi.
    const larghezze = await page.locator('.mg-fs-detail .mg-bar-fill')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of larghezze) expect(w, `tema ${tema}`).toBeGreaterThan(0);
    await page.screenshot({ path: `tests/.shots/statistiche-feedback-elenco-${tema}.png`, fullPage: true });
    await page.locator('#mgFsDrillClose').click();
    await page.locator('[data-fs-tile="ricevuti"]').click();
  }
  expect(fondi[0], 'i due temi devono dare fondi diversi').not.toBe(fondi[1]);
});

// ══ Il grafico degli arrivi è un asse del tempo ═════════════════════════════
//
// Disegnava una colonna solo per i periodi con qualcosa dentro e le accostava:
// due settimane distanti tre mesi uscivano appiccicate e larghe uguali, e il
// silenzio in mezzo spariva. La riga sotto il titolo intanto prometteva «una
// colonna per settimana».

test('#496 il grafico degli arrivi disegna anche i periodi vuoti, e riempie il suo riquadro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1, createdAt: g(29) }), fb({ seq: 2, createdAt: g(0) })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();

  const colonne = page.locator('.mg-fs-trend-col');
  await expect(colonne, 'trenta giorni di finestra, trenta colonne').toHaveCount(30);
  // I giorni vuoti ci sono, e non fingono di valere uno: non sono pulsanti.
  // (Il tasto destro ce l'hanno lo stesso: restringersi su un periodo di
  // silenzio è un modo legittimo di guardare questo grafico.)
  await expect(page.locator('.mg-fs-trend-col--zero')).toHaveCount(28);
  await expect(page.locator('button.mg-fs-trend-col')).toHaveCount(2);

  // L'ultima colonna sta sotto la data di fine, che la riga dell'asse scrive
  // in fondo a destra.
  const riquadro = await page.locator('#mgFsTrend').boundingBox();
  const ultima = await colonne.last().boundingBox();
  expect(ultima.x + ultima.width).toBeGreaterThan(riquadro.x + riquadro.width * 0.9);
});

// ══ Ogni numero si apre su cosa ha contato ═════════════════════════════════
//
// Il pattern «Un numero si apre su cosa ha contato» vale anche per i numeri
// scritti sotto i riquadri, che contano segnalazioni come quelli grandi.

test('#496 anche i numeri della fila in fondo portano alle segnalazioni che hanno contato', async ({ openTab }) => {
  const page = await openTab(URL);
  const trovato = fb({ seq: 1, clientId: 'agent:prober', createdAt: g(2) });
  const lavorato = fb({
    seq: 2, status: 'done', createdAt: g(4), reviewedAt: g(3),
    stalls: 2, livelli: { l4: { esito: 'pass' } },
  });
  await apri(page, {
    feedbacks: [trovato, lavorato],
    workerLog: [
      { role: 'prober', startedAt: g(2) },
      { role: 'new-work', startedAt: g(3), num: '2' },
      { role: 'verifier', startedAt: g(1), num: '2' },
    ],
  });
  await page.locator('[data-fs-range="7g"]').click();

  // Nelle esplorazioni e negli arenamenti a contare segnalazioni è la riga
  // piccola, non il numero grande (che conta partenze e arenamenti, e una
  // segnalazione arenata due volte ne vale due): quindi è lei ad aprirsi.
  for (const id of ['proberTrovate', 'attesa', 'durata', 'arenatiFeedback']) {
    await page.locator(`[data-fs-id="${id}"]`).click();
    await expect(page.locator('#mgFsDrill'), `il riquadro «${id}» non apre niente`).toBeVisible();
    await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
    await page.locator('#mgFsDrillClose').click();
  }

  // Il riquadro del controllo di sicurezza porta tre numeri: si apre sulla sua
  // ripartizione, e ogni riga da lì porta alle segnalazioni contate.
  await page.locator('[data-fs-id="audit"]').click();
  await page.locator('[data-fs-bargroup="audit"][data-fs-bar="pass"]').click();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('sicurezza');
});

// ══ Le due barre in cima rispondono al tasto destro ════════════════════════

test('#496 il tasto destro sulle pasticche della finestra e del mittente offre le sue azioni', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1, createdAt: g(1) })], workerLog: [] });

  await page.locator('[data-fs-range="7g"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Copia la finestra');
  await page.keyboard.press('Escape');

  await page.locator('[data-fs-creator="user"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Solo Utente');
  // E la voce funziona: sceglie quel mittente e basta.
  await page.locator('.mg-ctxmenu .sn-select-option').first().click();
  expect(await page.evaluate(() => window.__mgTest.getFsState().creatori)).toEqual(['user']);
});

// ══ La finestra scritta a mano dice quale periodo stai guardando ═══════════
//
// I due campi seguono la lingua del sistema (su un computer non italiano
// scrivono mm/gg/aaaa) e due date messe al contrario si raddrizzano da sole:
// senza una riga che lo dica, il periodo guardato non lo sapeva nessuno.

test('#496 con le due date scelte a mano la scheda scrive la finestra che sta guardando', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1, createdAt: g(1) })], workerLog: [] });
  await page.locator('[data-fs-range="custom"]').click();

  await page.locator('#mgFsFrom').fill('2026-09-18');
  await page.locator('#mgFsTo').fill('2026-09-01');
  await page.locator('#mgFsTo').dispatchEvent('change');

  const riga = page.locator('#mgFsFinestra');
  await expect(riga).toContainText('dal 1/9/2026 al 18/9/2026');
  await expect(riga, 'il raddrizzamento delle due date resta muto').toContainText('raddrizzate');
});

// ══ La sezione della torta rende conto di ogni lavorazione contata ═════════
//
// Ogni lavorazione che il riquadro «Feedback lavorati» conta deve uscire da
// una porta sola della sezione sotto: una fetta, i fermati, quelle ancora in
// mezzo al giro, o una riga che dice perché non si sa. Fino al giro 18 si
// scartava in silenzio ogni lavorazione su cui il verificatore non era ancora
// partito, cioè ogni lavoro in mano alla correzione in quel momento: su
// quattrocento segnalazioni sparivano trentasei lavorazioni su quarantotto, e
// la riga che dichiarava chi restava fuori ne contava sette.

test('#496 ogni lavorazione contata esce da una porta della sezione della torta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 801, status: 'done', createdAt: g(6) }),                  // due verifiche
      fb({ seq: 802, status: 'working', createdAt: g(5) }),               // in correzione: mai verificato
      fb({ seq: 803, status: 'revision_capability', createdAt: g(4) }),   // verificato e rimandato
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(3), num: '801' },
      { role: 'verifier', startedAt: g(3), num: '801' },
      { role: 'fixer', startedAt: g(2), num: '801' },
      { role: 'verifier', startedAt: g(2), num: '801' },
      { role: 'new-work', startedAt: g(2), num: '802' },
      { role: 'fixer', startedAt: g(1), num: '802' },
      { role: 'new-work', startedAt: g(1), num: '803' },
      { role: 'verifier', startedAt: g(1), num: '803' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  const conti = await page.evaluate(() => {
    const n = (el) => Number((el.textContent || '').replace(/[^\d]/g, '')) || 0;
    const fette = Array.from(document.querySelectorAll('#mgFsLegend li .mg-fs-legend-n')).map(n);
    const aperti = document.querySelector('#mgFsEsiti [data-fs-esito="aperti"] b');
    return {
      lavorati: n(document.querySelector('[data-fs-id="lavorati"] .mg-tile-n')),
      fette: fette.reduce((s, v) => s + v, 0),
      aperti: n(aperti),
    };
  });
  expect(conti.lavorati).toBe(3);
  expect(conti.aperti, 'il lavoro in mano alla correzione è in mezzo al giro quanto gli altri').toBe(2);
  expect(conti.fette + conti.aperti, 'una lavorazione sparisce dalla sezione').toBe(conti.lavorati);

  // E da quel numero si arriva alle due segnalazioni, come da ogni altro.
  await page.locator('#mgFsEsiti [data-fs-esito="aperti"]').click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await expect(page.locator('#mgFsDrillList')).toContainText('#802');
});

// ══ Le due pasticche di gruppo del filtro per mittente ═════════════════════
//
// La segnalazione faceva un esempio solo: «i feedback della settimana scorsa
// lanciati da prober o altre routine cloud». Con una pasticca per mittente
// quell'esempio costava sei clic e la conoscenza di quale delle nove voci è
// una routine.

test('#496 «Routine» accende in un clic tutti i mittenti automatici', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, clientId: 'routine:prober', createdAt: g(1) }),
      fb({ seq: 2, clientId: 'routine:fixer', createdAt: g(1) }),
      fb({ seq: 3, clientId: 'persona@x.it', createdAt: g(1) }),
      fb({ seq: 4, clientId: 'owner:me', createdAt: g(1) }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();

  await page.locator('[data-fs-creator="__routine"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');
  await expect(page.locator('[data-fs-creator="__routine"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-fs-creator="__persone"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('2');

  // Ricliccata da accesa, la pasticca torna a «Tutti»: si può togliere quello
  // che si può mettere.
  await page.locator('[data-fs-creator="__persone"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('4');
  expect(await page.evaluate(() => window.__mgTest.getFsState().creatori)).toEqual([]);
});

// ══ La scelta si ricorda intera, o non si ricorda ══════════════════════════
//
// Ricordare la finestra ma non le sue due date rimandava «Scegli tu» con i
// campi vuoti, e una finestra senza estremi vuol dire TUTTO: i numeri erano
// quelli di sempre sotto una pasticca che prometteva un periodo scelto.

test('#496 la finestra scritta a mano e il filtro tornano interi alla riapertura', async ({ openTab }) => {
  const page = await openTab(URL);
  const dati = {
    feedbacks: [
      fb({ seq: 1, clientId: 'routine:prober', createdAt: g(1) }),
      fb({ seq: 2, clientId: 'persona@x.it', createdAt: g(1) }),
      fb({ seq: 3, clientId: 'persona@x.it', createdAt: g(40) }),
    ],
    workerLog: [],
  };
  await apri(page, dati);

  const giorno = (n) => new Date(Date.now() - n * GIORNO).toISOString().slice(0, 10);
  await page.locator('[data-fs-range="custom"]').click();
  await page.locator('#mgFsFrom').fill(giorno(2));
  await page.locator('#mgFsFrom').dispatchEvent('change');
  await page.locator('#mgFsTo').fill(giorno(0));
  await page.locator('#mgFsTo').dispatchEvent('change');
  await page.locator('[data-fs-creator="user"]').click();
  await expect(tile(page, 'ricevuti')).toHaveText('1');

  await page.reload();
  await apri(page, dati);

  await expect(page.locator('.mg-chip--on[data-fs-range]')).toHaveText('Scegli tu');
  await expect(page.locator('#mgFsFrom')).toHaveValue(giorno(2));
  await expect(page.locator('#mgFsTo')).toHaveValue(giorno(0));
  expect(await page.evaluate(() => window.__mgTest.getFsState().creatori)).toEqual(['user']);
  await expect(tile(page, 'ricevuti'), 'i numeri dopo la riapertura non sono quelli della finestra salvata').toHaveText('1');
});

// ══ Il riquadro delle esplorazioni sta dentro il filtro ════════════════════
//
// Il numero grande conta partenze, che un mittente non ce l'hanno: il filtro
// non lo tocca, e il suggerimento lo dice. La riga sotto conta SEGNALAZIONI,
// che un mittente ce l'hanno.

test('#496 col filtro sulle persone il riquadro non conta le segnalazioni dell\'esploratore', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, clientId: 'routine:prober', createdAt: g(1) }),
      fb({ seq: 2, clientId: 'routine:prober', createdAt: g(1) }),
      fb({ seq: 3, clientId: 'persona@x.it', createdAt: g(1) }),
    ],
    workerLog: [{ role: 'prober', startedAt: g(1), num: '' }],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('[data-fs-id="prober"] .mg-tile-sub')).toContainText('2 segnalazioni');

  await page.locator('[data-fs-creator="__persone"]').click();
  await expect(page.locator('[data-fs-id="prober"] .mg-tile-sub')).toContainText('0 segnalazioni');
  // Le partenze restano: un lancio non ha un mittente.
  await expect(tile(page, 'prober')).toHaveText('1');
  await expect(page.locator('[data-fs-id="prober"]')).not.toHaveClass(/mg-tile--click/);
});

// ══ Ogni numero si apre su cosa ha contato, anche da TASTIERA ══════════════
//
// La regola (patterns/un-numero-si-apre-su-cosa-ha-contato.md) chiede tre
// strade: clic, Invio o Spazio, tasto destro. I riquadri che aprono l'elenco
// delle segnalazioni nascevano come riquadri muti: il fuoco li saltava, quindi
// da tastiera quel numero non portava da nessuna parte, mentre i riquadri che
// si espandono, disegnati identici e sulla stessa fila, rispondevano a tutte e
// tre.

test('#496 i riquadri che aprono un elenco sono pulsanti: Invio e Spazio li aprono', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, status: 'done', createdAt: g(6), reviewedAt: g(5) }),
      fb({ seq: 2, clientId: 'routine:prober', createdAt: g(4) }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(4), num: '1' },
      { role: 'verifier', startedAt: g(3), num: '1' },
      { role: 'prober', startedAt: g(4) },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();

  // Per le esplorazioni si apre la riga piccola, l'unica delle due a contare
  // segnalazioni: da tastiera vale quanto un riquadro.
  for (const id of ['proberTrovate', 'attesa', 'durata']) {
    const riquadro = page.locator(`[data-fs-id="${id}"]`);
    await expect(riquadro, `«${id}» non si apre nemmeno col mouse`)
      .toHaveClass(id === 'proberTrovate' ? /mg-tile-sub--click/ : /mg-tile--click/);
    const fuoco = await page.evaluate((i) => {
      const el = document.querySelector(`[data-fs-id="${i}"]`);
      el.focus();
      return document.activeElement === el;
    }, id);
    expect(fuoco, `«${id}» non prende il fuoco da tastiera`).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#mgFsDrill'), `«${id}»: Invio non apre l'elenco`).toBeVisible();
    await page.locator('#mgFsDrillClose').click();
    await page.evaluate((i) => document.querySelector(`[data-fs-id="${i}"]`).focus(), id);
    await page.keyboard.press(' ');
    await expect(page.locator('#mgFsDrill'), `«${id}»: Spazio non apre l'elenco`).toBeVisible();
    await page.locator('#mgFsDrillClose').click();
  }
});

// ══ Senza la chiave dell'owner, dove sia arrivato un lavoro non si indovina ══

test('#496 un lavoro con lo stato cifrato non viene dato per «ancora in mezzo al giro»', async ({ openTab }) => {
  const page = await openTab(URL);
  const CIFRATO = 'FENC1:' + 'q'.repeat(48);
  await apri(page, {
    feedbacks: [fb({ seq: 1, status: CIFRATO, statusPublic: 'closed', createdAt: g(6) })],
    workerLog: [
      { role: 'new-work', startedAt: g(5), num: '1' },
      { role: 'verifier', startedAt: g(4), num: '1' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(tile(page, 'lavorati')).toHaveText('1');
  await expect(page.locator('#mgFsEsiti [data-fs-esito="aperti"] b')).toHaveText('0');
  await expect(page.locator('#mgFsPieHint')).toContainText('non leggibile con questa chiave');
});

// ══ «N verifiche» non promette un totale che non ha ════════════════════════

test('#496 la riga sotto «Feedback lavorati» dice che conta la finestra, non tutto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1, status: 'done', createdAt: g(30) })],
    workerLog: [
      { role: 'new-work', startedAt: g(20), num: '1' },
      { role: 'verifier', startedAt: g(19), num: '1' },
      { role: 'fixer', startedAt: g(18), num: '1' },
      { role: 'verifier', startedAt: g(17), num: '1' },
      // Gli ultimi due passaggi devono cadere DENTRO «Oggi», che parte dalla
      // mezzanotte: «dodici ore fa» lo è solo dopo mezzogiorno, e prima il
      // controllo trovava la finestra vuota (tests/helpers/istanti.mjs).
      { role: 'fixer', startedAt: oggiFa(12, 1000), num: '1' },
      { role: 'verifier', startedAt: oggiFa(9.6, 2000), num: '1' },
    ],
  });
  await page.locator('[data-fs-range="oggi"]').click();
  // La torta conta tutta la storia del lavoro: due critiche.
  await expect(page.locator('#mgFsLegend li[data-group]').first()).toContainText('2 critiche');
  // Quindi la riga sopra, che conta solo la finestra, non può dire «in tutto».
  const sotto = page.locator('[data-fs-id="lavorati"] .mg-tile-sub');
  await expect(sotto).toContainText('in questa finestra');
  await expect(sotto).not.toContainText('in tutto');
});

// ══ Restringere la finestra su una colonna che vale un anno ════════════════

test('#496 «Restringi la finestra a questo periodo» su una colonna-anno tiene l\'anno intero', async ({ openTab }) => {
  const page = await openTab(URL);
  const anno = new Date().getFullYear();
  await apri(page, {
    feedbacks: [
      fb({ seq: 1, createdAt: new Date(anno, 2, 5).toISOString() }),
      fb({ seq: 2, createdAt: new Date(anno, 8, 5).toISOString() }),
      fb({ seq: 3, createdAt: new Date(anno - 6, 1, 1).toISOString() }),
    ],
    workerLog: [],
  });
  await page.evaluate((a) => window.__mgTest.setFsRange('custom', { da: '1990-01-01', a: `${a}-12-31` }), anno);
  await expect(page.locator('#mgFsTrendHint')).toContainText('Una colonna per anno');

  await page.locator(`.mg-fs-trend-col[data-fs-punto="${anno}"]`).click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Restringi' }).click();
  await expect(tile(page, 'ricevuti'), 'restringendo a un anno le sue segnalazioni spariscono').toHaveText('2');
});

// ══ Una colonna vuota è un periodo come gli altri ══════════════════════════

test('#496 anche una colonna vuota del grafico si può scegliere col tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 1, createdAt: g(1) })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  const vuota = page.locator('.mg-fs-trend-col--zero').first();
  await expect(vuota).toHaveAttribute('data-fs-punto', /.+/);
  await vuota.click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Restringi' })).toBeVisible();
  // Dietro non c'è niente da aprire, e la voce che lo prometterebbe non c'è.
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Mostra' })).toHaveCount(0);
});

// ══ Un titolo fatto di soli spazi non è un titolo ══════════════════════════

test('#496 nell\'elenco una segnalazione senza titolo vero non resta una riga vuota', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ seq: 7, name: '   ', text: '', createdAt: g(1), reviewedAt: g(0.5) })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-id="ricevuti"]').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Mostra' }).click();
  await expect(page.locator('.mg-fs-drill-t').first()).toHaveText('(senza titolo)');
});

// ══ Un'esecuzione senza mestiere resta nel conto dei lanci ═════════════════

test('#496 un lancio senza mestiere non sparisce dal riquadro né dalla divisione', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [],
    workerLog: [
      { role: 'new-work', startedAt: g(2), num: '1' },
      { role: 'prober', startedAt: g(2) },
      { startedAt: g(1) },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await expect(tile(page, 'lanci')).toHaveText('3');
  await page.locator('[data-fs-tile="lanci"]').click();
  const righe = page.locator('.mg-fs-detail .mg-bar-row');
  await expect(righe).toHaveCount(3);
  await expect(page.locator('.mg-fs-detail')).toContainText('Sconosciuto');
});

// ══ «Tutto» non promette una fine che non ha ═══════════════════════════════

test('#496 il suggerimento di «Tutto» non dice «a oggi»', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ seq: 1, createdAt: g(1) })], workerLog: [] });
  const titolo = await page.locator('[data-fs-range="tutto"]').getAttribute('title');
  expect(titolo).not.toMatch(/a oggi/);
  expect(titolo).toMatch(/senza limiti di data/);
});

// ── Il registro non letto non è un registro vuoto ──────────────────────────
//
// Se la lettura del registro delle esecuzioni fallisce, i numeri che ne
// vengono non si conoscono. Scriverli 0 li fa leggere «non è partito niente»,
// che è il contrario di «non lo so»: sulla stessa schermata i riquadri dei
// tempi, davanti a un dato che manca, scrivono un trattino.

test('col registro irraggiungibile i suoi riquadri scrivono un trattino, non uno zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'ko1', seq: 1, status: 'done', createdAt: g(2) })],
    workerLog: [],
    logOk: false,
  });

  for (const id of ['lavorati', 'prober', 'lanci']) {
    await expect(tile(page, id), `«${id}» scrive un numero che nessuno ha letto`).toHaveText('—');
  }
  // E i riquadri lo dicono anche a parole: la riga in cima è scritta piccola.
  await expect(page.locator('[data-fs-id="lavorati"] .mg-tile-sub')).toContainText('registro');

  // Le tre righe di esito sotto la torta, stesso guasto, stessa risposta.
  const esiti = await page.locator('#mgFsEsiti').innerText();
  expect(/(^|\s)0(\s|$)/.test(esiti), `le righe di esito scrivono uno zero: «${esiti}»`).toBe(false);

  // E la sezione della torta non afferma che nessun lavoro è stato verificato.
  const sezione = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('#mgFsBody h3')).find((x) => /Quanto è costato/.test(x.textContent));
    return h ? h.closest('section').innerText.replace(/\s+/g, ' ') : '';
  });
  expect(/Nessun lavoro verificato/i.test(sezione), sezione).toBe(false);
  expect(/non si è letto|non si sa/i.test(sezione), sezione).toBe(true);
});

// ── Lo stato vuoto della torta non lascia un quadrato bianco ───────────────

test('senza lavori verificati la ciambella si toglie invece di lasciare un vuoto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'tv1', seq: 1, createdAt: g(1) }), fb({ _id: 'tv2', seq: 2, createdAt: g(2) })],
    workerLog: [],
  });
  await expect(page.locator('#mgFsPie [data-group]')).toHaveCount(0);
  const h = await page.locator('#mgFsPie').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(h, `la ciambella vuota occupa ancora ${h} pixel`).toBeLessThan(40);
  // La spiegazione c'è, una volta sola, sotto il titolo della sezione.
  await expect(page.locator('#mgFsPieVuoto')).toBeVisible();
  await expect(page.locator('#mgFsPieVuoto')).toContainText('Nessun lavoro verificato');
});

// ── L'elenco aperto sotto un numero segue i dati come il numero sopra ──────

test('l\'elenco aperto si aggiorna quando arriva una segnalazione nuova', async ({ openTab }) => {
  const page = await openTab(URL);
  const tre = [
    fb({ _id: 'el1', seq: 1, createdAt: g(3) }),
    fb({ _id: 'el2', seq: 2, createdAt: g(2) }),
    fb({ _id: 'el3', seq: 3, createdAt: g(1) }),
  ];
  await apri(page, { feedbacks: tre, workerLog: [] });
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await page.locator('#mgFsTiles [data-fs-bargroup="creatori"]').first().click();
  await expect(page.locator('#mgFsDrillList li')).toHaveCount(3);

  const quattro = tre.concat([fb({ _id: 'el4', seq: 4, createdAt: g(0.2) })]);
  await page.evaluate((f) => window.__mgTest.setFsData({ feedbacks: f, workerLog: [] }), quattro);
  await expect(page.locator('#mgFsTiles [data-fs-bargroup="creatori"]').first()).toContainText('4');
  await expect(page.locator('#mgFsDrillList li')).toHaveCount(4);
  await expect(page.locator('#mgFsDrillTitle')).toContainText('4');
});

// ── Anche «Tutti» è una pasticca come le altre ─────────────────────────────

test('la pasticca «Tutti» porta il suo numero e ha il suo menu', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'tt1', seq: 1, createdAt: g(1) }), fb({ _id: 'tt2', seq: 2, createdAt: g(2) })],
    workerLog: [],
  });
  await expect(page.locator('[data-fs-creator="__tutti"] .mg-chip-n')).toHaveText('2');
  await page.locator('[data-fs-creator="__tutti"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
});

// La porta gemella, sull'altra sorgente: la lettura delle segnalazioni è
// fallita e non c'è nemmeno un ripiego da cui contare.

test('senza le segnalazioni lette, «Feedback ricevuti» non scrive zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [], workerLog: [{ role: 'prober', startedAt: g(1) }], ripiego: true });
  await expect(tile(page, 'ricevuti')).toHaveText('—');
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-sub')).toContainText('non lette');
  // Il registro invece ha risposto: quel numero si sa e resta un numero.
  await expect(tile(page, 'lanci')).toHaveText('1');
});

// ── Il grafico e la sua scala stanno sullo stesso pezzo di riquadro ────────
// Con poche colonne il disegno viene stretto da un tetto di larghezza, mentre
// la riga delle date è giustificata agli estremi: la data di fine finiva a
// mezzo schermo dall'ultima colonna che nomina.

test('#496 la data di fine del grafico sta sotto l\'ultima colonna, non dall\'altra parte', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'sc1', seq: 1, createdAt: g(1) }), fb({ _id: 'sc2', seq: 2, createdAt: g(4) })],
    workerLog: [],
  });
  for (const key of ['7g', '30g']) {
    await page.locator(`[data-fs-range="${key}"]`).click();
    const m = await page.evaluate(() => {
      const t = document.getElementById('mgFsTrend');
      const cols = [...t.querySelectorAll('.mg-fs-trend-col')];
      const box = t.getBoundingClientRect();
      const ultima = cols[cols.length - 1].getBoundingClientRect();
      const spans = [...document.getElementById('mgFsTrendAxis').querySelectorAll('span')];
      const fine = spans[spans.length - 1];
      return {
        colonne: cols.length,
        finiscono: Math.round(ultima.right - box.left),
        xFine: Math.round(fine.getBoundingClientRect().right - box.left),
        etichetta: fine.textContent.trim(),
      };
    });
    expect(m.etichetta, `con «${key}» la scala non scrive la data di fine`).not.toBe('');
    expect(
      Math.abs(m.xFine - m.finiscono),
      `con «${key}» le ${m.colonne} colonne finiscono a ${m.finiscono} pixel e la data «${m.etichetta}» è scritta a ${m.xFine}`,
    ).toBeLessThan(120);
  }
});

// ── Il fuoco della tastiera sopravvive al giro di aggiornamento ────────────
// La pagina si rimette in pari ogni minuto e ridisegna questa scheda da capo,
// anche quando non è cambiato niente. Senza cura, chi la naviga senza mouse
// ricomincia dall'inizio della pagina una volta al minuto.

test('#496 un ridisegno non porta via il fuoco della tastiera', async ({ openTab }) => {
  const page = await openTab(URL);
  const dati = {
    feedbacks: [fb({ _id: 'fu1', seq: 1, status: 'done', createdAt: g(2) }), fb({ _id: 'fu2', seq: 2, createdAt: g(3) })],
    workerLog: [{ role: 'verifier', startedAt: g(1), num: '1' }],
  };
  await apri(page, dati);
  await page.locator('[data-fs-range="tutto"]').click();
  const persi = await page.evaluate((d) => {
    const out = [];
    for (const sel of ['[data-fs-range="7g"]', '[data-fs-creator="__routine"]', '[data-fs-tile="ricevuti"]', '#mgFsLegend li[data-group]']) {
      const el = document.querySelector(sel);
      if (!el) { out.push(sel + ' (non c\'è)'); continue; }
      el.focus();
      window.__mgTest.setFsData(d);
      const dopo = document.activeElement;
      if (!dopo || dopo === document.body || !dopo.matches(sel)) out.push(sel);
    }
    return out;
  }, dati);
  expect(persi, `il fuoco se n'è andato da: ${persi.join(', ')}`).toEqual([]);
});

// ── Un numero apre ciò che HA contato ─────────────────────────────────────
// Nel riquadro delle esplorazioni i numeri sono due: le partenze (in grande,
// che non sono segnalazioni) e i ritrovamenti (la riga piccola). Ad aprirsi
// dev'essere la seconda, e col suo numero.

test('#496 «Esplorazioni lanciate»: ad aprirsi è la riga che conta le segnalazioni', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'pr1', seq: 1, clientId: 'routine:prober', createdAt: g(1) })],
    workerLog: [
      { role: 'prober', startedAt: g(1) },
      { role: 'prober', startedAt: g(2) },
      { role: 'prober', startedAt: g(3) },
    ],
  });
  await page.locator('[data-fs-range="tutto"]').click();
  await expect(tile(page, 'prober')).toHaveText('3');
  // Il numero grande non promette di aprirsi: dietro non ci sono segnalazioni.
  await expect(page.locator('[data-fs-id="prober"]')).not.toHaveAttribute('type', 'button');
  // La riga piccola sì, e apre esattamente la sua segnalazione.
  const riga = page.locator('[data-fs-id="proberTrovate"]');
  await expect(riga).toContainText('1 segnalazione');
  await riga.click();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('1 segnalazione');
  await expect(page.locator('#mgFsDrillList li')).toHaveCount(1);
  // E si apre anche da tastiera, come ogni altra superficie della scheda.
  await page.locator('#mgFsDrillClose').click();
  await riga.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgFsDrill')).toBeVisible();
});

// ── Esc chiude il riquadro aperto ─────────────────────────────────────────

test('#496 Esc chiude l\'elenco aperto sotto un numero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [fb({ _id: 'es1', seq: 1, createdAt: g(1) }), fb({ _id: 'es2', seq: 2, createdAt: g(2) })],
    workerLog: [],
  });
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await page.locator('[data-fs-bargroup="categorie"]').first().click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mgFsDrill')).toBeHidden();
});

// ══ Un numero e l'elenco che apre dicono la stessa cifra ═══════════════════
//
// Il registro delle esecuzioni cita anche numeri che la lista delle
// segnalazioni non ha (le sue sono più vecchie, o sono state archiviate). Quei
// lavori si contano lo stesso — sono successi — e l'elenco che il numero apre
// li NOMINA, invece di lasciarli fuori in silenzio: prima un riquadro che
// diceva 3 apriva un elenco di 2 e il menu del tasto destro lo dichiarava da sé.

test('#496 un numero che conta anche lavori fuori dalla lista apre un elenco che li nomina', async ({ openTab }) => {
  const page = await openTab(URL);
  const noto = fb({ seq: 11, status: 'done', createdAt: g(3), reviewedAt: g(2), name: 'in lista' });
  await apri(page, {
    feedbacks: [noto],
    workerLog: [
      { role: 'fixer', startedAt: g(3), num: '11' },
      { role: 'verifier', startedAt: g(2), num: '11' },
      // 999: il registro lo cita, la lista non ce l'ha. Due istanti diversi,
      // quindi entra anche nella mediana della durata.
      { role: 'fixer', startedAt: g(4), num: '999' },
      { role: 'verifier', startedAt: g(3), num: '999' },
    ],
  });
  await page.locator('[data-fs-range="tutto"]').click();

  for (const [id, quanti] of [['lavorati', 2], ['durata', 2]]) {
    await page.locator(`[data-fs-id="${id}"]`).click({ button: 'right' });
    await expect(page.locator('.mg-ctxmenu')).toContainText(`le ${quanti} segnalazioni contate`);
    await page.locator('.mg-ctxmenu .sn-select-option').first().click();
    await expect(page.locator('#mgFsDrillTitle')).toContainText(`${quanti} segnalazioni`);
    await expect(page.locator('#mgFsDrillList li')).toHaveCount(quanti);
    // Il lavoro che la lista non ha resta visibile col suo numero.
    await expect(page.locator('#mgFsDrillList')).toContainText('#999');
    await page.locator('#mgFsDrillClose').click();
  }
});

test('#496 «Controlli di sicurezza passati» si apre sulle segnalazioni che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  const passato = fb({ seq: 21, status: 'done', createdAt: g(3), name: 'controllato', livelli: { l4: { esito: 'pass' } } });
  await apri(page, {
    feedbacks: [passato],
    workerLog: [{ role: 'fixer', startedAt: g(3), num: '21' }, { role: 'verifier', startedAt: g(3), num: '21' }],
  });
  await page.locator('[data-fs-range="tutto"]').click();

  await page.locator('[data-fs-id="audit"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Mostra la segnalazione contata');
  await page.locator('.mg-ctxmenu .sn-select-option').first().click();
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
});

test('#496 i lavori che la torta lascia fuori si possono guardare', async ({ openTab }) => {
  const page = await openTab(URL);
  // Passato, ma nel registro non c'è nessuna sua verifica: la torta lo lascia
  // fuori e lo dichiara in una frase. Quella frase è un conto come gli altri.
  const vecchio = fb({ seq: 31, status: 'done', createdAt: g(4), name: 'vecchio' });
  await apri(page, {
    feedbacks: [vecchio],
    workerLog: [{ role: 'fixer', startedAt: g(4), num: '31' }],
  });
  await page.locator('[data-fs-range="tutto"]').click();

  await expect(page.locator('#mgFsPieHint')).toContainText('più vecchie del registro');
  // Il numero dentro la frase si apre da solo…
  await page.locator('#mgFsPieHint [data-fs-esito="senzaGiri"]').click();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('più vecchie del registro');
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
  await page.locator('#mgFsDrillClose').click();
  // …e il tasto destro sulla frase intera offre i conti che ci stanno dentro.
  await page.locator('#mgFsPieHint').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Mostra');
});

// ══ I numeri si scrivono all'italiana ══════════════════════════════════════

test('#496 i numeri della scheda hanno la virgola sui decimali e il punto sulle migliaia', async ({ openTab }) => {
  const page = await openTab(URL);
  const feedbacks = [];
  for (let i = 0; i < 1200; i++) feedbacks.push(fb({ _id: 'it' + i, seq: 100 + i, createdAt: g(2), name: 't' + i }));
  // Due lavori passati, uno senza critiche e uno con una: media 0,5.
  const workerLog = [
    { role: 'fixer', startedAt: g(2), num: '100' },
    { role: 'verifier', startedAt: g(2), num: '100' },
    { role: 'fixer', startedAt: g(2), num: '101' },
    { role: 'verifier', startedAt: g(2), num: '101' },
    { role: 'verifier', startedAt: g(2), num: '101' },
  ];
  feedbacks[0].status = 'done';
  feedbacks[1].status = 'done';
  await apri(page, { feedbacks, workerLog });
  await page.locator('[data-fs-range="tutto"]').click();

  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('1.200');
  await expect(page.locator('#mgFsPieMid b')).toHaveText('0,5');
});

test('#496 la pasticca di un mittente apre le segnalazioni che il suo numero conta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ seq: 41, createdAt: g(1), name: 'di una persona' }),
      fb({ seq: 42, createdAt: g(1), name: 'dall\'esploratore', clientId: 'agent:prober' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="tutto"]').click();

  await page.locator('[data-fs-creator="prober"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Mostra la segnalazione contata');
  await page.locator('.mg-ctxmenu .sn-select-option').filter({ hasText: 'Mostra' }).click();
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
  // Il clic sulla pasticca resta il filtro: le due cose non si pestano.
  await page.locator('[data-fs-creator="prober"]').click();
  expect(await page.evaluate(() => window.__mgTest.getFsState().creatori)).toEqual(['prober']);
});
