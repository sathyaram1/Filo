// #859, giro 1: altre porte dello stesso Esc fermato dal sito — sul documento, dentro un riquadro incorporato,
// e due Esc di fila. Passano: restano come porte provate e chiuse.
import { test, expect } from '../../fixtures/electron.mjs';

const ferma = (dove) => `<script>
  window.__escDelSito = 0;
  ${dove}.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    window.__escDelSito += 1;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
</script>`;
const corpo = '<body style="margin:0;height:1200px"><p id="t" style="font-size:22px">parola dentro una frase</p></body>';

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.contentFullscreen);
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 500));
}
async function esc(app, attesa = 900) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}
const menuAperto = (ctx) => ctx.evaluate(() => !!document.querySelector('.sn-menu'));

test('sito che ferma l\'Esc in cattura sul DOCUMENTO: il menu si chiude, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head>${ferma('document')}</head>${corpo}</html>`);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await esc(app);
  expect(await menuAperto(page)).toBe(false);
  expect(await schermoIntero(app)).toBe(true);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});

test('riquadro incorporato che ferma l\'Esc: il menu aperto lì dentro si chiude, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dentro = testServer.html(`<!doctype html><html><head>${ferma('window')}</head>${corpo}</html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id="f" src="${dentro}" style="width:600px;height:400px;border:0"></iframe></body></html>`);
  const frame = await (await page.waitForSelector('#f')).contentFrame();
  await frame.waitForSelector('#t');
  await entra(app);
  await page.frameLocator('#f').locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(frame), { timeout: 10_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));
  await esc(app);
  const dopo = { menu: await menuAperto(frame), fs: await schermoIntero(app), sito: await frame.evaluate(() => window.__escDelSito) };
  console.log('iframe dopo il primo Esc', JSON.stringify(dopo));
  expect(dopo.menu).toBe(false);
  expect(dopo.fs).toBe(true);
  await esc(app);
  expect(await schermoIntero(app)).toBe(false);
});

test('due Esc di fila, senza pausa, col menu aperto sul sito che ferma l\'Esc: menu chiuso e poi uscita', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head>${ferma('window')}</head>${corpo}</html>`);
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await esc(app, 0);
  await esc(app, 1200);
  const dopo = { menu: await menuAperto(page), fs: await schermoIntero(app) };
  console.log('due Esc di fila', JSON.stringify(dopo));
  expect(dopo.menu).toBe(false);
  expect(dopo.fs).toBe(false);
});
