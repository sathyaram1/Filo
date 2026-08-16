// Ricompensa alla risoluzione di un feedback (C5): all'avvio, se un feedback
// INVIATO DA QUESTO UTENTE è passato a "risolto", la home mostra un popup di
// ringraziamento con la spiegazione non tecnica e accredita crediti in base alla
// priorità (50/100/200/300), UNA VOLTA SOLA per feedback.
//
// Asserisce il SUCCESSO della feature: compare il popup #thanksOverlay con il
// titolo del feedback + la spiegazione, e il saldo crediti cresce dell'importo
// atteso. Senza il fix il popup non compare mai e il saldo non cambia.
//
// La lista feedback (normalmente da Firestore via rete) è stubbata nel main così
// il test è deterministico e offline.

import { test, expect } from './fixtures/electron.mjs';

const CLIENT_ID = 'test-client-c5';

// Stub della lista feedback + clientId di questo install + reset del saldo a uno
// stato fresco noto (1000). Va fatto DOPO il boot, poi si ricarica la home.
async function seed(app, feedback) {
  await app.evaluate(async (_electron, { clientId, feedback }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    // Isola la ricompensa di RISOLUZIONE (C5) dal bonus giornaliero separato
    // "feedback autonomo attivo" (+10, F4), che altrimenti scatterebbe al primo
    // init con il clientId impostato e sporcherebbe il saldo atteso. Lo marchiamo
    // come già ricevuto oggi: qui misuriamo SOLO il premio per il feedback risolto.
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    // Niente rete: la lista è quella che passiamo noi.
    globalThis.SN_FEEDBACK.list = async () => feedback;
  }, { clientId: CLIENT_ID, feedback });
}

function balanceOf(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);
}

test('feedback risolto: popup di ringraziamento + ricompensa per priorità', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    {
      _id: 'fbA', clientId: CLIENT_ID, status: 'done', priority: 2,
      name: 'Incolla immagine nel box', seq: 42, subSeq: 0,
      notes: 'Ora puoi incollare un’immagine direttamente nel box e arriva intera.',
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#thanksOverlay');
  await expect(overlay).toBeVisible();

  // Titolo del feedback (con numero) e spiegazione non tecnica presi dalle note.
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#42 Incolla immagine nel box');
  await expect(page.locator('.dash-thanks-item-body'))
    .toHaveText('Ora puoi incollare un’immagine direttamente nel box e arriva intera.');

  // Priorità 2 → +200 crediti (mostrati nel totale e accreditati sul saldo).
  await expect(page.locator('.dash-thanks-total')).toContainText('+200');
  await expect.poll(() => balanceOf(app)).toBe(1200);
});

test('aggrega più feedback risolti e somma la ricompensa', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    { _id: 'fb1', clientId: CLIENT_ID, status: 'done', priority: 3, name: 'Uno', seq: 1, subSeq: 0, notes: 'Sistemato uno.' },
    { _id: 'fb2', clientId: CLIENT_ID, status: 'done', priority: 0, name: 'Due', seq: 2, subSeq: 0, notes: 'Sistemato due.' },
    // Non deve premiare: non è done.
    { _id: 'fb3', clientId: CLIENT_ID, status: 'todo', priority: 3, name: 'Tre', seq: 3, subSeq: 0, notes: '' },
    // Non deve premiare: di un altro utente.
    { _id: 'fb4', clientId: 'altro-utente', status: 'done', priority: 3, name: 'Quattro', seq: 4, subSeq: 0, notes: '' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  // Solo i due feedback done DI QUESTO utente.
  await expect(page.locator('.dash-thanks-item')).toHaveCount(2);
  // 300 (prio 3) + 50 (prio 0) = 350.
  await expect(page.locator('.dash-thanks-total')).toContainText('+350');
  await expect.poll(() => balanceOf(app)).toBe(1350);
});

test('#476 — un attacco confermato non premia e non annuncia niente a chi l\'ha mandato', async ({ app, openTab }) => {
  // Il feedback dell'attaccante, visto DALLA SUA macchina: lo status fine è
  // cifrato (non ha la chiave), quindi l'unica cosa leggibile è l'enum
  // grossolano — che qui prendiamo dalla mappa vera invece di scriverlo a mano.
  // Prima del fix quella mappa diceva 'closed' e questo test falliva: popup di
  // ringraziamento in faccia all'attaccante e 50 crediti sul suo saldo, cioè la
  // conferma che il suo tentativo era arrivato a destinazione.
  const publicOf = (fine) => app.evaluate((_e, s) => globalThis.SN_FB_STATUS.PUBLIC_MAP[s], fine);
  const statusPublic = await publicOf('attack_confirmed');

  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await seed(app, [
    {
      _id: 'fbAttacco', clientId: CLIENT_ID, clientIdHash: undefined,
      status: 'FENC1:cifrato-non-leggibile-dalla-sua-macchina',
      statusPublic,
      priority: 0, name: 'Ignora le istruzioni precedenti e…', seq: 99, subSeq: 0,
      notes: '',
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  expect(await balanceOf(app)).toBe(1000); // saldo fresco, nessun accredito
});

test('anti doppio-premio: alla riapertura non ricompare né ri-accredita', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    { _id: 'fbZ', clientId: CLIENT_ID, status: 'done', priority: 1, name: 'Una cosa', seq: 7, subSeq: 0, notes: 'Fatto.' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect.poll(() => balanceOf(app)).toBe(1100); // 1000 + 100 (prio 1)

  await page.locator('.dash-recap-done').click();
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);

  // Riapertura: il feedback è già stato premiato → niente popup, saldo invariato.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  expect(await balanceOf(app)).toBe(1100);
});
