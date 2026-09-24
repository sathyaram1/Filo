// #567, quinto giro — la stessa famiglia, su una porta che i giri prima non
// avevano provato: DUE azioni dello stesso tipo nella stessa risposta.
//
// Il diario tiene una riga sola per tipo di azione: quando l'utente porta a
// termine la prima col bottone, l'esito va a finire sulla riga della seconda,
// e il riassunto conta fatte tutte e due.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const CENA = '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30"}';
const PRANZO = '{"titolo":"Pranzo con Bruno","data":"2026-10-03","ora":"13:00"}';

async function fingiApertura(app) {
  await app.evaluate(({ shell }) => {
    if (!globalThis.__v567g5orig) globalThis.__v567g5orig = shell.openPath;
    shell.openPath = async () => '';
  });
}

const righeDiario = async (page) => {
  await page.locator('.dash-activity-head').first().click();
  return page.locator('.dash-activity-body .dash-activity-row').allTextContents();
};
const titoloDiario = async (page) => (
  ((await page.locator('.dash-activity .dash-activity-label').first().textContent()) || '').trim()
);

test('aggiunto il primo di due eventi, il diario non deve perdere il secondo né darlo per aggiunto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'g5a', name: 'EVENTO_CALENDARIO', arguments: CENA },
        { id: 'g5b', name: 'EVENTO_CALENDARIO', arguments: PRANZO },
      ],
    },
    { text: 'Te li segno tutti e due.' },
  ], '__v567g5a');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30 e il pranzo con Bruno sabato all\'una');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te li segno tutti e due.' })).toBeVisible({ timeout: 15_000 });

  const bottoni = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(bottoni).toHaveCount(2, { timeout: 10_000 });

  // L'utente aggiunge SOLO il primo, e lascia stare il secondo.
  await bottoni.first().click();
  await expect(page.locator('.dash-action-btn', { hasText: /Aperto nel calendario|Evento salvato/ })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  const righe = await righeDiario(page);
  const titolo = await titoloDiario(page);
  await page.screenshot({ path: 'tests/.shots/567-giro5-due-eventi.png' });

  expect(
    righe.join(' | '),
    `il pranzo con Bruno è sparito dal diario: ${JSON.stringify(righe)}`,
  ).toContain('Bruno');
  expect(
    righe.filter((t) => /aggiunt/i.test(t)).length,
    `l'utente ha aggiunto un evento solo, e il diario dice: ${JSON.stringify(righe)}`,
  ).toBe(1);
  expect(
    titolo,
    `l'utente ha aggiunto un evento solo, e il riassunto dice: ${JSON.stringify(titolo)}`,
  ).not.toMatch(/aggiunto 2 eventi/i);

  await app.evaluate(({ shell: sh }) => { if (globalThis.__v567g5orig) sh.openPath = globalThis.__v567g5orig; });
  await restore(app, '__v567g5a');
});
