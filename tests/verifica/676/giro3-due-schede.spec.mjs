// Giro 3 di verifica su #676: la segnalazione chiedeva che più schede di
// Gestione aperte insieme non moltiplicassero il giro, e che il giro unico
// avvisasse TUTTE le pagine. Qui si guardano entrambe le metà: la seconda
// scheda vede il cambiamento come la prima, e il giro resta uno.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RITMO = 200;

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

async function fingiFirestore(app, docs) {
  await app.evaluate(async (_electron, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__conta = { versioni: 0, cambiati: 0 };
    const FB = globalThis.SN_FEEDBACK;
    FB.listVersions = async () => {
      globalThis.__conta.versioni += 1;
      return globalThis.__docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.listChangedSince = async ({ since }) => {
      globalThis.__conta.cambiati += 1;
      return { rows: globalThis.__docs.filter((d) => d.updatedAt > since), complete: true };
    };
    FB.getManyPublic = async () => [];
    FB.versionsOf = async (ids) => globalThis.__docs
      .filter((d) => ids.includes(d._id))
      .map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    FB.getMany = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id));
    FB.submissionCount = async () => 2;
    globalThis.__filoDefaults.getWorkerLog = async () => [];
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: RITMO });
}

async function apriGestione(openTab, docs) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
    window.__mgTest.setTab('inbox');
    window.__mgTest.resumeLive();
  }, { docs });
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe', watch: window.__mgTest.idsDaSeguire() });
  });
  return page;
}

test('due schede di Gestione: il cambiamento arriva a tutte e due, e il giro resta uno', async ({ app, openTab }) => {
  const A = fakeFb('ds-a', 'Primo', { seq: 901, status: 'new' });
  const B = fakeFb('ds-b', 'Secondo', { seq: 902, status: 'new', createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B]);

  const prima = await apriGestione(openTab, [B, A]);
  const seconda = await apriGestione(openTab, [B, A]);
  await expect(prima.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo']);
  await expect(seconda.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo']);

  const fermo = await app.evaluate(() => ({ ...globalThis.__conta }));
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'ds-a');
    d.name = 'Primo, riscritto';
    d._updateTime = 't2';
    d.updatedAt = new Date().toISOString();
  });

  await expect(prima.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo, riscritto'], { timeout: 8000 });
  await expect(seconda.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo, riscritto'], { timeout: 8000 });

  // Un giro solo: la domanda «cosa è cambiato?» non si fa due volte per giro.
  const dopo = await app.evaluate(() => ({ ...globalThis.__conta }));
  const giri = dopo.cambiati - fermo.cambiati;
  expect(dopo.versioni, 'nessuna rilettura completa in più per la seconda scheda').toBe(fermo.versioni);
  expect(giri, `con due schede aperte la domanda del giro è partita ${giri} volte`).toBeLessThanOrEqual(12);
});
