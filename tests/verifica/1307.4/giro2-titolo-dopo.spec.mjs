// Verifica #1307.4, giro 2: una scheda vera che si dà il titolo dopo il caricamento, con la home già davanti.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('una scheda vera rititolata con la home davanti: il gruppo prende il nome nuovo senza uscire dalla home', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const nome of ['orche che cacciano', 'delfini']) {
    const p = await openTab(testServer.html(`<title>${nome}</title><p>${nome}</p>`));
    await p.waitForFunction((n) => document.title === n, nome);
  }
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(2);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('2 pagine, fra cui delfini');
  const lenta = await openTab(testServer.html('<title>Caricamento…</title><p>x</p><script>setTimeout(() => { document.title = "balene vere"; }, 2500);</script>'));
  await lenta.waitForFunction(() => document.title === 'Caricamento…');
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui balene vere', { timeout: 30_000 });
  await expect(page.locator('.dash-pagine')).toHaveCount(1);
});
