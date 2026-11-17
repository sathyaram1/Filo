// #2470: quanto legge la Gestione quando la si riapre, quando si guardano le statistiche e quando si cambia scheda,
// contato sul cammino vero: Firestore è finto NEL MAIN, le funzioni del server sono un server finto locale.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

let server;
const chiamate = { fusioni: 0 };
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const data = (() => { try { return JSON.parse(corpo).data || {}; } catch (_) { return {}; } })();
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/ownerMergeApprovals') && data.op === 'list') {
        chiamate.fusioni += 1;
        res.end(JSON.stringify({ result: { ok: true, pending: [], failed: [], recent: [], preapproved: [] } }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});
test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

function riga(i) {
  return {
    _id: `f${i}`, _updateTime: 't1', updatedAt: '2026-09-01T10:00:00.000Z', name: `Feedback ${i}`, text: 'x',
    seq: 100 + i, subSeq: 0, clientId: 'tester@example.com',
    createdAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
  };
}

async function fingiFirestore(app, docs) {
  await app.evaluate(async (_e, docs) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    const C = globalThis.__conta = { tutti: 0, tuttiDoc: 0, cambiati: 0, conti: 0, schedeTutte: 0 };
    const FB = globalThis.SN_FEEDBACK;
    const copia = (d) => JSON.parse(JSON.stringify(d));
    FB.listAllPaged = async () => { C.tutti += 1; C.tuttiDoc += globalThis.__docs.length; return { rows: globalThis.__docs.map(copia), complete: true, readTime: new Date().toISOString() }; };
    FB.listChangedSince = async ({ since }) => {
      C.cambiati += 1;
      return { rows: globalThis.__docs.filter((d) => d.updatedAt > since).map(copia), complete: true, readTime: new Date().toISOString() };
    };
    FB.countAll = async () => { C.conti += 1; return globalThis.__docs.length; };
    FB.controlloLeggero = async () => ({ count: globalThis.__docs.length, ultimo: null });
    FB.versionsOf = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
    FB.getMany = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map(copia);
    FB.submissionCount = async () => 1000;
    FB.getManyPublic = async () => [];
    FB.listAllPublic = async () => { C.schedeTutte += 1; return []; };
    FB.listPublicChangedSince = async () => ({ rows: [], complete: true });
    FB.listResolved = async () => [];
    globalThis.__filoDefaults.getWorkerLog = async () => [];
  }, docs);
}

const conta = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__conta)));

async function apriGestione(openTab, n) {
  return pronta(await openTab(URL), n);
}

async function pronta(page, n) {
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect.poll(() => page.evaluate(() => window.__mgTest.currentOrder().length), { timeout: 30000 }).toBe(n);
  return page;
}

test('riaperta, la Gestione chiede i cambiati e il conto; le statistiche contano dalla lista in pagina', async ({ app, openTab }) => {
  const docs = Array.from({ length: 40 }, (_, i) => riga(i));
  await fingiFirestore(app, docs);
  const prima = await apriGestione(openTab, 40);
  expect((await conta(app)).tutti).toBe(1);

  // Mentre era chiusa una segnalazione è cambiata e ne è arrivata una.
  await app.evaluate(() => {
    const ora = new Date().toISOString();
    Object.assign(globalThis.__docs.find((d) => d._id === 'f3'), { name: 'Riscritto mentre era chiusa', _updateTime: 't2', updatedAt: ora });
    globalThis.__docs.push({ ...globalThis.__docs[0], _id: 'nuovo', seq: 999, name: 'Arrivato adesso', _updateTime: 't1', updatedAt: ora });
  });
  // La Gestione si riapre ricaricandola: una scheda di Filo già aperta non se ne fa una seconda.
  await prima.reload();
  const seconda = await pronta(prima, 41);
  await expect(seconda.locator('.mg-item-title', { hasText: 'Riscritto mentre era chiusa' })).toHaveCount(1);
  await expect(seconda.locator('.mg-item-title', { hasText: 'Arrivato adesso' })).toHaveCount(1);
  const dopo = await conta(app);
  expect(dopo.tutti, 'nessuna seconda lettura di tutti i feedback').toBe(1);
  expect(dopo.conti).toBeGreaterThanOrEqual(1);
  expect(dopo.schedeTutte, 'le schede pubbliche non si rileggono tutte').toBeLessThanOrEqual(1);

  await apriScheda(seconda, 'fbstats');
  await seconda.locator('[data-fs-range="30g"]').click();
  await expect(seconda.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('41', { timeout: 15000 });
  expect((await conta(app)).tutti, 'le statistiche non rileggono tutto').toBe(1);
});

test('cambiare scheda non richiede le fusioni ogni volta; dopo una decisione sì', async ({ app, openTab }) => {
  await fingiFirestore(app, [riga(1)]);
  const page = await apriGestione(openTab, 1);
  await expect.poll(() => chiamate.fusioni, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  const prima = chiamate.fusioni;
  for (const t of ['automation', 'inbox', 'log', 'inbox', 'automation']) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((x) => window.__mgTest.setTab(x), t);
  }
  await page.waitForTimeout(800);
  expect(chiamate.fusioni - prima, 'cinque cambi di scheda leggono la copia del main').toBe(0);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals(null, { fresco: true }));
  expect(chiamate.fusioni - prima).toBe(1);
});
