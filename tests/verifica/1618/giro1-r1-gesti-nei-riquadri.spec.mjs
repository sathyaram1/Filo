// Verifica #1618 giro 1: un gesto vero dentro un riquadro della pagina (gioco, editor, lettore incorporato) dice
// che l'utente c'è, come lo stesso gesto nella pagina: senza, la pulizia per inattività parte mentre lui sta usando Filo.
import { test, expect } from '../../fixtures/electron.mjs';

const ORA = 3600_000;

const tm = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._lastAppInteractionAt);
const indietro = (app, ms) => app.evaluate(({ BrowserWindow }, ms) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  t._lastAppInteractionAt = Date.now() - ms;
  return t._lastAppInteractionAt;
}, ms);

test('r1 un clic e la rotella dentro un riquadro della pagina contano come uso di Filo', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><head><title>Gioco</title></head><body style="margin:0">'
    + '<canvas id="c" width="600" height="500" style="background:#cde"></canvas><div style="height:3000px"></div></body></html>');
  const pagina = await testServer.openReady(openTab, '<!doctype html><html><head><title>Sala giochi</title></head><body style="margin:0">'
    + `<iframe id="f" src="${dentro}" style="width:700px;height:600px;border:0"></iframe></body></html>`);
  const riquadro = pagina.frameLocator('#f');
  await riquadro.locator('#c').waitFor();
  await pagina.waitForTimeout(1500);

  const primaClic = await indietro(app, 7 * ORA);
  await riquadro.locator('#c').click({ position: { x: 100, y: 100 } });
  await expect.poll(() => tm(app), { timeout: 5_000, message: 'il clic nel riquadro non ha contato come uso di Filo' })
    .toBeGreaterThan(primaClic + 6 * ORA);

  await pagina.waitForTimeout(2100);
  const primaRotella = await indietro(app, 7 * ORA);
  await pagina.mouse.move(200, 200);
  await pagina.mouse.wheel(0, 400);
  await expect.poll(() => tm(app), { timeout: 5_000, message: 'la rotella nel riquadro non ha contato come uso di Filo' })
    .toBeGreaterThan(primaRotella + 6 * ORA);
});

test('esplorazione: un clic nella home di Filo conta come uso', async ({ app, openTab }) => {
  const home = await openTab('filo://home/home.html');
  await home.waitForTimeout(1500);
  const prima = await indietro(app, 7 * ORA);
  await home.mouse.click(400, 400);
  await expect.poll(() => tm(app), { timeout: 5_000 }).toBeGreaterThan(prima + 6 * ORA);
});
