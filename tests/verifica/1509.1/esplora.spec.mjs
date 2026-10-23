// Esplorazione del giro 2 di #1509.1: Modifica su un campo ricco.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, scrivi, clicca, conta } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, complete: async () => ({ text: 'Testo riscritto per bene.', usage: {} }) };
  });
}

test('Modifica su un campo ricco: Sostituisci', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><body style="padding:40px"><div id="ed" contenteditable="true" style="width:400px;height:80px;border:1px solid #333">Prima riga. Un testo con un erore. Fine.</div></body>');
  await p.evaluate(() => {
    const ed = document.querySelector('#ed'); ed.focus();
    const t = ed.firstChild; const r = document.createRange();
    const i = t.data.indexOf('Un testo'); r.setStart(t, i); r.setEnd(t, i + 'Un testo con un erore.'.length);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await p.locator('#ed').click({ button: 'right', position: { x: 150, y: 10 } });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(p).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, p, '.sn-editbox-instruction')).not.toBeNull();
  const strato = await scrivi(app, p, '.sn-editbox-instruction', 'correggi');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, p, '.sn-editbox-proposed'))?.testo || '').toContain('riscritto');
  await clicca(app, p, '.sn-editbox-replace');
  await p.waitForTimeout(800);
  console.log('RICCO dopo:', JSON.stringify(await p.locator('#ed').innerText()), 'riquadri', await conta(app, p, '.sn-editbox'));
});
