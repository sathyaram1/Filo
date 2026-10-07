// #589.11 giro 4, rilievo 3: col menu aperto in un riquadro incorporato la pagina che lo contiene perde i suoi effetti:
// la pagina scura per inversione diventa bianca, il contenitore rimpicciolito torna a grandezza piena.
import { test, expect } from '../../fixtures/electron.mjs';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}
function luce(app, page, x, y) {
  return app.evaluate(async ({ BrowserWindow }, { u, x, y }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      const b = (await tab.view.webContents.capturePage({ x, y, width: 1, height: 1 })).toBitmap();
      return (b[0] + b[1] + b[2]) / 3;
    }
    return null;
  }, { u: page.url(), x, y });
}
async function riquadroDi(page) {
  const del = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
  await expect.poll(() => !!del()).toBe(true);
  const frame = del();
  await frame.waitForSelector('#campo');
  return frame;
}
const RIQUADRO = `<!doctype html><html><body style="margin:10px;background:#fff">
  <input id="campo" style="width:240px;font-size:16px"></body></html>`;

test('r3 una pagina scura per inversione resta scura col menu aperto nel suo riquadro', async ({ app, openTab, testServer }) => {
  const riquadro = testServer.html(RIQUADRO, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html style="filter:invert(1) hue-rotate(180deg)">
    <body style="padding:20px;background:#fff"><iframe src="${riquadro}" style="width:500px;height:300px;border:0"></iframe></body></html>`);
  const frame = await riquadroDi(page);
  await expect.poll(() => luce(app, page, 900, 600)).toBeLessThan(60);
  await frame.locator('#campo').click({ button: 'right' });
  await expect(frame.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await luce(app, page, 900, 600), 'lontano dal menu la pagina è diventata chiara').toBeLessThan(60);
});

test('r3 un riquadro in un contenitore rimpicciolito non cambia misura quando si apre il menu', async ({ openTab, testServer }) => {
  const riquadro = testServer.html(RIQUADRO, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:20px">
    <div style="transform:scale(0.75);transform-origin:0 0"><iframe src="${riquadro}" style="width:600px;height:420px;border:0"></iframe></div>
    </body></html>`);
  const frame = await riquadroDi(page);
  const prima = await page.locator('iframe').boundingBox();
  await frame.locator('#campo').click({ button: 'right' });
  await expect(frame.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(300);
  const dopo = await page.locator('iframe').boundingBox();
  expect(Math.round(dopo.width), 'il riquadro si è ingrandito col menu aperto').toBe(Math.round(prima.width));
});
