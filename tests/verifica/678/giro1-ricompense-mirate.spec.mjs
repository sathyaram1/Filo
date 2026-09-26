// Verifica #678, giro 1 — le ricompense chieste per identificativo.
//
// Il lavoro consegnato smette di scaricare tutte le schede pubbliche per
// cercarsi dentro le proprie, e tiene su disco un registro delle segnalazioni
// mandate da questa installazione. Qui si prova quello che può andare storto
// in un registro su disco: una SECONDA segnalazione chiusa dopo la prima (la
// ricompensa deve arrivare lo stesso), un registro rovinato, e una rete caduta
// nel momento della domanda (chiedere di nuovo fra poco, non fra quattro ore).

import { test, expect } from '../../fixtures/electron.mjs';

const CLIENT_ID = 'verifica-678';
const HOME = 'filo://newtab/';

// Il database finto nel main: conta le domande mirate e quelle complete.
// `guasto` fa cadere la domanda mirata, come una rete che non c'è.
async function database(app, { clientId, mie }) {
  return app.evaluate(async (_electron, { clientId, mie }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);

    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const schede = [];
    for (let i = 0; i < 200; i += 1) {
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
    globalThis.__guasto = false;
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
    FB.listAllPublic = async () => {
      globalThis.__conta.complete += 1;
      globalThis.__conta.documenti += schede.length;
      return schede.map((s) => ({ ...s }));
    };
    FB.getManyPublic = async (ids) => {
      globalThis.__conta.mirate += 1;
      if (globalThis.__guasto) throw new Error('rete assente');
      const voluti = new Set((ids || []).map(String));
      const out = schede.filter((s) => voluti.has(s._id));
      globalThis.__conta.documenti += out.length;
      return out.map((s) => ({ ...s }));
    };
  }, { clientId, mie });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);
const saldo = (app) => app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);
const registro = (app) => app.evaluate(() => globalThis.SN_FEEDBACK_MINE.leggi());
const scriviRegistro = (app, stato) => app.evaluate(
  (_e, s) => globalThis.chrome.storage.local.set({ sn_feedback_miei: s }), stato,
);

async function riapri(page) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test('una seconda segnalazione chiusa dopo la prima paga lo stesso', async ({ app, openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await database(app, { clientId: CLIENT_ID, mie: ['scheda-0007', 'scheda-0042'] });
  // Al momento del primo controllo l'utente ha mandato solo la prima.
  await scriviRegistro(app, { ids: ['scheda-0007'], checkedAt: 0 });

  await riapri(page);
  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#8 Fix numero 7');
  await expect.poll(() => saldo(app)).toBe(1050);
  await page.locator('.dash-recap-done').click();

  // La seconda segnalazione era già stata mandata prima del controllo, ma la
  // sua scheda si chiude più tardi: l'attesa scade da sola e la ricompensa
  // arriva senza che l'utente faccia niente.
  const r = await registro(app);
  await scriviRegistro(app, {
    ids: ['scheda-0007', 'scheda-0042'],
    checkedAt: Date.now() - 5 * 60 * 60 * 1000,
    ereditaFinoA: r.ereditaFinoA,
    ereditaUltimoGiro: r.ereditaUltimoGiro,
  });

  await riapri(page);
  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#43 Fix numero 42');
  await expect.poll(() => saldo(app)).toBe(1100);

  // E per tutto questo la bacheca intera non è mai stata scaricata.
  const c = await conta(app);
  expect(c.complete).toBe(0);
  expect(c.documenti).toBeLessThanOrEqual(3);
});

test('la rete caduta non fa perdere la ricompensa per quattro ore', async ({ app, openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await database(app, { clientId: CLIENT_ID, mie: ['scheda-0007'] });
  await scriviRegistro(app, { ids: ['scheda-0007'], checkedAt: 0 });
  await app.evaluate(() => { globalThis.__guasto = true; });

  await riapri(page);
  await page.waitForTimeout(800);
  await expect(page.locator('#thanksOverlay')).toBeHidden();
  expect(await saldo(app)).toBe(1000);

  // Tornata la rete, la ricompensa arriva alla PROSSIMA apertura: una domanda
  // caduta non conta come risposta, quindi l'attesa non è partita.
  await app.evaluate(() => { globalThis.__guasto = false; });
  await riapri(page);
  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#8 Fix numero 7');
  await expect.poll(() => saldo(app)).toBe(1050);
});

test('un registro rovinato su disco non porta via la ricompensa', async ({ app, openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await database(app, { clientId: CLIENT_ID, mie: ['scheda-0007'] });
  // Quello che potrebbe esserci dopo un aggiornamento andato storto o un file
  // scritto a metà: campi del tipo sbagliato, doppioni, valori vuoti.
  await scriviRegistro(app, {
    ids: ['scheda-0007', 'scheda-0007', '', null, 42],
    checkedAt: 'ieri',
    ereditaFinoA: {},
    ereditaUltimoGiro: [],
  });

  await riapri(page);
  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#8 Fix numero 7');
  await expect.poll(() => saldo(app)).toBe(1050);
  expect((await conta(app)).complete).toBe(0);
});
