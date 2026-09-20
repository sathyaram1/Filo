// #567.1/2/4, secondo giro — la stessa domanda della segnalazione («perché non
// è successo niente?») sulla porta che resta: l'impostazione che Filo chiede di
// confermare e che poi non parte.
//
// Il popup si apre da solo, l'utente dice sì, e da lì in avanti nessuno gli
// dice cosa è andato storto: il diario resta fermo sulla richiesta e il bottone
// dice soltanto «non eseguita».

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';

test('confermata un\'impostazione che non si può applicare, l\'utente deve capire cosa è successo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Un valore che il modello può benissimo scrivere e che Filo non sa applicare.
  await fakeProvider(app, [
    {
      toolCalls: [{
        id: 'g2p', name: 'IMPOSTA_PREFERENZA',
        arguments: '{"chiave":"modalita_terminale","valore":"quando serve"}',
      }],
    },
    { text: 'Fatto.' },
  ], '__v567g2p');

  await chiedi(page, 'attiva la modalità terminale quando serve');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });

  // Il popup si apre da solo: l'utente conferma.
  const ok = page.locator('.sn-confirm-ok, .sn-modal-ok, button', { hasText: /^(OK|Conferma|Continua)$/i }).first();
  await expect(ok).toBeVisible({ timeout: 10_000 });
  await ok.click();

  const btn = page.locator('.dash-bubble-actions .dash-action-btn').first();
  await expect(btn).toContainText('✗', { timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const righe = await activity.locator('.dash-activity-body .dash-activity-row').allTextContents();
  const testoBtn = (await btn.textContent()) || '';
  const spiega = /non applicat|non riuscit|non valid|non sa|non è partit/i.test(`${righe.join(' | ')} ${testoBtn}`)
    && !/^\s*✗ Non eseguita\s*$/.test(testoBtn.trim());
  expect(spiega, `bottone: ${JSON.stringify(testoBtn)} — diario: ${JSON.stringify(righe)}`).toBe(true);

  await restore(app, '__v567g2p');
});
