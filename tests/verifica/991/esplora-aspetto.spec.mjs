// esplorazione: aspetto del bottone e del riquadro, sloggato.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriRedteamATutti } from '../../helpers/redteam.mjs';

test('aspetto sloggato', async ({ app, openTab }) => {
  await apriRedteamATutti(app);
  const rt = await openTab('filo://redteam/redteam.html');
  await expect(rt.locator('#attackBtn')).toBeVisible();
  await rt.screenshot({ path: 'tests/.shots/v991-chiaro.png' });
  await rt.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await rt.waitForTimeout(300);
  await rt.screenshot({ path: 'tests/.shots/v991-scuro.png' });
  await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
  await rt.locator('#attackBtn').click();
  await expect(rt.locator('.sn-rt-overlay .sn-rt-attack')).toBeVisible();
  await rt.waitForTimeout(800);
  await rt.screenshot({ path: 'tests/.shots/v991-riquadro-sloggato.png' });
  console.log('AVVISO', await rt.locator('.sn-rt-avviso').isVisible(), await rt.locator('.sn-rt-send').textContent());
  await rt.locator('#attackBtn').click({ button: 'right' });
  await rt.waitForTimeout(800);
  await rt.screenshot({ path: 'tests/.shots/v991-destro-bottone.png' });
});
