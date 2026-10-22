// Giro 10, rilievo 1: a schermo intero, con le schede scoperte dal bordo in alto, il pulsante quadrato della fila
// dice «Massimizza» e il clic non fa niente: la finestra è già a tutto schermo. Chi lo preme vuole uscirne.
import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Sito</title></head><body style="margin:0;padding:40px;height:1400px"><h1>Sito</h1></body></html>';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { schermoIntero: tm.contentFullscreen, y: t.view.getBounds().y };
});

test('r1 a schermo intero il pulsante quadrato fra le schede scoperte fa uscire dallo schermo intero', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await expect.poll(async () => (await stato(app)).schermoIntero).toBe(true);
  await pausa(500);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).y, { message: 'le schede arrivano dal bordo in alto' }).toBeGreaterThan(0);
  const quadrato = shell.locator('#win-max');
  await expect(quadrato).toBeVisible();
  await quadrato.click();
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 4000, message: 'il clic sul quadrato porta fuori dallo schermo intero' }).toBe(false);
});
