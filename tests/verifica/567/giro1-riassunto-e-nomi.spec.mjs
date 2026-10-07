// #567.1 e #567.4 — quello che l'utente legge del diario del lavoro.
//
// 1: un'impostazione confermata nel popup arriva DOPO che il riassunto è già
//    stato scritto: il titolo del blocco deve rifarsi, non restare «Come ha
//    lavorato».
// 4: nel diario l'impostazione si chiama come la chiama l'utente («Dimensione
//    del testo → 110%»), non col nome interno e il valore grezzo.
//
// Le porte contate qui: impostazione applicata subito (livello 1),
// impostazione confermata nel popup (livello 2), conferma ANNULLATA (il
// riassunto non deve vantarsi), e il dettaglio dell'aspetto, che ha la stessa
// forma e la stessa frase pronta altrove.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('l\'impostazione applicata subito si legge in italiano e il riassunto la conta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"dimensione_testo","valore":"grande"}' }] },
    { text: 'Testo più grande.' },
  ], '__v567a');

  await chiedi(page, 'fammi il testo più grande');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Testo più grande.' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity.locator('.dash-activity-label')).toContainText('cambiato un\'impostazione');

  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Impostato' });
  await expect(riga).toHaveCount(1);
  const testo = await riga.textContent();
  // La frase in italiano, non «dimensione_testo = grande».
  expect(testo).toContain('Dimensione del testo');
  expect(testo).toContain('110%');
  expect(testo).not.toContain('dimensione_testo');
  expect(testo).not.toContain('= grande');

  await restore(app, '__v567a');
});

test('l\'impostazione confermata nel popup rifà il riassunto, che non resta «Come ha lavorato»', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'p2', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":"si"}' }] },
    { text: 'Te la attivo, confermi?' },
  ], '__v567b');

  await chiedi(page, 'attiva la modalità terminale');
  const activity = page.locator('.dash-activity');
  const label = activity.locator('.dash-activity-label');

  // Il popup si apre da solo: prima della conferma il titolo non può dire che
  // un'impostazione è cambiata.
  await clickConfirm(page, 'ok', { timeout: 15_000 });

  await expect(label).toContainText('cambiato un\'impostazione', { timeout: 10_000 });
  expect(await label.textContent()).not.toContain('Come ha lavorato');

  await activity.locator('.dash-activity-head').click();
  const righe = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Impostato' });
  await expect(righe).toHaveCount(1);
  const testo = await righe.textContent();
  expect(testo).toContain('Modalità terminale');
  expect(testo).not.toContain('modalita_terminale');

  // È cambiata davvero, non solo a parole.
  const acceso = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return !!(s.terminal && s.terminal.enabled);
  });
  expect(acceso).toBe(true);

  await page.screenshot({ path: 'tests/.shots/567-riassunto-dopo-conferma.png' });
  await restore(app, '__v567b');
});

test('la conferma annullata non fa dire al riassunto che l\'impostazione è cambiata', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'p3', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":"si"}' }] },
    { text: 'Te la attivo, confermi?' },
  ], '__v567c');

  await chiedi(page, 'attiva la modalità terminale');
  await clickConfirm(page, 'cancel', { timeout: 15_000 });

  const label = page.locator('.dash-activity .dash-activity-label');
  await expect(label).toBeVisible();
  await page.waitForTimeout(600);
  expect(await label.textContent()).not.toContain('cambiato un\'impostazione');

  const acceso = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return !!(s.terminal && s.terminal.enabled);
  });
  expect(acceso).toBe(false);

  await restore(app, '__v567c');
});

test('anche il dettaglio dell\'aspetto si legge in italiano nel diario', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'e1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"accent","valore":"#3a7d44"}' }] },
    { text: 'Verde.' },
  ], '__v567d');

  await chiedi(page, 'accento verde');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Verde.' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Aspetto' });
  await expect(riga).toHaveCount(1);
  const testo = await riga.textContent();
  expect(testo).toContain('#3a7d44');
  // Il nome interno del token non è quello che legge l'utente.
  expect(testo.trim()).not.toMatch(/Aspetto · accent →/);

  await restore(app, '__v567d');
});
