// Feedback yqgFIs, nella barra laterale: Indietro e Avanti spenti (scheda senza cronologia) si trascinano lo stesso,
// perché lo spento non è l'attributo `disabled` nativo che toglie i gesti del puntatore; e riordinando un'altra icona
// restano spenti, perché il ridisegno dopo la posa non dimentica lo stato della scheda.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo drag test</h1>
  <p>Una scheda appena aperta, senza cronologia.</p>
</body></html>`;

async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
}

// Trascina l'icona `id` col mouse della vista della barra fino a `y` (px della vista).
async function trascina(barra, id, y) {
  const b = await barra.locator(`#nav .ico[data-id="${id}"]`).boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 6, { steps: 3 });
  await barra.mouse.move(b.x + b.width / 2, y, { steps: 8 });
  await barra.mouse.up();
}

test('avanti/indietro spenti si trascinano (niente attributo disabled nativo)', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);

  for (const id of ['back', 'forward']) {
    const btn = barra.locator(`#nav .ico[data-id="${id}"]`);
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(await btn.evaluate((el) => el.disabled === true), `${id} non deve avere l'attributo disabled nativo`).toBe(false);
  }

  // Indietro, spento, portato sotto Ricarica.
  const reload = await barra.locator('#nav .ico[data-id="reload"]').boundingBox();
  await trascina(barra, 'back', reload.y + reload.height - 4);
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 4)).toEqual(['help', 'forward', 'reload', 'back']);
  await expect(barra.locator('#nav .ico[data-id="back"]')).toHaveAttribute('aria-disabled', 'true');
});

test('trascinare un\'altra icona non fa tornare accesi avanti/indietro', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);
  const back = barra.locator('#nav .ico[data-id="back"]');
  const forward = barra.locator('#nav .ico[data-id="forward"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(forward).toHaveAttribute('aria-disabled', 'true');

  // Ricarica sopra Indietro: la barra si ridisegna con l'ordine nuovo.
  const b = await back.boundingBox();
  await trascina(barra, 'reload', b.y + 4);
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 4)).toEqual(['help', 'reload', 'back', 'forward']);
  await expect.poll(() => barra.$$eval('#nav .ico[data-id]', (els) => els.map((e) => e.dataset.id).slice(0, 4)))
    .toEqual(['help', 'reload', 'back', 'forward']);

  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(forward).toHaveAttribute('aria-disabled', 'true');
});
