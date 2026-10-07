// L'annuncio della ricompensa non rilegge la bacheca a ogni scheda (#678).
//
// IL CASO. La home è la pagina di OGNI scheda nuova, e a ogni caricamento
// chiedeva TUTTE le schede pubbliche per cercarsi dentro le proprie: una
// lettura per scheda esistente, moltiplicata per ogni apertura e per ogni
// utente. Una stima su una giornata normale dava tredicimila letture al giorno
// per persona, e il numero cresce da solo a ogni fix che esce.
//
// COSA ASSERISCE: chi ha mandato una segnalazione chiusa riceve lo stesso il
// suo annuncio e i suoi crediti — e per saperlo Filo ha chiesto al server SOLO
// le proprie schede, non la bacheca. Dieci aperture della home dopo, di letture
// non ne sono partite altre.

import { test, expect } from './fixtures/electron.mjs';

const CLIENT_ID = 'test-678-ricompense';
const QUANTE = 300;

// Il database finto, nel main: tiene il conto di quante schede ha spedito e per
// quale domanda. `listPublic` è la lettura completa (quella che NON deve più
// servire); `getManyPublic` è la domanda mirata, per identificativo.
async function database(app, { clientId, quante, mie }) {
  return app.evaluate(async (_electron, { clientId, quante, mie }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    // Isola la ricompensa di risoluzione dal bonus giornaliero del feedback
    // autonomo, che altrimenti sporcherebbe il saldo atteso.
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);

    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const schede = [];
    for (let i = 0; i < quante; i += 1) {
      const id = `scheda-${String(i).padStart(4, '0')}`;
      schede.push({
        _id: id,
        name: `Fix numero ${i}`,
        seq: i + 1,
        subSeq: 0,
        status: 'done',
        statusPublic: 'closed',
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
        userNote: `Sistemato il numero ${i}.`,
        reward: 50,
        clientIdTag: mie.includes(id) ? await H.cardTag(id, mioHash) : 'a'.repeat(32),
      });
    }

    globalThis.__conta = { complete: 0, mirate: 0, documenti: 0 };
    const FB = globalThis.SN_FEEDBACK;
    FB.listPublic = async ({ pageSize = 500, afterName = null } = {}) => {
      globalThis.__conta.complete += 1;
      const da = (typeof afterName === 'string' && afterName)
        ? schede.findIndex((s) => afterName.endsWith(`/${s._id}`)) + 1
        : 0;
      const out = schede.slice(da, da + pageSize);
      globalThis.__conta.documenti += out.length;
      return out.map((s) => ({ ...s }));
    };
    FB.getManyPublic = async (ids) => {
      globalThis.__conta.mirate += 1;
      const voluti = new Set((ids || []).map(String));
      const out = schede.filter((s) => voluti.has(s._id));
      globalThis.__conta.documenti += out.length;
      return out.map((s) => ({ ...s }));
    };
  }, { clientId, quante, mie });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);
const saldo = (app) => app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);

test('dieci aperture della home: la ricompensa arriva, la bacheca non si scarica mai', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500); // lascia esaurire l'init senza clientId

  await database(app, { clientId: CLIENT_ID, quante: QUANTE, mie: ['scheda-0007'] });
  // Il registro degli invii di questa installazione: è quello che l'invio
  // scrive, ed è l'unica cosa che serve per chiedere le proprie schede.
  await app.evaluate(async () => {
    await globalThis.SN_FEEDBACK_MINE.scrivi({ ids: ['scheda-0007'], checkedAt: 0 });
  });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // La ricompensa DOVUTA compare, con la sua frase e i suoi crediti.
  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#8 Fix numero 7');
  await expect(page.locator('.dash-thanks-item-body')).toHaveText('Sistemato il numero 7.');
  await expect.poll(() => saldo(app)).toBe(1050);
  await page.locator('.dash-recap-done').click();

  const dopoIlPrimo = await conta(app);
  expect(dopoIlPrimo.complete).toBe(0);      // la bacheca intera: mai
  expect(dopoIlPrimo.mirate).toBe(1);        // una domanda sola, sui propri id
  expect(dopoIlPrimo.documenti).toBe(1);     // una scheda: la sua

  // Altre nove aperture. La risposta non è cambiata, quindi non si richiede
  // niente: prima erano trecento schede ogni volta.
  for (let i = 0; i < 9; i += 1) {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(250);
  }
  const dopoDieci = await conta(app);
  expect(dopoDieci.documenti).toBe(1);
  expect(dopoDieci.complete).toBe(0);
  expect(await saldo(app)).toBe(1050); // niente doppio premio
});

test('chi non ha mai segnalato non chiede niente al server', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await database(app, { clientId: CLIENT_ID, quante: QUANTE, mie: [] });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('sn_feedback_miei', null);
  });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  const c = await conta(app);
  expect(c.documenti).toBe(0);
  expect(c.complete).toBe(0);
  expect(c.mirate).toBe(0);
});

test('una segnalazione appena mandata fa ricontrollare subito, senza aspettare', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await database(app, { clientId: CLIENT_ID, quante: QUANTE, mie: ['scheda-0123'] });
  // Controllo appena fatto: senza un fatto nuovo non si richiede niente.
  await app.evaluate(async () => {
    await globalThis.SN_FEEDBACK_MINE.scrivi({ ids: [], checkedAt: Date.now() });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  expect((await conta(app)).mirate).toBe(0);

  // Adesso l'utente manda una segnalazione: l'attesa si azzera, e alla
  // prossima apertura Filo va a vedere.
  await app.evaluate(async () => {
    await globalThis.SN_FEEDBACK_MINE.ricordaId('scheda-0123');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#124 Fix numero 123');
  expect((await conta(app)).documenti).toBe(1);
});
