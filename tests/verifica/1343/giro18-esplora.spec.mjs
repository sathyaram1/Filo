// Esplorazione del giro 18: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const PAGINA = (t) => `<!doctype html><title>${t}</title><body style="margin:0;padding:40px;height:1200px"><h1>${t}</h1></body>`;
const registro = (app) => app.evaluate(async () => { await globalThis.SN_REGISTRO_CAMBI.attesa(); return globalThis.SN_REGISTRO_CAMBI.lista(); });
const annulla = (app, id) => app.evaluate(async (_e, i) => globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'filo' }), id);
async function trascina(barra, id, y) {
  const b = await barra.locator(`#nav .ico[data-id="${id}"]`).boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 - 6, { steps: 3 });
  await barra.mouse.move(b.x + b.width / 2, y, { steps: 8 });
  await barra.mouse.up();
}

test('esplora: due spostamenti, annulli e rifai', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Uno'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const prima = (await statoBarra(app)).bar;
  console.log('PRIMA', JSON.stringify(prima));
  let back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await trascina(barra, 'qrCode', back.y + 4);
  await expect.poll(async () => (await statoBarra(app)).bar.indexOf('qrCode')).toBe(1);
  back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await trascina(barra, 'share', back.y + 4);
  await expect.poll(async () => (await statoBarra(app)).bar.indexOf('share')).toBe(2);
  const dopo = (await statoBarra(app)).bar;
  console.log('DOPO', JSON.stringify(dopo));
  const ev = (await registro(app)).filter((e) => e.tipo === 'icone');
  console.log('EVENTI', JSON.stringify(ev.map((e) => ({ id: e.id, via: e.via, cambi: e.cambi }))));
  // annulla l'ultimo, poi il primo
  console.log('A1', JSON.stringify(await annulla(app, null)));
  await new Promise((r) => setTimeout(r, 500));
  console.log('DOPO A1', JSON.stringify((await statoBarra(app)).bar));
  console.log('A2', JSON.stringify(await annulla(app, null)));
  await new Promise((r) => setTimeout(r, 500));
  const tornata = (await statoBarra(app)).bar;
  console.log('DOPO A2', JSON.stringify(tornata));
  expect(tornata).toEqual(prima);
  // rifai: annulla l'ultimo annullo
  console.log('A3', JSON.stringify(await annulla(app, null)));
  await new Promise((r) => setTimeout(r, 500));
  console.log('DOPO A3', JSON.stringify((await statoBarra(app)).bar));
  console.log('ORDINE VISTO', JSON.stringify(await barra.$$eval('#nav .ico[data-id]', (els) => els.map((e) => e.dataset.id))));
});

test('esplora: dall\'«Altro…» alla barra trascinando, e aspetto chiaro e scuro', async ({ app, openTab, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  await testServer.openReady(openTab, PAGINA('Due'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav [data-altro]').click();
  await new Promise((r) => setTimeout(r, 400));
  await barra.screenshot({ path: 'tests/.shots/g18-barra-chiara-altro.png' });
  const sec = (await statoBarra(app)).secondary;
  console.log('SECONDARY', JSON.stringify(sec));
  const id = sec.find((x) => ['screenshotCrop', 'transcribe', 'colorPicker'].includes(x)) || sec[0];
  const back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await trascina(barra, id, back.y + 4);
  await new Promise((r) => setTimeout(r, 600));
  const s = await statoBarra(app);
  console.log('DOPO TRASCINA', id, JSON.stringify(s.bar), JSON.stringify(s.secondary));
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await new Promise((r) => setTimeout(r, 800));
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.screenshot({ path: 'tests/.shots/g18-barra-scura.png' });
  await barra.locator('#nav [data-altro]').click().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await barra.screenshot({ path: 'tests/.shots/g18-barra-scura-altro.png' });
});
