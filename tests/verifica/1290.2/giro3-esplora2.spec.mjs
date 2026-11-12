// Verifica #1290.2 giro 3: la sezione che il sito scrive quando la si apre (fisarmoniche che montano il contenuto al clic).
import { test, expect } from '../../fixtures/electron.mjs';
import { stub, soloQuandoApro, watchToasts, toasts, clickTranslateIcon } from './aiuto-giro3.mjs';

const MONTATA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a part the site writes when opened</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up by the translation.</p>
  <button id="apri" onclick="document.getElementById('sez').innerHTML = '<p id=psez>A paragraph the site writes only when the section is opened, long enough.</p>'">Show more</button>
  <div id="sez"></div>
  <button id="apri2" onclick="document.getElementById('s2').hidden = false">Show the rest</button>
  <div id="s2" hidden><p id="ps2">A paragraph inside the second folded section, also long enough to be translated.</p></div>
</body></html>`;

for (const [modo, imposta] of [['solo quando apro', soloQuandoApro], ['di serie', null]]) {
  test(`${modo}: la sezione che il sito scrive al clic si traduce da sola`, async ({ app, openTab, testServer }) => {
    await stub(app);
    if (imposta) await imposta(app);
    const page = await testServer.openReady(openTab, MONTATA);
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
    await page.locator('#apri').click();
    await expect(page.locator('#psez')).toBeVisible();
    await page.waitForTimeout(4000);
    console.log(`[${modo}] psez: ${await page.locator('#psez').textContent()}`);
    await expect(page.locator('#psez')).toHaveText(/^IT /, { timeout: 1000 });
  });
}
