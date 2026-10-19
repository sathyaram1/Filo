// Verifica #869 giro 2, rilievo 3: una pagina trovata con la ricerca della home si toglie dal filo col tasto destro,
// come dalla sua riga nella coda.
import { test, expect } from '../../fixtures/electron.mjs';

test('r3 tasto destro su una pagina trovata cercando: «Togli dal filo» c’è e la toglie', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [E.crea(E.TIPI.NAVIGAZIONE, { url: 'https://www.youtube.com/watch?v=orche', titolo: 'YouTube: orche' }, { ts: new Date(Date.now() - 600_000).toISOString(), dispositivo: qui })];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
  const page = await openTab('filo://newtab/');
  await page.locator('#cercaInput').fill('orche');
  const voce = page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'YouTube: orche' });
  await expect(voce).toBeVisible();
  await voce.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(0);
});
