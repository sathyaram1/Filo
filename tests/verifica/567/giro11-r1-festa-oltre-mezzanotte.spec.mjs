// #567.5, undicesimo giro — una serata che passa la mezzanotte, col modello che scrive l'ultimo giorno uguale
// al primo, deve entrare nel calendario intera: né rifiutata (ora di fine) né tagliata a mezzanotte (durata).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const cartellaEventi = async (app) => join(await app.evaluate(({ app: a }) => a.getPath('temp')), 'filo-eventi');
const elencoIcs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ics')) : []);

const CASI = [
  ['con l\'ora di fine', '{"titolo":"Festa da Bruno","data":"2026-10-24","ora":"22:00","ora_fine":"02:00","data_fine":"2026-10-24"}', 'g11a'],
  ['con la durata', '{"titolo":"Festa da Bruno","data":"2026-10-24","ora":"22:00","durata_min":240,"data_fine":"2026-10-24"}', 'g11b'],
];

for (const [come, evento, id] of CASI) {
  test(`r1 la festa dalle 22 alle 2 ${come} e l'ultimo giorno uguale al primo entra nel calendario fino alle 2`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await configureModel(app);
    await app.evaluate(({ shell: s }) => { s.openPath = async () => ''; });

    await fakeProvider(app, [
      { toolCalls: [{ id, name: 'EVENTO_CALENDARIO', arguments: evento }] },
      { text: 'Ecco la festa.' },
    ], `__v567${id}`);

    await chiedi(page, 'segnami la festa da Bruno sabato dalle 22 alle 2');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la festa.' })).toBeVisible({ timeout: 10_000 });

    const dir = await cartellaEventi(app);
    const prima = elencoIcs(dir);
    const bottone = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
    await expect(bottone).toHaveCount(1, { timeout: 5_000 });
    await bottone.click();
    await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });
    const nati = elencoIcs(dir).filter((f) => !prima.includes(f));
    expect(nati.length).toBe(1);
    const ics = readFileSync(join(dir, nati[0]), 'utf8');
    expect(ics).toContain('DTSTART:20261024T220000');
    expect(ics).toContain('DTEND:20261025T020000');

    await restore(app, `__v567${id}`);
  });
}
