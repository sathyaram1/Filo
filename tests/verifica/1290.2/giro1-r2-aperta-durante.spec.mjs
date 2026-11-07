// Verifica #1290.2 giro 1, rilievo 2: con «solo quando le apro», la sezione aperta mentre la traduzione lavora resta in
// inglese anche dopo.
import { test, expect } from '../../fixtures/electron.mjs';
import { stubTranslationProvider, soloQuandoApro, watchToasts, toasts, clickTranslateIcon } from './aiuti.mjs';

const PIEGATA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a folded part</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up by the translation.</p>
  <button id="apri" onclick="document.getElementById('sez').hidden = false">Show more</button>
  <div id="sez" hidden><p id="psez">A paragraph inside the folded section, long enough to be translated.</p></div>
</body></html>`;

test('r2 solo quando apro: la sezione aperta mentre la traduzione lavora si traduce anche lei', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app, 4000);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, PIEGATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 10000 }).toContain('in corso');
  await page.locator('#apri').click();
  // Il presupposto: la sezione si apre prima che la traduzione abbia finito.
  expect((await toasts(page)).join(' | ')).not.toContain('Pagina tradotta');

  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#psez')).toHaveText(/^IT /, { timeout: 15000 });
});
