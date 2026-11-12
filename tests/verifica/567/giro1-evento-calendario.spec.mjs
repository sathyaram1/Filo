// #567.5 — un evento proposto da Filo si deve poter aggiungere davvero, e
// finché non lo si aggiunge il diario non deve chiamarlo «creato».
//
// Qui resta la porta della data che non esiste. Il bottone, il computer senza
// calendario e il titolo ostile stanno in G, G5 e G6 di dashboard-chat-diario.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('una data che non esiste non diventa un bottone: il diario dice perché', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'k3', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Mai","data":"2026-02-31","ora":"10:00"}' }] },
    { text: 'Non ci riesco.' },
  ], '__v567o');

  await chiedi(page, 'segna una cosa il 31 febbraio');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non ci riesco.' })).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' })).toHaveCount(0);
  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).not.toContainText('proposto un evento');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'data o ora non valide' })).toHaveCount(1);

  await restore(app, '__v567o');
});
