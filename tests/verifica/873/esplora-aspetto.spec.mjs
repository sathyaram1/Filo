// Esplorazione del giro 2: screenshot della riga di sistema in chiaro e scuro, nei vari stati.
import { test, expect } from '../../fixtures/electron.mjs';

const STATI = {
  pieno: { batteria: { livello: 100, inCarica: false, collegata: true }, rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' }, bluetooth: { acceso: true, dispositivi: ['Cuffie', 'Mouse'] } },
  bassa: { batteria: { livello: 9, inCarica: false, collegata: false }, rete: { online: false }, bluetooth: { acceso: false } },
  carica: { batteria: { livello: 55, inCarica: true, collegata: true }, rete: { online: true, tipo: 'cavo' }, bluetooth: { acceso: true, dispositivi: null } },
};

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, openTab }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    await app.evaluate(async (_, s) => {
      globalThis.__sf = s;
      await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sf);
    }, STATI.pieno);
    const page = await openTab('filo://newtab/');
    await page.waitForFunction((t) => document.documentElement.dataset.snTheme === t, tema, { timeout: 8000 });
    await expect(page.locator('#sistema .dash-sis-voce[data-voce="batteria"]')).toBeVisible({ timeout: 8000 });
    for (const [nome, s] of Object.entries(STATI)) {
      await app.evaluate(async (_, x) => { globalThis.__sf = x; await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra(); }, s);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `tests/.shots/873-g2-${tema}-${nome}.png` });
      const box = await page.locator('#sistema').boundingBox();
      if (box) await page.screenshot({ path: `tests/.shots/873-g2-${tema}-${nome}-zoom.png`, clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20), width: box.width + 40, height: box.height + 40 } });
    }
    await page.locator('#sistema .dash-sis-voce[data-voce="batteria"]').click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/873-g2-${tema}-box.png` });
  });
}
