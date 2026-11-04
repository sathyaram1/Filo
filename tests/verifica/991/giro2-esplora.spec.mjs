import { test, expect } from '../../fixtures/electron.mjs';
import { apriRedteamATutti } from '../../helpers/redteam.mjs';

for (const tema of ['light', 'dark']) {
  test(`esplora pagina ${tema}`, async ({ app, openTab }) => {
    await apriRedteamATutti(app);
    const rt = await openTab('filo://redteam/redteam.html');
    await rt.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await expect(rt.locator('#attackBtn')).toBeVisible();
    await rt.waitForTimeout(500);
    await rt.screenshot({ path: `tests/.shots/v991-pagina-${tema}.png` });
    await rt.locator('#attackBtn').hover();
    await rt.waitForTimeout(300);
    await rt.screenshot({ path: `tests/.shots/v991-hover-${tema}.png`, clip: { x: 0, y: 0, width: 1000, height: 200 } });
    await rt.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8000 });
    await rt.locator('#attackBtn').click();
    await expect(rt.locator('.sn-rt-overlay .sn-rt-avviso')).toBeVisible();
    await rt.waitForTimeout(400);
    await rt.screenshot({ path: `tests/.shots/v991-riquadro-${tema}.png` });
    // Doppio clic veloce: un riquadro solo.
    await rt.locator('.sn-rt-cancel').click();
    await rt.locator('#attackBtn').dblclick();
    await rt.waitForTimeout(400);
    console.log('RIQUADRI', await rt.locator('.sn-rt-overlay').count());
    // Larghezza stretta
    await rt.setViewportSize?.({ width: 420, height: 700 }).catch(() => {});
  });
}
