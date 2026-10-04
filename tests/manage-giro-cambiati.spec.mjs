// Quanto costa tenere aperta la Gestione (#676), contato sul cammino vero:
// Firestore è sostituito NEL MAIN (le letture di SN_FEEDBACK e il registro dei
// worker), la pagina è quella vera, coi tempi del giro accorciati.
// Si asserisce quello che vede l'owner: tutti i feedback all'apertura, il
// cambiato aggiornato entro il giro, niente letture con la Gestione non in vista.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const TEMPI = { pollMs: 400, rientroMs: 200, clockMs: 100 };

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
    ...extra,
  };
}

// Firestore finto nel main: conta richieste e documenti per ogni lettura.
async function fingiFirestore(app, docs, { registro = [], numeri = {} } = {}) {
  await app.evaluate(async (_electron, { docs, registro, numeri, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__registro = registro;
    globalThis.__conta = { tutti: 0, tuttiDoc: 0, cambiati: 0, cambiatiDoc: 0, seguiti: [], getMany: 0, getManyDoc: 0, numeri: [], registro: 0, contatori: 0 };
    const C = globalThis.__conta;
    const FB = globalThis.SN_FEEDBACK;
    const copia = (d) => JSON.parse(JSON.stringify(d));
    FB.listAllPaged = async () => { C.tutti += 1; C.tuttiDoc += globalThis.__docs.length; return { rows: globalThis.__docs.map(copia), complete: true }; };
    FB.listChangedSince = async ({ since }) => {
      C.cambiati += 1;
      const rows = globalThis.__docs.filter((d) => d.updatedAt > since).map(copia);
      C.cambiatiDoc += rows.length;
      // Come Firestore, che rimanda l'ora della lettura anche senza documenti: il giro ci prende il confine.
      return { rows, complete: true, readTime: new Date().toISOString() };
    };
    FB.versionsOf = async (ids) => {
      C.seguiti.push(ids.slice());
      return globalThis.__docs.filter((d) => ids.includes(d._id)).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
    };
    FB.getMany = async (ids) => {
      C.getMany += 1;
      const rows = globalThis.__docs.filter((d) => ids.includes(d._id)).map(copia);
      C.getManyDoc += rows.length;
      return rows;
    };
    FB.submissionCount = async () => { C.contatori += 1; return 1000; };
    FB.idDelNumero = async (num) => { C.numeri.push(num); return numeri[num] || null; };
    FB.getManyPublic = async () => [];
    FB.listAllPublic = async () => [];
    FB.listResolved = async () => [];
    globalThis.__filoDefaults.getWorkerLog = async () => { C.registro += 1; return globalThis.__registro.slice(); };
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, registro, numeri, ritmo: TEMPI.pollMs });
}

const conta = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__conta)));

async function apriGestione(openTab) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((t) => { window.__mgTest.setAdmin(true); window.__mgTest.setLiveTiming(t); }, TEMPI);
  return page;
}

test('apertura: tutti i feedback; poi ogni giro chiede solo i cambiati, e il cambiato compare', async ({ app, openTab }) => {
  // 520 feedback: il vecchio sta oltre i primi 500 per data, col createdAt
  // scritto come TESTO (i sotto-feedback creati dal server).
  const docs = [];
  for (let i = 0; i < 519; i += 1) {
    docs.push(fakeFb(`f${i}`, `Feedback ${i}`, { seq: 1000 + i, createdAt: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString() }));
  }
  const vecchio = fakeFb('vecchio', 'Tornato nei ricevuti', { seq: 530, createdAt: '2025-09-03T10:00:00.000Z' });
  docs.push(vecchio);
  await fingiFirestore(app, docs);

  const page = await apriGestione(openTab);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect.poll(() => page.evaluate(() => window.__mgTest.currentOrder().length), { timeout: 30000 }).toBe(520);
  const ordine = await page.evaluate(() => window.__mgTest.currentOrder());
  expect(ordine).toContain('vecchio');
  // Nessun «(500+)»: il tetto non c'è più.
  await expect(page.locator('body')).not.toContainText('500+');

  const dopoApertura = await conta(app);
  expect(dopoApertura.tutti).toBe(1);

  // Tre giri a database fermo: tre domande, zero documenti, niente riletture.
  await expect.poll(() => conta(app).then((c) => c.cambiati), { timeout: 10000 }).toBeGreaterThanOrEqual(3);
  const fermo = await conta(app);
  expect(fermo.tutti).toBe(1, 'nessuna rilettura completa');
  expect(fermo.cambiatiDoc).toBe(0, 'un giro a vuoto non porta documenti');
  expect(fermo.getManyDoc).toBe(0);

  // Un feedback cambia: compare aggiornato entro il giro, e costa UN documento.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'f3');
    d.name = 'Riscritto adesso';
    d._updateTime = 't2';
    d.updatedAt = new Date().toISOString();
  });
  await expect(page.locator('.mg-item-title', { hasText: 'Riscritto adesso' })).toHaveCount(1, { timeout: 5000 });
  const dopo = await conta(app);
  expect(dopo.tutti).toBe(1);
  // Il margine per gli orologi rimanda la stessa riga per qualche giro: al più una per giro.
  expect(dopo.cambiatiDoc).toBeGreaterThanOrEqual(1);
  expect(dopo.cambiatiDoc).toBeLessThanOrEqual(dopo.cambiati - fermo.cambiati);

  // La Gestione esce di vista (un'altra scheda davanti): il giro si ferma.
  await openTab('filo://newtab/');
  await new Promise((r) => setTimeout(r, TEMPI.pollMs * 2));
  const nascosta = await conta(app);
  await new Promise((r) => setTimeout(r, TEMPI.pollMs * 5));
  const ancora = await conta(app);
  expect(ancora.cambiati).toBe(nascosta.cambiati);
  expect(ancora.registro).toBe(nascosta.registro);
  expect(ancora.contatori).toBe(nascosta.contatori);
});

