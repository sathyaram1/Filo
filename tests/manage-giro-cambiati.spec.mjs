// Spec Playwright: quanto costa tenere aperta la dashboard di gestione (#676).
//
// Prima, ogni pagina di Gestione chiedeva a Firestore i nomi di TUTTA la
// collezione ogni sessanta secondi: centinaia di letture al minuto a database
// fermo. Adesso il giro è uno solo (nel main) e chiede i soli feedback scritti
// dall'ultimo giro: a vuoto è una richiesta che non torna nessun documento.
//
// Lo spec CONTA — richieste e documenti restituiti — su tre giri senza
// cambiamenti e su un giro con un feedback cambiato, e poi asserisce la cosa
// che conta davvero: il feedback cambiato COMPARE aggiornato nella lista
// entro il giro. Firestore è sostituito nel main (le due letture del giro),
// così il conteggio è quello vero del cammino di produzione.

import { test, expect } from './fixtures/electron.mjs';

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

// Firestore finto NEL MAIN: conta le richieste e i documenti che tornano.
async function fingiFirestore(app, docs) {
  await app.evaluate(async ({ app: electronApp }, { docs, ritmo }) => {
    const nodePath = require('node:path');
    const auth = require(nodePath.join(electronApp.getAppPath(), 'src', 'main', 'auth', 'google-auth.js'));
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';

    globalThis.__docs = docs;
    globalThis.__conta = { richieste: 0, documenti: 0, versioni: 0, schede: 0 };
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
    // Le schede pubbliche: il giro non deve toccarle quando non cambia niente.
    FB.getManyPublic = async (ids) => { globalThis.__conta.schede += ids.length; return []; };
    // Il ritmo del giro lo legge chi accende il timer: accorciarlo qui basta.
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);

test('il giro al minuto chiede solo i cambiati, e il cambiato compare in lista', async ({ app, openTab }) => {
  const A = fakeFb('giro-a', 'Primo', { seq: 21 });
  const B = fakeFb('giro-b', 'Secondo', { seq: 22, createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B]);

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  // La lista in pagina (il caricamento vero non ha Firestore) e il canale del
  // giro riaperto sopra i dati finti.
  await page.evaluate(({ A, B }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([B, A]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.resumeLive();
  }, { A, B });
  await expect(page.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo']);

  // Il giro riparte col ritmo corto: spento e riacceso, così il main rifà il
  // timer leggendo il ritmo nuovo.
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe' });
  });

  // Primo giro: il riallineamento d'apertura — l'unico che legge tutta la
  // pagina, e per questo raro (mezz'ora).
  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);
  const dopoApertura = await conta(app);
  expect(dopoApertura.documenti).toBe(2);

  // TRE GIRI SENZA CAMBIAMENTI: tre richieste, zero documenti, zero schede.
  await expect.poll(() => conta(app).then((c) => c.richieste), { timeout: 5000 })
    .toBeGreaterThanOrEqual(dopoApertura.richieste + 3);
  const fermo = await conta(app);
  expect(fermo.versioni).toBe(1);
  expect(fermo.documenti).toBe(dopoApertura.documenti);
  expect(fermo.schede).toBe(0);

  // UN GIRO CON UN FEEDBACK CAMBIATO.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'giro-a');
    d.name = 'Primo, riscritto';
    d._updateTime = 't2';
    d.updatedAt = new Date().toISOString();
  });

  // Il successo è questo: l'owner VEDE il cambiamento, entro il giro.
  await expect(page.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo, riscritto'], { timeout: 5000 });

  const dopo = await conta(app);
  expect(dopo.documenti - fermo.documenti).toBe(1);
  expect(dopo.versioni).toBe(1, 'un cambiamento non fa rileggere tutta la collezione');
  expect(dopo.schede).toBe(1, 'le schede si rileggono per il solo id cambiato');
});
