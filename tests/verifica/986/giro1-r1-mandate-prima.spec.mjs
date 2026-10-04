// Verifica #986 giro 1, rilievo 1: una segnalazione mandata prima dell'aggiornamento (Filo ne conosce già il numero)
// non c'è nell'elenco, la sezione dice che non se n'è mai mandata nessuna, e nemmeno quando Filo ne annuncia la chiusura compare.
import { test, expect } from '../../fixtures/electron.mjs';

const BACHECA = 'filo://board/board.html';

test('la segnalazione mandata prima dell\'aggiornamento, annunciata risolta, compare nell\'elenco', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // Lo stato di chi aggiorna: il registro dei numeri mandati c'è, la copia locale no.
  await app.evaluate(async () => {
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    await globalThis.SN_FEEDBACK_MINE.ricordaId('fbDoc-vecchia');
  });

  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  await expect(bacheca.locator('#bdMie')).toBeVisible();
  // Chi ha già mandato segnalazioni non deve leggere che non ne ha mai mandate.
  await expect(bacheca.locator('#bdMie')).not.toContainText('non hai ancora mandato segnalazioni');

  await app.evaluate(async () => {
    const r = await globalThis.chrome.storage.local.get('sn_feedback_client_id');
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const tag = await H.cardTag('fbDoc-vecchia', await H.hashClientId(r.sn_feedback_client_id));
    const schede = [{
      _id: 'fbDoc-vecchia', clientIdTag: tag, status: 'done', statusPublic: 'closed',
      name: 'Il download si fermava', seq: 640, subSeq: 0, userNote: 'Adesso riprende da solo.',
    }];
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => schede.filter((c) => (ids || []).includes(c._id));
    globalThis.SN_FEEDBACK.listPublic = async () => schede;
  });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });

  const riga = bacheca.locator('#bdMie .bd-mia');
  await expect(riga).toHaveCount(1, { timeout: 5_000 });
  await expect(riga.first().locator('.bd-mia-titolo')).toHaveText('#640 Il download si fermava');
  await expect(riga.first().locator('.bd-mia-stato')).toHaveText('risolta');
});
