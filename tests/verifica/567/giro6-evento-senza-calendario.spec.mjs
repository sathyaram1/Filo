// #567.5, sesto giro — l'evento quando il computer non ha nessun calendario da
// aprire, e i due appuntamenti chiesti insieme presi dal secondo.
//
// Il bottone in questo caso è onesto («il computer non ha aperto nessun
// calendario, l'evento è nel file …»): si guarda se il diario accanto dice la
// stessa cosa o si vanta di averlo messo in calendario.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

async function nessunCalendario(app) {
  await app.evaluate(({ shell }) => {
    if (!globalThis.__v567g6orig) globalThis.__v567g6orig = shell.openPath;
    shell.openPath = async () => 'nessun programma associato';
  });
}

const EVENTO = '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30"}';

test('senza un calendario sul computer il diario non deve dire che l’evento è nel calendario', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  await nessunCalendario(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'd1', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Te la segno.' },
  ], '__v567g6d');
  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te la segno.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();

  // Il bottone dice la verità: il file c'è, il calendario non si è aperto.
  await expect(page.locator('.dash-bubble-note', { hasText: 'non ha aperto nessun calendario' }))
    .toBeVisible({ timeout: 15_000 });

  const activity = page.locator('.dash-activity').first();
  await activity.locator('.dash-activity-head').click();
  const riga = (await activity.locator('.dash-activity-body .dash-activity-row').allTextContents()).join(' | ');
  const titolo = (await activity.locator('.dash-activity-label').textContent()) || '';
  // A pochi centimetri l'una dall'altra, le due frasi non possono dire il
  // contrario: o l'evento è nel calendario, o è in un file da aprire.
  expect(`${titolo} | ${riga}`, `il bottone dice che il calendario non si è aperto, il diario dice: ${titolo} | ${riga}`)
    .not.toMatch(/aggiunto.*al calendario/i);

  await restore(app, '__v567g6d');
});

test('due appuntamenti insieme: aggiungere il SECONDO non deve riscrivere il primo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  await app.evaluate(({ shell: sh }) => { sh.openPath = async () => ''; });

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'e1', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30"}' },
        { id: 'e2', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Pranzo con Bruno","data":"2026-10-03","ora":"13:00"}' },
      ],
    },
    { text: 'Te li segno.' },
  ], '__v567g6e');
  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30 e il pranzo con Bruno sabato all’una');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te li segno.' })).toBeVisible({ timeout: 15_000 });

  const bottoni = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(bottoni).toHaveCount(2, { timeout: 10_000 });
  await bottoni.nth(1).click();
  await expect(page.locator('.dash-action-btn', { hasText: /Aperto nel calendario|Evento salvato/ }))
    .toBeVisible({ timeout: 15_000 });

  const activity = page.locator('.dash-activity').first();
  await activity.locator('.dash-activity-head').click();
  const righe = await activity.locator('.dash-activity-body .dash-activity-row').allTextContents();
  const testo = righe.join(' | ');
  expect(testo, `il primo appuntamento è sparito dal diario: ${testo}`).toContain('Anna');
  expect(testo, `il secondo appuntamento è sparito dal diario: ${testo}`).toContain('Bruno');
  const aggiunte = righe.filter((t) => /aggiunt/i.test(t));
  expect(aggiunte.join(' | '), `aggiunto solo il secondo, ma il diario dice: ${testo}`).toContain('Bruno');
  expect(aggiunte.length, `un solo evento aggiunto: ${testo}`).toBe(1);

  await restore(app, '__v567g6e');
});
