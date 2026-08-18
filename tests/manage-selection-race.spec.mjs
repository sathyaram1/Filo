// Il pannello di dettaglio non deve chiudersi sotto le mani dell'owner.
//
// PERCHÉ QUESTI CONTROLLI
//   I comandi del pannello (archivia, rispondi a un chiarimento, accetta e
//   sblocca, conferma il blocco) parlano con il main e POI toccano la
//   schermata. Nel frattempo l'owner può aver aperto un altro feedback: se la
//   risposta in ritardo chiude comunque il dettaglio, sparisce quello
//   dell'ALTRO feedback — senza nessun motivo apparente, e con il comando che
//   nel frattempo era andato a buon fine.
//
// Pre-condizione che senza la guardia fallirebbe: togliendo il controllo
//   "sono ancora sullo stesso feedback?" dopo l'attesa, ognuno di questi
//   controlli diventa rosso, perché il pannello risulta chiuso (o vuoto) al
//   posto di mostrare il secondo feedback.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  seq: 800, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z',
  images: [],
};

// B è il feedback aperto mentre il comando su A è ancora in volo: è lui che
// deve restare sotto gli occhi dell'owner. Vive nella STESSA scheda di A (una
// scheda mostra solo i feedback nel suo stato), così la lista lo contiene
// davvero e si può controllare anche che resti quello selezionato.
function feedbackB(extra) {
  return { ...BASE, _id: 'fb-b', seq: 801, name: 'Feedback B', text: 'testo del feedback B', ...extra };
}

// Pipeline che fa risultare il feedback "bloccato" (attacco): sblocco e
// conferma del blocco vivono solo su questi.
const PIPELINE_ATTACCO = {
  action: 'block_attack',
  l1Category: 'dangerous',
  l2Class: 'attack',
  stage: 'L2',
  verdicts: [{ judge: 'A', class: 'attack', reasoning: 'Prompt injection rilevata.' }],
  filoSummary: 'Tentativo di attacco.',
  decidedAt: '2026-08-18T10:01:00Z',
};

// Prepara la pagina: aspetta che il caricamento VERO (Firestore) sia finito —
// altrimenti atterra a metà controllo e sovrascrive i dati finti — poi rallenta
// il canale verso il main di 400ms e inietta i due feedback aprendo A.
async function preparaConCanaleLento(page, a, b, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true };
      }
      return orig(msg);
    };
  });

  await page.evaluate(({ fa, fb, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fa, fb]);
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(fa._id);
  }, { fa: a, fb: b, t: tab });
}

// Dopo il comando: apri B senza aspettare la risposta, lascia atterrare quella
// in ritardo e verifica che il pannello parli ancora di B.
async function apriBeVerifica(page) {
  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  await page.waitForTimeout(900);

  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetailEmpty')).toBeHidden();
  const visibile = await page.locator('#mgDetail').innerText();
  expect(visibile).toContain('testo del feedback B');
  expect(visibile).not.toContain('testo del feedback A');
  // E la selezione è davvero su B: il comando successivo deve andare su B.
  await expect(page.locator('.mg-item--selected')).toHaveAttribute('data-id', 'fb-b');
}

test('archiviare un feedback non chiude il dettaglio di quello aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  const A = { ...BASE, _id: 'fb-a', name: 'Feedback A', text: 'testo del feedback A', status: 'todo' };
  await preparaConCanaleLento(page, A, feedbackB({ status: 'todo' }), 'queue');

  await page.locator('#mgArchiveBtn').click();
  await apriBeVerifica(page);

  // L'archiviazione è comunque avvenuta: il comando non è stato annullato.
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-a');
  expect(patch.status).toBe('archived');
});

test('rispondere a un chiarimento non chiude il dettaglio di quello aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  const A = {
    ...BASE, _id: 'fb-a', name: 'Feedback A', text: 'testo del feedback A',
    status: 'clarify',
    notes: '--- Filo ---\nQuale pulsante intendi?',
  };
  await preparaConCanaleLento(page, A, feedbackB({ status: 'clarify', notes: '--- Filo ---\nE questo dove lo vedi?' }), 'inbox');

  await page.locator('#mgClarifyText').fill('Intendo quello in alto a destra.');
  await page.locator('#mgClarifyBtn').click();
  await apriBeVerifica(page);

  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-a');
  expect(patch.status).toBe('todo');
});

test('sbloccare un feedback non chiude il dettaglio di quello aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  const A = {
    ...BASE, _id: 'fb-a', name: 'Feedback A', text: 'testo del feedback A',
    pipeline: PIPELINE_ATTACCO,
  };
  await preparaConCanaleLento(page, A, feedbackB({ pipeline: PIPELINE_ATTACCO }), 'inbox');

  await page.locator('#mgAcceptBtn').click();
  await apriBeVerifica(page);

  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-a');
  expect(patch.reviewDecision).toBe('accepted');
});

test('confermare un blocco non chiude il dettaglio di quello aperto nel frattempo', async ({ openTab }) => {
  const page = await openTab(URL);
  const A = {
    ...BASE, _id: 'fb-a', name: 'Feedback A', text: 'testo del feedback A',
    pipeline: PIPELINE_ATTACCO,
  };
  await preparaConCanaleLento(page, A, feedbackB({ pipeline: PIPELINE_ATTACCO }), 'inbox');

  await page.locator('#mgConfirmBtn').click();
  await apriBeVerifica(page);

  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-a');
  expect(patch.reviewDecision).toBe('rejected');
});
