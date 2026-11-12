// Verifica #1290.2 giro 3, rilievo 1: con «Solo quando le apro» la sezione che il sito scrive nel momento in cui la si
// apre (le fisarmoniche che montano il contenuto al clic) resta in inglese, invece di tradursi da sola.
import { test, expect } from '../../fixtures/electron.mjs';
import { stub, soloQuandoApro, watchToasts, toasts, clickTranslateIcon } from './aiuto-giro3.mjs';

const MONTATA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a part the site writes when opened</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up by the translation.</p>
  <button id="apri" onclick="document.getElementById('sez').innerHTML = '<p id=psez>A paragraph the site writes only when the section is opened, long enough.</p>'">Show more</button>
  <div id="sez"></div>
  <div id="s2" hidden><p id="ps2">A paragraph inside a folded section, also long enough to be translated.</p></div>
</body></html>`;

test('r1 solo quando apro: la sezione che il sito scrive quando la si apre si traduce da sola', async ({ app, openTab, testServer }) => {
  await stub(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, MONTATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.locator('#apri').click();
  await expect(page.locator('#psez')).toBeVisible();
  // La promessa delle Preferenze: tradotta in un paio di secondi dall'apertura, senza toccare altro.
  await expect(page.locator('#psez')).toHaveText(/^IT /, { timeout: 6000 });
});
