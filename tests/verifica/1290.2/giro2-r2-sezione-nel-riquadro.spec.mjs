// Verifica #1290.2 giro 2, rilievo 2: con «Solo quando le apro» la sezione aperta dentro un riquadro incorporato si
// traduce da sola, come quella della pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { stub, soloQuandoApro, watchToasts, toasts, sentText, clickTranslateIcon, frameInner, framePage } from './aiuto-giro2.mjs';

test('r2 solo quando apro: la sezione aperta dentro un riquadro incorporato si traduce da sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  await soloQuandoApro(app);
  const src = testServer.html(frameInner('ZZEMB', `<button id="apri" onclick="document.getElementById('sez').hidden = false">Read more</button>
    <div id="sez" hidden><p id="fsez">ZZSEZ the rest of the embedded post, hidden until the reader opens it.</p></div>`)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`<iframe id="emb" src="${src}" style="width:520px;height:260px"></iframe>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT ZZEMB /, { timeout: 60000 });
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  expect(await sentText(app)).not.toContain('ZZSEZ');
  await page.frameLocator('#emb').locator('#apri').click();
  await expect(page.frameLocator('#emb').locator('#fsez')).toHaveText(/^IT ZZSEZ /, { timeout: 15000 });
});
