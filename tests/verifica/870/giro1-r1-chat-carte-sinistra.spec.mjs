// #870 giro 1, rilievo 1: «ogni cosa si può chiedere anche a Filo» vale anche per le carte di sinistra.
// Il tasto destro toglie un avviso dalla home; chiesto a parole, la stessa mossa deve riuscire.
// Chi corregge può cambiare la chiamata del modello finto se sceglie un'altra azione: conta l'esito.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab, modelloFinto } from './_comune.mjs';

test('chiesto a Filo, un avviso a sinistra si toglie dalla home come dal tasto destro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  const id = await app.evaluate(async () => {
    const n = await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' });
    return n && n.id;
  });
  await page.reload();
  await homeTab(app);
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'backup delle foto' });
  await expect(carta).toBeVisible();
  const chiave = await carta.getAttribute('data-chiave');
  await modelloFinto(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: JSON.stringify({ operazione: 'togli', carta: chiave || `avviso:${id}` }) }] },
    { testo: 'Tolto dalla home.' },
  ]);
  await page.locator('#input').fill('togli dalla home l’avviso del backup');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tolto' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'backup delle foto' })).toHaveCount(0, { timeout: 5_000 });
});
