import { test, expect } from './fixtures/electron.mjs';
import { modelloFinto, home, chiedi } from './helpers/chatFinta.mjs';

test('debug spiegazioni', async ({ app }) => {
  await modelloFinto(app, [{ text: 'Risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati.}}.' }]);
  const page = await home(app);
  await chiedi(page, 'come fa il browser a trovare un sito?');
  const parola = page.locator('.dash-bubble-md .filo-spiega', { hasText: 'cache' }).last();
  await expect(parola).toBeVisible();
  await expect(page.locator('#input')).toBeEditable();
  await page.evaluate(() => {
    const chi = document.getElementById('bubbles');
    chi.style.paddingTop = '4000px';
    window.__eventi = [];
    window.addEventListener('scroll', (e) => window.__eventi.push(`${e.target.id || e.target.nodeName}:${e.target.scrollTop}`), true);
  });
  await parola.scrollIntoViewIfNeeded();
  console.log('dopo intoview', await page.evaluate(() => document.getElementById('bubbles').scrollTop));
  await page.evaluate(() => {
    const chi = document.getElementById('bubbles');
    window.addEventListener('contextmenu', (e) => {
      chi.scrollBy({ top: -300, behavior: 'instant' });
      window.__eventi.push(`cm ${e.clientX},${e.clientY} st=${chi.scrollTop} at=${document.elementFromPoint(e.clientX, e.clientY)?.className}`);
    }, { capture: true, once: true });
  });
  await parola.click({ button: 'right' });
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 300)));
  console.log('menu', await page.locator('.filo-spiega-menu').count(), await page.evaluate(() => window.__eventi));
  await page.evaluate(() => document.getElementById('bubbles').scrollBy({ top: -200, behavior: 'instant' }));
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 300)));
  console.log('menu', await page.locator('.filo-spiega-menu').count(), await page.evaluate(() => window.__eventi));
});