// #676.1: chi le routine hanno preso lo dice il registro, col numero. Il giro
// rilegge quel feedback, e poi lo segue con l'ora di Firestore anche se il
// server lo riscrive senza firmare `updatedAt`. Niente campione della coda.
test('il registro dei worker porta il nome: quel feedback si rilegge e si segue, gli altri no', async ({ app, openTab }) => {
  const A = fakeFb('coda-a', 'Primo in coda', { seq: 31, status: 'todo' });
  const B = fakeFb('coda-b', 'Secondo in coda', { seq: 32, status: 'todo', createdAt: '2026-09-02T10:00:00Z' });
  const voce = { startedAt: '2026-10-04T08:00:00Z', num: '5', role: 'verifier' };
  await fingiFirestore(app, [A, B], { registro: [voce], numeri: { 32: 'coda-b' } });

  const page = await apriGestione(openTab);
  await expect.poll(() => page.evaluate(() => window.__mgTest.riga('coda-b') && window.__mgTest.riga('coda-b').name), { timeout: 15000 }).toBe('Secondo in coda');
  await expect.poll(() => conta(app).then((c) => c.registro), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  const prima = await conta(app);
  expect(prima.seguiti.flat()).toEqual([], 'nessuno in mano alle routine: nessuna lettura di versioni');

  // Il server prende #32 e lo riscrive senza firmare l'ora.
  await app.evaluate(() => {
    globalThis.__registro.unshift({ startedAt: '2026-10-04T09:00:00Z', num: '32', role: 'new-work' });
    const d = globalThis.__docs.find((x) => x._id === 'coda-b');
    d.status = 'working';
    d.name = 'Preso dalle routine';
    d._updateTime = 't2';
  });
  await expect.poll(() => page.evaluate(() => window.__mgTest.riga('coda-b').name), { timeout: 5000 }).toBe('Preso dalle routine');
  const preso = await conta(app);
  expect(preso.numeri).toEqual(['32']);
  expect(preso.tutti).toBe(1, 'il registro non fa rileggere tutto');

  // Riscritto ancora senza firma: arriva lo stesso, e si legge solo lui.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'coda-b');
    d.name = 'Lavoro a metà';
    d._updateTime = 't3';
  });
  await expect.poll(() => page.evaluate(() => window.__mgTest.riga('coda-b').name), { timeout: 5000 }).toBe('Lavoro a metà');
  const fine = await conta(app);
  expect(fine.seguiti.every((ids) => ids.length === 1 && ids[0] === 'coda-b')).toBe(true);
  expect(fine.tutti).toBe(1);
});

// Un avviso del giro (lettura interrotta, tetto dei seguiti, registro illeggibile) si vede senza passarci sopra.
test('un avviso del giro si vede sull\'intestazione della lista, e sparisce col giro pulito', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'a1', _updateTime: 't1', name: 'Uno', text: 'x', seq: 1, subSeq: 0, status: 'design', createdAt: '2026-09-01T10:00:00Z' }]);
    window.__mgTest.setTab('inbox');
  });
  const head = page.locator('#mgListHead');
  const dopo = () => head.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(await dopo()).toBe('none');
  await page.evaluate(() => window.__mgTest.liveMessage({ kind: 'changed', rows: [], avvisi: ['cambiati: troppe pagine, riallineamento completo al giro dopo'] }));
  await expect(head).toHaveAttribute('title', /troppe pagine/);
  expect(await dopo()).toContain('!');
  // Un giro che porta anche righe ridisegna il conteggio: la spiegazione dell'avviso resta.
  await page.evaluate(() => window.__mgTest.liveMessage({ kind: 'changed', rows: [{ _id: 'a2', _updateTime: 't2', name: 'Due', text: 'x', seq: 2, subSeq: 0, status: 'design', createdAt: '2026-09-02T10:00:00Z' }], avvisi: ['seguiti: 600 sopra il tetto di 500'] }));
  await expect(page.locator('.mg-item[data-id="a2"]')).toHaveCount(1);
  await expect(head).toHaveAttribute('title', /Aggiornamento: seguiti: 600/);
  await page.evaluate(() => window.__mgTest.liveMessage({ kind: 'changed', rows: [] }));
  await expect.poll(dopo).toBe('none');
  expect(await head.getAttribute('title') || '').not.toContain('Aggiornamento');
});
