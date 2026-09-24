// Verifica #676, giro 2: la dashboard in secondo piano deve smettere di pagare.
//
// La segnalazione dice cosa NON cambia: «il giro resta ogni 60 secondi e resta
// il controllo al ritorno sulla finestra». Prima di questo lavoro il giro lo
// batteva la PAGINA e si fermava quando la scheda passava in secondo piano
// (`document.hidden`): una Gestione dimenticata in un'altra scheda non costava
// niente, e al ritorno un giro subito rimetteva tutto in pari. Adesso il giro
// lo batte il processo main con un timer suo, e nessuno guarda più se qualcuno
// stia guardando: continua a chiedere per sempre, riallineamento completo
// compreso.
//
// Lo spec porta Gestione in secondo piano e conta: le richieste non devono
// crescere finché nessuno guarda.

import { test, expect } from '../../fixtures/electron.mjs';

const URL_MANAGE = 'filo://manage/manage.html';
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

async function fingiFirestore(app, docs) {
  await app.evaluate(async (_electron, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__invii = 2;
    globalThis.__conta = { richieste: 0, documenti: 0, versioni: 0 };
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
      return globalThis.__docs.filter((d) => ids.includes(d._id))
        .map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.getMany = async (ids) => {
      globalThis.__conta.richieste += 1;
      return globalThis.__docs.filter((d) => ids.includes(d._id));
    };
    FB.submissionCount = async () => {
      globalThis.__conta.richieste += 1;
      return globalThis.__invii;
    };
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: RITMO });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);

test('Gestione passata in secondo piano smette di chiedere', async ({ app, openTab, testServer }) => {
  const A = fakeFb('nasc-a', 'Primo', { seq: 41, status: 'working' });
  const B = fakeFb('nasc-b', 'Secondo', { seq: 42, status: 'todo', createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B]);

  const page = await openTab(URL_MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ A, B }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([B, A]);
    window.__mgTest.setTab('queue');
    window.__mgTest.resumeLive();
  }, { A, B });
  await expect(page.locator('.mg-item-title')).toHaveText(['Primo', 'Secondo']);

  // Il giro riparte col ritmo corto.
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe' });
  });
  await expect.poll(() => conta(app).then((c) => c.richieste), { timeout: 5000 }).toBeGreaterThanOrEqual(3);

  // L'owner passa a un'altra scheda: Gestione va in secondo piano e Chromium
  // la dichiara nascosta (le schede non attive ricevono setVisible(false)).
  await openTab(testServer.html('<html><body><h1>Altrove</h1></body></html>'));
  await expect.poll(() => page.evaluate(() => document.hidden), { timeout: 5000 }).toBe(true);

  // Da qui in poi nessuno guarda: il conto non deve muoversi.
  await new Promise((r) => setTimeout(r, RITMO * 4));
  const fermo = await conta(app);
  await new Promise((r) => setTimeout(r, RITMO * 8));
  const dopo = await conta(app);
  expect(dopo.richieste).toBe(fermo.richieste);
  expect(dopo.versioni).toBe(fermo.versioni);
});
