// Giro 3 di verifica su #676.
//
// I giri 1 e 2 raccontavano la stessa famiglia: quello che le routine scrivono
// non arriva entro il minuto. Qui si ri-provano le porte di allora (una presa in
// carico fuori dal campione della coda; una segnalazione mandata da una macchina
// con l'ora indietro, insieme a una con l'ora giusta) e si guarda il rovescio
// del meccanismo con cui sono state chiuse: quanto costa, adesso, tenere aperta
// la dashboard.

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
async function fingiFirestore(app, docs, invii = 2) {
  await app.evaluate(async (_electron, { docs, ritmo, invii }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';

    globalThis.__docs = docs;
    globalThis.__invii = invii;
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
  }, { docs, ritmo: RITMO, invii });
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

// Porta del giro 2, ri-provata: una coda più lunga del campione, e la
// segnalazione che il server prende in mano sta in fondo, dove il giro non la
// guarda. Deve arrivare lo stesso.
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

// Porta del giro 2, ri-provata: due segnalazioni nello stesso minuto, una da una
// macchina con l'ora giusta e una da una con l'ora indietro di qualche ora.
// Devono comparire tutte e due.
test('due segnalazioni insieme, una con l\'ora indietro: arrivano entrambe', async ({ app, openTab }) => {
  const vecchio = fakeFb('due-old', 'Vecchia', { seq: 701, status: 'new' });
  await fingiFirestore(app, [vecchio], 701);
  const page = await apriGestione(openTab, [vecchio], 'inbox');
  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);

  await app.evaluate(() => {
    const ora = new Date();
    const indietro = new Date(ora.getTime() - 3 * 60 * 60 * 1000).toISOString();
    globalThis.__docs.push({
      _id: 'due-ok', _updateTime: 'n1', updatedAt: ora.toISOString(),
      text: 'Mandata da un orologio giusto.', name: 'Orologio giusto', seq: 702, subSeq: 0,
      clientId: 'a@example.com', createdAt: ora.toISOString(), images: [], status: 'new',
    });
    globalThis.__docs.push({
      _id: 'due-lenta', _updateTime: 'n2', updatedAt: indietro,
      text: 'Mandata da un orologio indietro.', name: 'Orologio indietro', seq: 703, subSeq: 0,
      clientId: 'b@example.com', createdAt: indietro, images: [], status: 'new',
    });
    globalThis.__invii = 703;
  });

  await expect(page.locator('.mg-item-title')).toContainText(['Orologio giusto'], { timeout: 8000 });
  await expect.poll(
    () => page.locator('.mg-item-title').allInnerTexts(),
    { timeout: 8000 },
  ).toContain('Orologio indietro');
});

// Il prezzo. Il registro dei worker dice ANCHE quale segnalazione è stata presa
// (il numero è dentro la voce), ma il giro butta via quel numero e chiede da
// capo l'elenco di tutta la pagina; e nel frattempo tiene d'occhio a ogni giro
// una dozzina di segnalazioni in coda per indovinare la prossima presa in
// carico, che il registro gli direbbe per nome. Con le routine al lavoro un
// avvio nuovo c'è quasi a ogni giro, e la rilettura completa torna a essere il
// caso normale: è il conto che la segnalazione voleva togliere, nel momento in
// cui l'owner tiene aperta la dashboard.
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

  // Sei worker che partono, come durante un giro di routine.
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
  // Il successo che si vorrebbe: un avvio costa la segnalazione che il registro
  // NOMINA, non l'elenco di tutta la pagina a ogni avvio.
  expect(rilettureComplete,
    `sei avvii di worker hanno fatto rileggere ${rilettureComplete} volte l'elenco completo (${documentiRiletti} documenti in tutto)`)
    .toBeLessThanOrEqual(1);
});

// E a database fermo, con le routine spente: il campione della coda si fa
// rileggere una dozzina di documenti a ogni giro, per sempre. La segnalazione
// chiedeva che un giro a vuoto costasse UNA lettura.
test('un giro a vuoto costa ancora una dozzina di letture', async ({ app, openTab }) => {
  const docs = [];
  for (let i = 1; i <= 20; i += 1) {
    docs.push(fakeFb(`fermo-${String(i).padStart(2, '0')}`, `Fermo ${i}`, {
      seq: 800 + i, status: 'todo',
      createdAt: `2026-09-${String(21 - i).padStart(2, '0')}T10:00:00Z`,
    }));
  }
  await fingiFirestore(app, docs);
  await apriGestione(openTab, docs, 'queue');
  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);

  const prima = await conta(app);
  await expect.poll(() => conta(app).then((c) => c.richieste), { timeout: 8000 })
    .toBeGreaterThanOrEqual(prima.richieste + 9); // tre giri, tre richieste ciascuno
  const dopo = await conta(app);
  const giri = Math.floor((dopo.richieste - prima.richieste) / 3);
  const perGiro = (dopo.documenti - prima.documenti) / Math.max(1, giri);
  expect(perGiro, `a database fermo ogni giro si fa restituire ${perGiro} documenti`).toBeLessThanOrEqual(2);
});
