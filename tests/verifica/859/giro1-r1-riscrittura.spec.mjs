// #859, giro 1, rilievo 1: una pagina che si riscrive (document.open) e nel documento nuovo ferma l'Esc sulla finestra
// arriva di nuovo prima del menu di Filo. Il controllo senza gestore dice che il resto della riscrittura funziona.
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

test('r1 pagina che si riscrive (document.open) e poi ferma l\'Esc: il menu si chiude, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  const scritto = `<!doctype html><html><head>${ferma('window')}</head>${corpo}</html>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head></head><body>
    <script>setTimeout(function () { document.open(); document.write(${JSON.stringify(scritto).replace(/<\//g, '<\\/')}); document.close(); }, 300);</script>
    </body></html>`);
  await page.waitForFunction(() => document.getElementById('t') && typeof window.__escDelSito === 'number', null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await esc(app);
  const dopo = { menu: await menuAperto(page), fs: await schermoIntero(app), sito: await page.evaluate(() => window.__escDelSito) };
  console.log('riscrittura dopo il primo Esc', JSON.stringify(dopo));
  expect(dopo.menu).toBe(false);
  expect(dopo.fs).toBe(true);
});

test('controllo: pagina che si riscrive senza gestore dell\'Esc: il menu si chiude, lo schermo intero resta', async ({ app, openTab, testServer }) => {
  const scritto = `<!doctype html><html><head><script>window.__escDelSito = 0;</script></head>${corpo}</html>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head></head><body>
    <script>setTimeout(function () { document.open(); document.write(${JSON.stringify(scritto).replace(/<\//g, '<\\/')}); document.close(); }, 300);</script>
    </body></html>`);
  await page.waitForFunction(() => document.getElementById('t') && typeof window.__escDelSito === 'number', null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  await entra(app);
  await page.locator('#t').click({ button: 'right' });
  await expect.poll(() => menuAperto(page), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await esc(app);
  const dopo = { menu: await menuAperto(page), fs: await schermoIntero(app), sito: await page.evaluate(() => window.__escDelSito) };
  console.log('riscrittura dopo il primo Esc', JSON.stringify(dopo));
  expect(dopo.menu).toBe(false);
  expect(dopo.fs).toBe(true);
});

