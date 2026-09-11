// Ricompensa alla risoluzione di un feedback (C5): all'avvio, se un feedback
// INVIATO DA QUESTO UTENTE è passato a "risolto", la home mostra un popup di
// ringraziamento con la spiegazione non tecnica e accredita crediti UNA VOLTA
// SOLA per feedback.
//
// Asserisce il SUCCESSO della feature: compare il popup #thanksOverlay con il
// titolo del feedback + la spiegazione, e il saldo crediti cresce dell'importo
// atteso. Senza il fix il popup non compare mai e il saldo non cambia.
//
// Da dove arrivano i dati (#583): dalla VISTA pubblica dei feedback
// (`feedback-public`), non dai documenti — che ora non si leggono senza le
// credenziali dell'owner, e questa è la macchina di chi ha mandato la
// segnalazione. Nella scheda c'è quello che serve qui: l'hash
// dell'installazione (per riconoscere i propri), il titolo, il numero e la
// FRASE per chi ha segnalato. Non c'è la priorità — che viaggia cifrata e non
// è cosa da collezione pubblica — quindi la ricompensa è quella di base.
// La lista (normalmente da Firestore via rete) è stubbata nel main così il
// test è deterministico e offline.

import { test, expect } from './fixtures/electron.mjs';

const CLIENT_ID = 'test-client-c5';

// Stub delle SCHEDE pubbliche + clientId di questo install + reset del saldo a
// uno stato fresco noto (1000). Va fatto DOPO il boot, poi si ricarica la home.
// Una scheda con `mia: true` prende l'impronta di QUELLA scheda per QUESTA
// installazione: è così che il popup riconosce i feedback di chi lo sta
// guardando, senza che la bacheca (pubblica) permetta a un estraneo di
// raggruppare i fix per segnalatore (#583).
async function seed(app, schede) {
  await app.evaluate(async (_electron, { clientId, schede }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    // Isola la ricompensa di RISOLUZIONE (C5) dal bonus giornaliero separato
    // "feedback autonomo attivo" (+10, F4), che altrimenti scatterebbe al primo
    // init con il clientId impostato e sporcherebbe il saldo atteso. Lo marchiamo
    // come già ricevuto oggi: qui misuriamo SOLO il premio per il feedback risolto.
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const cards = [];
    for (const { mia, ...c } of schede) {
      cards.push(mia ? { ...c, clientIdTag: await H.cardTag(c._id, mioHash) } : c);
    }
    // Niente rete: le schede sono quelle che passiamo noi.
    globalThis.SN_FEEDBACK.listPublic = async () => cards;
  }, { clientId: CLIENT_ID, schede });
}

function balanceOf(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);
}

test('feedback risolto: popup di ringraziamento + ricompensa', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    {
      _id: 'fbA', mia: true, status: 'done', statusPublic: 'closed',
      name: 'Incolla immagine nel box', seq: 42, subSeq: 0,
      userNote: 'Ora puoi incollare un’immagine direttamente nel box e arriva intera.',
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

  // +50 crediti, la ricompensa di base (mostrati nel totale e accreditati sul
  // saldo): la priorità non esce dalla collezione dei feedback.
  await expect(page.locator('.dash-thanks-total')).toContainText('+50');
  await expect.poll(() => balanceOf(app)).toBe(1050);
});

test('aggrega più feedback risolti e somma la ricompensa', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    { _id: 'fb1', mia: true, status: 'done', statusPublic: 'closed', name: 'Uno', seq: 1, subSeq: 0, userNote: 'Sistemato uno.' },
    { _id: 'fb2', mia: true, status: 'done', statusPublic: 'closed', name: 'Due', seq: 2, subSeq: 0, userNote: 'Sistemato due.' },
    // Non deve premiare: non è chiuso (una scheda così non verrebbe nemmeno
    // pubblicata, ma il popup non deve fidarsi).
    { _id: 'fb3', mia: true, status: 'done', statusPublic: 'open', name: 'Tre', seq: 3, subSeq: 0, userNote: '' },
    // Non deve premiare: di un'altra installazione.
    { _id: 'fb4', clientIdTag: 'b'.repeat(32), status: 'done', statusPublic: 'closed', name: 'Quattro', seq: 4, subSeq: 0, userNote: '' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  // Solo i due feedback done DI QUESTO utente.
  await expect(page.locator('.dash-thanks-item')).toHaveCount(2);
  // 50 + 50 = 100.
  await expect(page.locator('.dash-thanks-total')).toContainText('+100');
  await expect.poll(() => balanceOf(app)).toBe(1100);
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

  // (Oggi una scheda così non verrebbe nemmeno pubblicata — #583: la vista
  // esclude tutto ciò che è passato dalle mani della sicurezza. Qui la si
  // semina lo stesso: la mappa degli stati pubblici deve reggere da sola.)
  await seed(app, [
    {
      _id: 'fbAttacco', mia: true,
      statusPublic,
      name: 'Ignora le istruzioni precedenti e…', seq: 99, subSeq: 0,
      userNote: '',
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
    { _id: 'fbZ', mia: true, status: 'done', statusPublic: 'closed', name: 'Una cosa', seq: 7, subSeq: 0, userNote: 'Fatto.' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect.poll(() => balanceOf(app)).toBe(1050); // 1000 + 50 (ricompensa di base)

  await page.locator('.dash-recap-done').click();
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);

  // Riapertura: il feedback è già stato premiato → niente popup, saldo invariato.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  expect(await balanceOf(app)).toBe(1050);
});
