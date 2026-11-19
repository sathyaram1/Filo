import { test, expect } from './fixtures/electron.mjs';
import { modelloFinto, home, chiedi } from './helpers/chatFinta.mjs';

test('debug spiegazioni', async ({ app }) => {
  await modelloFinto(app, [{ text: 'Risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati.}}.' }]);
  const page = await home(app);
  await chiedi(page, 'come fa il browser a trovare un sito?');
  const parola = page.locator('.dash-bubble-md .filo-spiega', { hasText: 'cache' }).last();
  await expect(parola).toBeVisible();
  await expect(page.locator('#input')).toBeEditable();
  const info = await parola.evaluate((el) => {
    const out = [];
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      out.push(`${n.tagName}.${n.className}#${n.id} oy=${s.overflowY} sh=${n.scrollHeight} ch=${n.clientHeight} st=${n.scrollTop}`);
    }
    window.__eventi = [];
    window.addEventListener('scroll', (e) => window.__eventi.push(`${e.target.className || e.target.nodeName}:${e.target.scrollTop}`), true);
    return out.join('\n');
  });
  console.log(info);
  await parola.click({ button: 'right' });
  await expect(page.locator('.filo-spiega-menu')).toBeVisible();
  const prima = await page.evaluate(() => [...document.querySelectorAll('*')].filter((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight).map((n) => `${n.className}#${n.id} st=${n.scrollTop}`));
  console.log('scorrevoli', prima);
  const r = await parola.evaluate((el) => {
    let chi = el.parentElement;
    while (chi && chi !== document.body && !/(auto|scroll)/.test(getComputedStyle(chi).overflowY)) chi = chi.parentElement;
    const a = chi.scrollTop;
    chi.style.paddingTop = '4000px';
    const b = chi.scrollTop;
    chi.scrollBy({ top: -200, behavior: 'instant' });
    return `${chi.className} ${a} ${b} ${chi.scrollTop} typeof foto ${typeof window.SN_MENU?.fotoDelloScorrimento}`;
  });
  console.log(r);
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 400)));
  console.log('eventi', await page.evaluate(() => window.__eventi));
  console.log('menu', await page.locator('.filo-spiega-menu').count());
});
