// #567.5, decimo giro — un appuntamento di una sera sola che il modello accompagna
// con l'ultimo giorno uguale al primo non deve allungarsi fino a mezzanotte.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const cartellaEventi = async (app) => join(await app.evaluate(({ app: a }) => a.getPath('temp')), 'filo-eventi');
const elencoIcs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ics')) : []);

const EVENTO = '{"titolo":"Cena con Anna","data":"2026-10-23","ora":"20:30","durata_min":120,"data_fine":"2026-10-23"}';

test('r1 la cena di due ore con l\'ultimo giorno uguale al primo dura due ore, non fino a mezzanotte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(({ shell: s }) => { s.openPath = async () => ''; });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g10a', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Ecco la cena.' },
  ], '__v567g10a');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30, due ore');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la cena.' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Evento' });
  await expect(riga).toHaveCount(1);
  expect(await riga.textContent()).not.toContain('00:00');

  const dir = await cartellaEventi(app);
  const prima = elencoIcs(dir);
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });
  const nati = elencoIcs(dir).filter((f) => !prima.includes(f));
  expect(nati.length).toBe(1);
  const ics = readFileSync(join(dir, nati[0]), 'utf8');
  expect(ics).toContain('DTSTART:20261023T203000');
  expect(ics).toContain('DTEND:20261023T223000');

  await restore(app, '__v567g10a');
});
