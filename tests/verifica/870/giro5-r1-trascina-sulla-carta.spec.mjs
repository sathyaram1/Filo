// #870 giro 5, rilievo 1: una carta lasciata SOPRA un'altra prende il suo posto, in qualunque punto della carta cada.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, ordine, trascina } from './_comune.mjs';

test('i Mazzi lasciati sulla parte bassa dell’Editor si scambiano con lui', async ({ app }) => {
  const page = await home(app);
  expect(await ordine(page, 'tieni')).toEqual(['editor', 'mazzi', 'suggerimenti', 'rapide']);
  const mazzi = page.locator('#tieni .dash-carta[data-tipo="mazzi"]');
  const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
  await trascina(page, mazzi, editor, 0.7);
  await expect.poll(() => ordine(page, 'tieni')).toEqual(['mazzi', 'editor', 'suggerimenti', 'rapide']);
});

test('l’Editor lasciato sulla parte alta dei Mazzi si scambia con loro', async ({ app }) => {
  const page = await home(app);
  const mazzi = page.locator('#tieni .dash-carta[data-tipo="mazzi"]');
  const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
  await trascina(page, editor, mazzi, 0.3);
  await expect.poll(() => ordine(page, 'tieni')).toEqual(['mazzi', 'editor', 'suggerimenti', 'rapide']);
});

test('a sinistra, l’avviso lasciato sulla parte bassa del timer gli passa davanti', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 900 });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'La lavatrice ha finito.' });
  });
  await page.reload();
  await home(app);
  await expect.poll(() => ordine(page, 'accade')).toEqual(['crediti', 'timer', 'avviso']);
  await trascina(page, page.locator('#accade .dash-carta[data-tipo="avviso"]'), page.locator('#accade .dash-carta[data-tipo="timer"]'), 0.7);
  await expect.poll(() => ordine(page, 'accade')).toEqual(['crediti', 'avviso', 'timer']);
});
