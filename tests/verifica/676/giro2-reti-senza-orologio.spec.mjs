// Verifica #676, giro 2: le due reti di sicurezza «senza orologio» hanno
// ancora due buchi.
//
// Il giro chiede «chi è stato scritto dopo questo istante?» su una data che
// firma chi scrive. Il server delle routine quella data non la scrive, e una
// macchina con l'orologio indietro la scrive sbagliata. Contro questo il
// lavoro ha messo due reti: l'ora vera di Firestore, chiesta per i feedback
// che la dashboard «segue da vicino», e il contatore degli invii. Tutte e due
// lasciano passare qualcosa.
//
//   1. I seguiti sono al massimo dodici, presi dalla testa della coda: il
//      tredicesimo in poi non ha nessuna rete. Se le routine lo muovono, la
//      dashboard resta ferma fino al riallineamento.
//   2. Il contatore fa scattare il riallineamento solo se NESSUNA delle
//      segnalazioni arrivate col giro ha un numero più alto dell'ultimo visto.
//      Se nello stesso minuto ne arrivano due — una con l'ora giusta e una con
//      l'ora indietro — la prima «copre» la seconda e il riallineamento non
//      scatta: la seconda non entra in lista.

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
    status: 'todo',
    clientId: 'tester@example.com',
    createdAt: extra.createdAt || '2026-09-01T10:00:00Z',
    images: [],
    ...extra,
  };
}

async function fingiFirestore(app, docs, invii) {
  await app.evaluate(async (_electron, { docs, invii, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__invii = invii;
    const FB = globalThis.SN_FEEDBACK;
    FB.listVersions = async () => globalThis.__docs
      .map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    FB.listChangedSince = async ({ since }) => ({
      rows: globalThis.__docs.filter((d) => d.updatedAt > since), complete: true,
    });
    FB.getManyPublic = async () => [];
    FB.versionsOf = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id))
      .map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    FB.getMany = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id));
    FB.submissionCount = async () => globalThis.__invii;
    // Il riallineamento completo è la rete di ultima istanza, mezz'ora dopo:
    // qui deve restare fuori portata, o coprirebbe proprio ciò che si misura.
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, invii, ritmo: RITMO });
}

async function apriGestione(page, docs, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, tab }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
    window.__mgTest.setTab(tab);
    window.__mgTest.resumeLive();
  }, { docs, tab });
}

async function riaccendiGiro(page) {
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    const watch = window.__mgTest.idsDaSeguire ? window.__mgTest.idsDaSeguire() : [];
    await window.filo.message({ type: 'feedback_live_subscribe', watch });
  });
}

test('in coda oltre il dodicesimo, quello che scrivono le routine non arriva', async ({ app, openTab }) => {
  // Quattordici segnalazioni in coda: più di quante il giro ne possa seguire.
  const docs = [];
  for (let i = 1; i <= 14; i += 1) {
    docs.push(fakeFb(`coda-${String(i).padStart(2, '0')}`, `Numero ${i}`, {
      seq: 100 + i,
      createdAt: `2026-09-${String(28 - i).padStart(2, '0')}T10:00:00Z`,
    }));
  }
  await fingiFirestore(app, docs, 200);

  const page = await openTab(URL_MANAGE);
  await apriGestione(page, docs.slice().reverse(), 'queue');
  await expect(page.locator('.mg-item-title').first()).toHaveText('Numero 1');

  // L'ultima della coda non è fra quelle che il giro sorveglia.
  const seguiti = await page.evaluate(() => window.__mgTest.idsDaSeguire());
  expect(seguiti).not.toContain('coda-14');

  await riaccendiGiro(page);
  await expect.poll(() => app.evaluate(() => globalThis.__docs.length), { timeout: 5000 }).toBe(14);

  // Le routine la prendono in carico: scrivono stato e titolo SENZA firmare
  // l'ora, come fa il server oggi. Solo l'ora di Firestore cambia.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'coda-14');
    d.name = 'Numero 14, presa in carico';
    d.status = 'working';
    d._updateTime = 't2';
  });

  // Il successo è che l'owner lo veda entro il giro, come per le prime dodici.
  await expect.poll(
    () => page.locator('.mg-item-title').allTextContents(),
    { timeout: 5000 },
  ).toContain('Numero 14, presa in carico');
});

test('due segnalazioni nello stesso giro: quella con l\'ora indietro non entra in lista', async ({ app, openTab }) => {
  const A = fakeFb('inv-a', 'Prima', { seq: 1 });
  const B = fakeFb('inv-b', 'Seconda', { seq: 2, createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B], 2);

  const page = await openTab(URL_MANAGE);
  await apriGestione(page, [B, A], 'inbox');
  await expect(page.locator('.mg-item-title')).toHaveText(['Seconda', 'Prima']);
  await riaccendiGiro(page);
  // Un paio di giri a vuoto: il contatore degli invii è ormai in pari.
  await new Promise((r) => setTimeout(r, RITMO * 4));

  // Due invii nello stesso minuto. Il terzo arriva da una macchina con l'ora
  // giusta, il quarto da una con l'orologio indietro di ore: la domanda per
  // data trova solo il terzo, e il contatore — che è la rete — non scatta
  // perché il terzo gli basta.
  await app.evaluate(() => {
    const adesso = new Date().toISOString();
    const indietro = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    globalThis.__docs.push({
      _id: 'inv-c', _updateTime: 't9', updatedAt: adesso, createdAt: adesso,
      text: 'Testo di Terza.', name: 'Terza', seq: 3, subSeq: 0,
      status: 'new', clientId: 'tester@example.com', images: [],
    });
    globalThis.__docs.push({
      _id: 'inv-d', _updateTime: 't9', updatedAt: indietro, createdAt: indietro,
      text: 'Testo di Quarta.', name: 'Quarta', seq: 4, subSeq: 0,
      status: 'new', clientId: 'tester@example.com', images: [],
    });
    globalThis.__invii = 4;
  });

  // La terza arriva: è la prova che il giro sta girando davvero.
  await expect(page.locator('.mg-item-title')).toContainText(['Terza'], { timeout: 5000 });
  // La quarta è quella che conta: una segnalazione mandata non deve sparire.
  await expect(page.locator('.mg-item-title')).toContainText(['Quarta'], { timeout: 5000 });
});
