// #870 giro 2, rilievo 1: chiesto a Filo di chiudere l'avviso «del documento», la riga di attività sotto la
// risposta deve nominare la carta tolta davvero, non l'Editor (che resta al suo posto).
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab, modelloFinto } from './_comune.mjs';

test('la riga di attività nomina l’avviso tolto, non la carta dell’Editor', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il documento è stato salvato nel cloud.' });
  });
  await modelloFinto(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: JSON.stringify({ operazione: 'togli', carta: 'l’avviso del documento' }) }] },
    { testo: 'Chiuso.' },
  ]);
  await page.reload();
  await homeTab(app);
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(1);
  await page.locator('#input').fill('chiudi l’avviso del documento');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Chiuso' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(0);
  await expect(page.locator('#tieni .dash-carta[data-tipo="editor"]')).toHaveCount(1);
  await page.getByText('Ha sistemato una carta della home').click();
  await page.waitForTimeout(400);
  const attivita = (await page.locator('#bubbles').innerText()).replace(/\s+/g, ' ');
  console.log('ATTIVITA:', attivita);
  expect(attivita).not.toMatch(/Carta tolta · Editor/);
});
