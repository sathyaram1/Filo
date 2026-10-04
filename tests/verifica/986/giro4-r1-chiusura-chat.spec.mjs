// Giro 4, rilievo 1: una segnalazione scritta da Filo in chat e confermata deve passare a «risolta» quando viene chiusa, come quelle del riquadro.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';

test('mandata dalla chat, all\'annuncio della chiusura diventa «risolta»', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // La rete finta calcola l'impronta come la submit vera: dal clientId che le arriva.
  // Un tester che ha già usato il riquadro: Filo ha il suo identificativo d'installazione.
  await app.evaluate(async () => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: 'cid-tester' });
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__invii.push(payload);
      return { id: 'fbDoc-chat', seq: 991, failed: [] };
    };
  });
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  await home.evaluate(() => {
    window.__filoSidebarTest.runFiloAction({ type: 'INVIA_FEEDBACK', testo: 'Lo schermo intero lascia la barra in alto', titolo: 'Schermo intero' });
  });
  await expect(home.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(home, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__invii.length)).toBe(1);

  const bacheca = await openTab('filo://board/board.html#segnalazioni');
  const riga = bacheca.locator('#bdMie .bd-mia').first();
  await expect(riga.locator('.bd-mia-stato')).toHaveText('inviata');

  // La scheda pubblica di QUELLA segnalazione è chiusa; l'impronta è quella che il server calcola dal clientId inviato.
  await app.evaluate(async () => {
    const cid = globalThis.__invii[0].clientId;
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const tag = await H.cardTag('fbDoc-chat', await H.hashClientId(cid));
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    const schede = [{
      _id: 'fbDoc-chat', clientIdTag: tag, status: 'done', statusPublic: 'closed', createdAt: new Date().toISOString(),
      name: 'Schermo intero', seq: 991, subSeq: 0, userNote: 'Adesso lo schermo intero nasconde la barra.',
    }];
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => schede.filter((c) => (ids || []).includes(c._id));
    globalThis.SN_FEEDBACK.listPublic = async () => schede;
    globalThis.SN_FEEDBACK.listAllPublic = async () => schede;
  });
  await home.reload();
  await home.waitForTimeout(6_000);
  await expect(riga.locator('.bd-mia-stato')).toHaveText('risolta', { timeout: 8_000 });
});
