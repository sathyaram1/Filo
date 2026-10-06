// Giro 18, rilievo 2: in un campo dentro un dialogo modale del sito il menu del tasto destro si vede ma non risponde
// (su main non si vedeva nemmeno): Incolla deve incollare.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('r2 dentro un dialogo modale del sito, un clic vero su Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo</title><body>
    <dialog id="d" style="width:420px;height:300px"><input id="c" style="margin:40px;width:300px"></dialog>
    <script>document.getElementById('d').showModal()</script></body>`);
  await app.evaluate(({ clipboard }) => clipboard.writeText('dialogo-586'));
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  const voce = page.locator('.sn-menu .sn-menu-paste-main').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe('dialogo-586');
});
