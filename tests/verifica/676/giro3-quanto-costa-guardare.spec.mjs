// Giro 3 di verifica su #676. La famiglia di giri 1 e 2 era «quello che le
// routine scrivono non arriva entro il minuto»; qui si guarda il rovescio dello
// stesso meccanismo: QUANTO costa il giro adesso che quelle porte sono chiuse.
//
// Le tre prove:
//  1. una segnalazione che le routine prendono in mano fuori dal campione della
//     coda arriva lo stesso (il registro dei worker fa il suo mestiere);
//  2. ma il prezzo di quell'avviso è rileggere TUTTA la pagina, e con le
//     routine al lavoro l'avviso arriva a ogni giro: il conto torna a quello di
//     prima proprio mentre l'owner guarda;
//  3. Gestione lasciata in una scheda di sfondo continua a pagare, mentre prima
//     di questo lavoro una scheda non guardata non chiedeva niente.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RITMO = 200; // il giro, accorciato per lo spec

function fakeFb(id, name, extra = {}) {
  return {
    _id: id,
    _updateTime: 't1',
    updatedAt: '2026-09-01T10:00:00.000Z',
    text: `Testo di ${name}.`,
    name,
    seq: extra.seq || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: extra.createdAt || '2026-09-01T10:00:00Z',
    images: [],
    ...extra,
  };
}

// Firestore finto NEL MAIN, più il registro dei worker (che il giro legge dal
// documento delle automazioni): qui è una variabile, così la prova può far
// «partire un worker» quando vuole.
async function fingiFirestore(app, docs) {
  await app.evaluate(async (_electron, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';

    globalThis.__docs = docs;
    globalThis.__invii = 2;
    globalThis.__avvii = [];
    globalThis.__conta = { richieste: 0, documenti: 0, versioni: 0, seguiti: 0 };
    const FB = globalThis.SN_FEEDBACK;
    FB.listVersions = async () => {
      globalThis.__conta.richieste += 1;
      globalThis.__conta.versioni += 1;
      globalThis.__conta.documenti += globalThis.__docs.length;
      return globalThis.__docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.listChangedSince = async ({ since }) => {
      globalThis.__conta.richieste += 1;
      const rows = globalThis.__docs.filter((d) => d.updatedAt > since);
      globalThis.__conta.documenti += rows.length;
      return { rows, complete: true };
    };
    FB.getManyPublic = async () => [];
    FB.versionsOf = async (ids) => {
      globalThis.__conta.richieste += 1;
      globalThis.__conta.seguiti += 1;
      const trovati = globalThis.__docs.filter((d) => ids.includes(d._id));
      globalThis.__conta.documenti += trovati.length;
      return trovati.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.getMany = async (ids) => {
      globalThis.__conta.richieste += 1;
      const trovati = globalThis.__docs.filter((d) => ids.includes(d._id));
      globalThis.__conta.documenti += trovati.length;
      return trovati;
    };
    FB.submissionCount = async () => { globalThis.__conta.richieste += 1; return globalThis.__invii; };
    globalThis.__filoDefaults.getWorkerLog = async () => globalThis.__avvii;
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: RITMO });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);

async function apriGestione(openTab, docs, tab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, tab }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
    window.__mgTest.setTab(tab);
    window.__mgTest.resumeLive();
  }, { docs, tab });
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe', watch: window.__mgTest.idsDaSeguire() });
  });
  return page;
}

// Una coda più lunga del campione: la segnalazione che il server prende in mano
// sta in fondo, dove il giro non la guarda. Deve arrivare lo stesso.
test('una presa in carico fuori dal campione della coda arriva in lista', async ({ app, openTab }) => {
  const docs = [];
  for (let i = 1; i <= 20; i += 1) {
    docs.push(fakeFb(`coda-${String(i).padStart(2, '0')}`, `Coda ${i}`, {
      seq: 400 + i, status: 'todo',
      createdAt: `2026-09-${String(21 - i).padStart(2, '0')}T10:00:00Z`,
    }));
  }
  await fingiFirestore(app, docs);
  const page = await apriGestione(openTab, docs, 'queue');

  const seguiti = await page.evaluate(() => window.__mgTest.idsDaSeguire());
  expect(seguiti).not.toContain('coda-18');

  // Il server prende in mano la diciottesima: riscrive lo stato SENZA firmare
  // l'ora (è quello che fa oggi) e segna l'avvio nel registro dei worker.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'coda-18');
    d.status = 'working';
    d.name = 'Coda 18 — presa in carico';
    d._updateTime = 't2';
    globalThis.__avvii = [{ role: 'resolver', startedAt: new Date().toISOString(), num: '#418' }];
  });

  await expect(page.locator('.mg-item-title').first()).toHaveText('Coda 18 — presa in carico', { timeout: 8000 });
});

