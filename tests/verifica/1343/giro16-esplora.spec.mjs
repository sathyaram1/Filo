// Esplorazione giro 16: le azioni che chiedono un gesto sulla pagina, premute dalla barra laterale.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, premiNellaBarra } from '../../helpers/barra.mjs';

const PAGINA = `<!doctype html><html><head><title>Esplora</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1200px"><h1>Esplora</h1><p id="p">Testo.</p></body></html>`;

test('screenshot di una parte dalla barra: la barra si toglie e la selezione copre la pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await premiNellaBarra(app, 'screenshotCrop');
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 8000 });
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(false);
  await page.screenshot({ path: 'tests/.shots/giro16-crop.png' });
});

test('trascrivi dalla barra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await premiNellaBarra(app, 'transcribe');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('aperta', (await statoBarra(app)).aperta);
  await page.screenshot({ path: 'tests/.shots/giro16-trascrivi.png' });
  const barra = await barraPage(app);
  await barra.screenshot({ path: 'tests/.shots/giro16-trascrivi-barra.png' });
});
