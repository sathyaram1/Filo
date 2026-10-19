// Verifica #869 giro 2, rilievo 2: una pagina tolta dal filo mentre la sua scheda è ancora aperta torna nella ricerca
// della home appena quella scheda si chiude.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 tolgo dal filo una pagina la cui scheda è aperta, poi chiudo la scheda: la ricerca non la ritrova', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBeGreaterThan(0);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'orche marine' });
  await orche.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    await window.filoShell.tabs.close(t.id);
  }, url);
  await new Promise((r) => setTimeout(r, 1500));
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati')).toBeVisible();
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  await expect(page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'orche marine' })).toHaveCount(0);
});