// Il prezzo di quell'avviso. Il registro dei worker dice ANCHE quale
// segnalazione è stata presa (il numero è dentro la voce), ma il giro butta via
// quel numero e chiede da capo l'elenco di tutta la pagina. Con le routine al
// lavoro un avvio nuovo c'è quasi a ogni giro, e la rilettura completa torna a
// essere il caso normale: è esattamente il conto che la segnalazione voleva
// togliere, nel momento in cui l'owner tiene aperta la dashboard.
test('con le routine al lavoro la dashboard rilegge di nuovo tutta la pagina a ogni giro', async ({ app, openTab }) => {
  const docs = [];
  for (let i = 1; i <= 20; i += 1) {
    docs.push(fakeFb(`lav-${String(i).padStart(2, '0')}`, `Lavoro ${i}`, {
      seq: 500 + i, status: 'todo',
      createdAt: `2026-09-${String(21 - i).padStart(2, '0')}T10:00:00Z`,
    }));
  }
  await fingiFirestore(app, docs);
  await apriGestione(openTab, docs, 'queue');

  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);
  const apertura = await conta(app);

  // Un worker che parte, come durante un giro di routine.
  let n = 0;
  const avvio = () => app.evaluate((_electron, k) => {
    globalThis.__avvii = [{ role: 'resolver', startedAt: `2026-09-24T10:${String(k).padStart(2, '0')}:00Z`, num: `#${500 + k}` }];
  }, (n += 1));

  for (let i = 0; i < 6; i += 1) {
    await avvio();
    await new Promise((r) => setTimeout(r, RITMO * 3));
  }

  const dopo = await conta(app);
  const rilettureComplete = dopo.versioni - apertura.versioni;
  const documentiRiletti = dopo.documenti - apertura.documenti;
  console.log('DIAG', JSON.stringify({ apertura, dopo }));
  expect(dopo.richieste - apertura.richieste, 'il giro deve aver girato').toBeGreaterThan(5);
  // Il successo che si vorrebbe: un avvio costa la segnalazione che il registro
  // NOMINA, non l'elenco di tutta la pagina.
  expect(rilettureComplete,
    `sei avvii di worker hanno fatto rileggere ${rilettureComplete} volte l'elenco completo (${documentiRiletti} documenti)`)
    .toBeLessThanOrEqual(1);
});

// Gestione in una scheda di sfondo. Prima di questo lavoro il giro stava nella
// pagina e si fermava quando la scheda non era in vista: una dashboard aperta e
// non guardata non chiedeva niente. Adesso il giro sta nel processo principale
// e non sa se qualcuno stia guardando: continua a pagare finché la scheda è
// aperta, anche per giorni.
test('Gestione in sottofondo, che nessuno guarda, continua a pagare', async ({ app, openTab }) => {
  const docs = [
    fakeFb('sf-a', 'Primo', { seq: 601, status: 'todo' }),
    fakeFb('sf-b', 'Secondo', { seq: 602, status: 'todo', createdAt: '2026-09-02T10:00:00Z' }),
  ];
  await fingiFirestore(app, docs);
  const page = await apriGestione(openTab, docs, 'queue');
  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);

  // Un'altra scheda davanti: quella di Gestione passa in secondo piano.
  const altra = await openTab('filo://newtab/newtab.html');
  await altra.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.evaluate(() => document.hidden), { timeout: 5000 }).toBe(true);

  const fermo = await conta(app);
  await new Promise((r) => setTimeout(r, RITMO * 6));
  const dopo = await conta(app);
  expect(dopo.richieste,
    `con Gestione in sottofondo il giro ha fatto altre ${dopo.richieste - fermo.richieste} richieste`)
    .toBe(fermo.richieste);
});
