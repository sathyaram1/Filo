// Esplorazione del giro 11: dopo «conferma» su «sblocca example.org», cosa resta a schermo?
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, confirmText, clickConfirm, scrollConfirmToEnd, fillConfirmInput } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const chiamata = (id, name, args) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

test('esplora: dopo la parola il riquadro si chiude', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async () => {
    const s = (await globalThis.SN_STORAGE.getSettings()).security || {};
    await globalThis.SN_STORAGE.updateSettings({
      autonomia: { livello: 'default' },
      security: { ...s, siteBlock: { ...(s.siteBlock || {}), blacklist: ['example.org', 'altro.example'] } },
    });
  });
  try {
    await modelloFinto(app, [chiamata('p0', 'IMPOSTA_PREFERENZA', { chiave: 'siti_bloccati', valore: 'togli example.org' }), { text: 'Serve la tua conferma.' }]);
    await chiedi(page, 'sblocca example.org');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
    console.log('PRIMO', await confirmText(page));
    await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'danger');
    await page.waitForTimeout(4000);
    const n = await page.locator(CONFIRM_HOST).count();
    console.log('HOST DOPO', n, n ? JSON.stringify(await confirmState(page)) : '', n ? await confirmText(page).catch(() => '') : '');
    console.log('BLACKLIST', JSON.stringify((await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.siteBlock.blacklist))));
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    console.log('BOLLE', JSON.stringify(await page.locator('.dash-bubble').allInnerTexts()));
    await page.screenshot({ path: 'tests/.shots/giro11-sblocca.png' });
  } finally {
    await ripristina(app);
  }
});
