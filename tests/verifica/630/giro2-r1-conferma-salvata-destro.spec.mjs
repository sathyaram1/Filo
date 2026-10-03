// Verifica #630 giro 2, rilievo 1: la conferma «Salvata in: … · Apri la lista» sta nella stessa pila degli avvisi
// della pagina e aspetta il puntatore come loro: col tasto destro il menu deve essere il suo (apri la lista, Chiudi).
import { test, expect } from '../../fixtures/electron.mjs';

test('tasto destro sulla conferma «Salvata in»: il menu offre «Chiudi», non quello della pagina', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!(globalThis.SN_ACTIONS && globalThis.SN_AVVISI), null, { timeout: 8000 });
  await page.evaluate(() => globalThis.SN_ACTIONS.showSaveConfirm({ id: 'x1', category: 'Lavoro' }, { chiudiScheda: false }));
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toHaveClass(/sn-save-confirm-visible/);
  await page.waitForTimeout(300);
  const b = await pill.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const chiudi = page.locator('.sn-menu .sn-menu-item', { hasText: /^Chiudi/ });
  await expect(chiudi, 'il tasto destro sulla conferma apre il menu della pagina').toHaveCount(1, { timeout: 2000 });
  await chiudi.click();
  await expect(pill).toHaveCount(0, { timeout: 1500 });
});
