// Esplorazione del giro 3: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

for (const id of ['contestoCache', 'traduzioneNascoste', 'lunghezzaConversazioni']) {
  test(`chiedi ${id}`, async ({ openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab('filo://preferences/preferences.html');
    await expect(page.locator(`#${id}`)).toBeAttached({ timeout: 10_000 });
    const html = await page.locator(`#${id}`).evaluate((el) => el.closest('label')?.outerHTML.slice(0, 900));
    console.log(`\n=== ${id}\n${html}`);
    const btn = page.locator(`#${id}`).locator('xpath=..').locator('.sn-select-button').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ button: 'right' });
    await menuDi(page).voce('Chiedi a Filo').first().click();
    const campo = page.locator('.sn-sidebar-input textarea');
    await expect(campo).toBeVisible({ timeout: 8_000 });
    console.log(`campo: ${await campo.inputValue()}`);
  });
}
