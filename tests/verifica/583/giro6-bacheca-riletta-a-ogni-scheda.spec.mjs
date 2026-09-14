// Verifica #583, giro 6 — quanto costa aprire una scheda nuova.
//
// L'annuncio della ricompensa gira a ogni caricamento della home, e la home è
// la pagina di ogni SCHEDA NUOVA. Da questo giro non chiede più una pagina di
// schede: le chiede TUTTE, perché una segnalazione vecchia risolta oggi deve
// pagare chi l'ha mandata (era il rilievo del giro 5, ed è giusto così).
//
// Il conto però lo paga ogni scheda che si apre. Chi ha mandato almeno una
// segnalazione, ogni volta che apre una scheda nuova, si riscarica la bacheca
// intera per una risposta che cambia una volta ogni mai. Oggi sono 552 schede
// per scheda aperta; il numero cresce da solo con i fix che escono.
//
// C'È GIÀ LA SIMMETRIA CHE MANCA. Dall'altra parte, sul computer di chi i
// feedback li gestisce, la stessa lettura delle schede passa da una memoria
// breve e non si ripete a ogni domanda. Sul computer di chi ha segnalato quella
// memoria non c'è: due cammini identici che divergono.
//
// La prova apre la home quattro volte e conta quante schede sono passate dalla
// rete. Non impone una strada: diventa verde con una memoria breve come quella
// che esiste già, oppure chiedendo solo le schede che interessano.

import { test, expect } from './../../fixtures/electron.mjs';

const CLIENT_ID = 'test-583-giro6';
const QUANTE = 552; // le schede vere del progetto a settembre 2026
const APERTURE = 4;

test('aprire una scheda nuova non deve riscaricare la bacheca intera ogni volta', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500); // lascia esaurire l'init senza clientId

  // Il database finto: 552 schede, nessuna di questa installazione (così il
  // popup non compare e misuriamo soltanto la lettura).
  await app.evaluate(async (_electron, { clientId, quante }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);

    const schede = [];
    for (let i = 0; i < quante; i += 1) {
      schede.push({
        _id: `scheda-${String(i).padStart(4, '0')}`,
        name: `Fix numero ${i}`,
        seq: i + 1,
        subSeq: 0,
        status: 'done',
        statusPublic: 'closed',
        resolvedInVersion: '0.2.228',
        createdAt: new Date(Date.parse('2025-01-01T00:00:00Z') + i * 3600000).toISOString(),
        resolvedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3600000).toISOString(),
        clientIdTag: 'di-qualcun-altro',
        userNote: '',
        reward: 50,
      });
    }
    globalThis.__contatoreSchede = { chiamate: 0, documenti: 0 };
    // Si comporta come la rete vera: ordinata, tagliata, e con il cursore per
    // chi vuole arrivare in fondo.
    globalThis.SN_FEEDBACK.listPublic = async ({ pageSize = 500, afterName = null } = {}) => {
      globalThis.__contatoreSchede.chiamate += 1;
      let out;
      if (typeof afterName === 'string') {
        const da = afterName
          ? schede.findIndex((s) => afterName.endsWith(`/${s._id}`)) + 1
          : 0;
        out = schede.slice(da, da + pageSize);
      } else {
        out = schede.slice(0, pageSize);
      }
      globalThis.__contatoreSchede.documenti += out.length;
      return out.map((s) => ({
        ...s,
        _name: `progetti/x/databases/(default)/documents/feedback-public/${s._id}`,
      }));
    };
  }, { clientId: CLIENT_ID, quante: QUANTE });

  const conta = () => app.evaluate(async () => globalThis.__contatoreSchede);

  // Prima apertura: qui la bacheca si legge, ed è giusto.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(async () => (await conta()).documenti, { timeout: 15000 })
    .toBeGreaterThanOrEqual(QUANTE);
  const dopoLaPrima = (await conta()).documenti;

  // Altre tre aperture, una dopo l'altra, come chi apre qualche scheda.
  for (let i = 1; i < APERTURE; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.reload();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForLoadState('domcontentloaded');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1500);
  }

  const finale = await conta();

  // Quattro aperture non devono costare quattro bacheche. Il margine è largo:
  // una lettura in più ci sta, quattro no.
  expect(
    finale.documenti,
    `quattro aperture della home hanno letto ${finale.documenti} schede in ${finale.chiamate} richieste `
    + `(la prima da sola ne aveva lette ${dopoLaPrima}): la bacheca si riscarica intera a ogni scheda aperta`,
  ).toBeLessThan(QUANTE * 2);
});
