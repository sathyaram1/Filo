// Verifica #2461, giro 1, rilievo 1: con la Modifica aperta su un campo del sito, nel documento del sito non c'è
// nessun host che si dichiari riquadro, nemmeno quello dei segni del correttore (main lo toglie dal #2460).
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">'
  + '<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea></body></html>';

test('r1 Modifica su un campo del sito: nessun host con l\'attributo dei riquadri nel documento del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina);
  await p.locator('#campo').click();
  await p.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await p.locator('#campo').click({ button: 'right' });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(p).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, p, '.sn-editbox')).not.toBeNull();
  expect((await statoDi(app, p, '.sn-editbox')).nelloStrato).toBe(true);
  await p.waitForTimeout(1500);
  expect(await p.evaluate(() => document.querySelectorAll('[data-sn-riquadro]').length), 'host che si dichiarano riquadro nel sito').toBe(0);
});
