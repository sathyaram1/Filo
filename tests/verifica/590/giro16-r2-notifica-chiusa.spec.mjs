// Verifica #590 giro 16, rilievo 2: chiusa la notifica «Sito bloccato», un secondo tentativo
// subito dopo non deve finire nel silenzio (il blocco muto sembra un guasto, #482).
import { test, expect, lista } from '../../helpers/reteFinta.mjs';

test('chiusa la notifica, il secondo clic sullo stesso link fermato torna a dirlo', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const pagina = rete.pagina('sito.test', '/', `<a id="go" href="${bersaglio}">vai</a>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(() => !!app.windows().find((w) => w.url().includes('sito.test')), { timeout: 8000 }).toBe(true);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.waitForSelector('#go');

  const avvisi = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await tab.evaluate(() => document.getElementById('go').click());
  await expect(avvisi.first()).toBeVisible({ timeout: 6000 });
  await avvisi.first().locator('.shell-notif-close').click();
  await expect(avvisi).toHaveCount(0, { timeout: 3000 });

  await tab.evaluate(() => document.getElementById('go').click());
  await expect(avvisi.first(), 'il secondo clic non apre niente e non dice niente').toBeVisible({ timeout: 3000 });
  expect(tab.url()).toBe(pagina);
});
