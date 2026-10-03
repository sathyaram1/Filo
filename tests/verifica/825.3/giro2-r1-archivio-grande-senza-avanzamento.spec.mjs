// Verifica #825.3, giro 2, rilievo 1: con un archivio grande (oltre le schede
// indicizzate) il giudizio fa decine di chiamate e il pannello mostra solo la
// rotella, senza dire a che punto è.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('archivio di 5000 schede: mentre giudica, il pannello dice a che punto è', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const schede = [];
  for (let i = 0; i < 2000; i++) schede.push({ title: `Ricetta ${i}`, gatto: false });
  for (let i = 0; i < 3000; i++) schede.push({ title: i % 500 === 0 ? `Gatto ${i}` : `Vecchia ${i}`, senza: true });
  await prepara(app, schede, 400);
  await chiedi(page);
  const note = page.locator('.dash-delete-panel .dash-delete-note');
  await expect(note).toHaveAttribute('data-cerco', '1', { timeout: 10_000 });
  // Un avanzamento qualunque: un numero (fatte/tutte, percentuale) o una barra.
  await expect.poll(async () => {
    const testo = await note.innerText().catch(() => '');
    const barra = await page.locator('.dash-delete-panel progress, .dash-delete-panel [role="progressbar"]').count();
    return barra > 0 || /\d/.test(testo.replace(/“[^”]*”/g, ''));
  }, { timeout: 4_000 }).toBe(true);
});
