import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('esplora: due bolle dopo il no', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [{ title: 'Meteo', url: 'https://meteo.test/', content: 'sole' }] });
  });
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Bologna.\nHa un gatto.', PREFERENZE: '' }));
  const dump = (tag) => page.evaluate((tag) => [...document.querySelectorAll('.dash-bubble')].map((b) => {
    const r = b.getBoundingClientRect();
    return `${tag} | ${b.className} | key=${b.dataset.key || ''} | parent=${b.parentElement?.id || b.parentElement?.className} | vis=${r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'} | ${String(b.textContent).slice(0, 60)}`;
  }).join('\n'), tag);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'DIMENTICA', arguments: JSON.stringify({ testo: 'Bologna', per_sempre: true }) }] },
      { toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo' }) }] },
      { text: 'Sole.' },
      { toolCalls: [{ id: 'f2', name: 'DIMENTICA', arguments: JSON.stringify({ testo: 'gatto', per_sempre: true }) }] },
      { text: 'Non posso, dopo la ricerca.' },
    ]);
    await chiedi(page, 'dimentica per sempre che vivo a Bologna');
    const btn = page.locator('button.dash-action-btn', { hasText: 'cancellare per sempre' });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await btn.click();
    await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'danger');
    await page.waitForTimeout(3000);
    console.log(await dump('dopo-conferma'));
    await chiedi(page, 'cerca il meteo');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Sole.' }).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    console.log(await dump('dopo-meteo'));
    await chiedi(page, 'dimentica per sempre che ho un gatto');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Non posso' }).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    console.log(await dump('dopo-no'));
    console.log('giri:', await app.evaluate(() => globalThis.__chatFinta_n ?? null));
  } finally {
    await ripristina(app);
  }
});
