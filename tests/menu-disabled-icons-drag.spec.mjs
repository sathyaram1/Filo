// Feedback yqgFIs: i tasti "avanti" e "indietro" sono correttamente grigi quando
// non avrebbero effetto, MA:
//   1. non si potevano trascinare per spostarli (l'attributo `disabled` nativo
//      azzerava i pointer event → niente drag);
//   2. spostando un'altra icona tornavano non grigi (il ridisegno dopo la posa
//      perdeva lo stato della navigazione).
// Da #1246 le icone stanno nella barra laterale: lì, su una scheda appena aperta
// (nessuna cronologia), si verifica che restino spente, trascinabili e spente
// anche dopo lo spostamento di un'altra icona.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo drag test</h1>
  <p>Una pagina appena aperta.</p>
</body></html>`;

async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
}

// Trascina `id` e lo posa nella metà alta di `sopra`: finisce davanti a lei.
async function trascina(barra, id, sopra) {
  const da = await barra.locator(`#nav .ico[data-id="${id}"]`).boundingBox();
  const a = await barra.locator(`#nav .ico[data-id="${sopra}"]`).boundingBox();
  await barra.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(da.x + da.width / 2 + 2, da.y + da.height / 2 + 10, { steps: 3 });
  await barra.mouse.move(a.x + a.width / 2, a.y + 4, { steps: 6 });
  await expect(barra.locator('#nav .segno')).toHaveCount(1);
  await barra.mouse.up();
}

test('avanti/indietro spenti si trascinano lo stesso (niente attributo disabled nativo)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);
  for (const id of ['back', 'forward']) {
    const btn = barra.locator(`#nav .ico[data-id="${id}"]`);
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(await btn.evaluate((el) => el.disabled === true), `${id} non deve avere l'attributo disabled nativo`).toBe(false);
  }
  await trascina(barra, 'forward', 'home');
  // In cima c'è l'Aiuto (#1432).
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 5)).toEqual(['help', 'back', 'reload', 'forward', 'home']);
  await expect(barra.locator('#nav .ico[data-id="forward"]')).toHaveAttribute('aria-disabled', 'true');
});

test('trascinare un\'altra icona non fa tornare attivi avanti/indietro', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await barraAperta(app);
  await expect(barra.locator('#nav .ico[data-id="back"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(barra.locator('#nav .ico[data-id="forward"]')).toHaveAttribute('aria-disabled', 'true');

  await trascina(barra, 'home', 'back');
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 3)).toEqual(['help', 'home', 'back']);
  await expect.poll(() => barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id).slice(0, 3))).toEqual(['help', 'home', 'back']);
  // Ridisegnate dopo la posa, restano spente: prima del fix tornavano colorate.
  await expect(barra.locator('#nav .ico[data-id="back"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(barra.locator('#nav .ico[data-id="forward"]')).toHaveAttribute('aria-disabled', 'true');
});
