// #341 — invio del feedback "fire-and-forget": premuto "Invia" il box sparisce
// SUBITO (non aspetta la rete) e il main si fa carico di consegnarlo, ritentando
// da solo finché la connessione torna. Prima, senza rete, il box restava aperto
// con "Errore invio: timeout — controlla la rete" e costringeva a ritentare.
//
// Test d'integrazione REALE: widget (content script) → IPC → handler del main →
// coda d'invio. L'unica cosa stubbata è la submit di RETE (nel MAIN, così il
// test non tocca mai Firestore di produzione) — ci fa pilotare offline/online.
//
// Asserisce IL SUCCESSO dell'invariante:
//   1. offline: cliccando "Invia" il box si chiude comunque e il feedback resta
//      in coda nel main (non è perso);
//   2. quando la connessione torna, il feedback viene davvero inviato e la coda
//      si svuota.
//
// Pre-condizione che renderebbe rosso il test senza il fix: col vecchio handler,
// offline, la submit falliva → ok:false → il box restava aperto (niente coda,
// niente ritentativo).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

test('offline: il box si chiude subito e il feedback parte quando torna la rete', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Nel MAIN: sostituisci la submit di rete con una fake pilotabile (niente
  // Firestore reale) e spegni i timer automatici della coda per un test
  // deterministico (svuoteremo noi con flush()).
  await app.evaluate(() => {
    globalThis.__fbTest = { online: false, calls: [] };
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__fbTest.calls.push(payload && payload.submissionId);
      if (!globalThis.__fbTest.online) throw new Error('offline (test)');
      return { id: 'test_' + (payload && payload.submissionId), failed: [] };
    };
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  });

  // Componi e invia un feedback mentre siamo "offline".
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Feedback inviato mentre sono senza rete');
  await page.locator('.sn-fb-send').click();

  // 1) Il box sparisce SUBITO, anche se la rete non c'è (nessun "Errore invio").
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });

  // 2) Il feedback NON è perso: è in coda nel main, persistito.
  const queued = await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size());
  expect(queued, 'il feedback deve restare in coda finché non c\'è rete').toBeGreaterThan(0);

  // 3) La connessione torna → un flush lo consegna e svuota la coda.
  const drained = await app.evaluate(async () => {
    globalThis.__fbTest.online = true;
    return await globalThis.SN_FEEDBACK_OUTBOX.flush();
  });
  expect(drained, 'con la rete la coda si svuota').toBe(true);

  const sizeAfter = await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size());
  expect(sizeAfter, 'niente più feedback in coda').toBe(0);

  const calls = await app.evaluate(() => globalThis.__fbTest.calls);
  expect(calls.length, 'la submit di rete è stata davvero chiamata').toBeGreaterThan(0);
});
