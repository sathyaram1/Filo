// Esplorazione del giro 3: screenshot della riga di sistema, chiaro e scuro, coi casi limite. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

const CASI = {
  pieno: { batteria: { livello: 42, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' }, bluetooth: { acceso: true, dispositivi: ['Cuffie', 'Mouse'] } },
  basso: { batteria: { livello: 9, inCarica: false, collegata: false }, rete: { online: false }, bluetooth: { acceso: false } },
  carica: { batteria: { livello: 100, inCarica: false, collegata: true }, rete: { online: true, tipo: 'cavo' }, bluetooth: { acceso: true, dispositivi: null } },
  lungo: { batteria: { livello: 77, inCarica: true, collegata: true }, rete: { online: true, tipo: 'wifi', nome: 'Rete-ospiti-del-condominio-di-via-Garibaldi-12-piano-terra 😀' }, bluetooth: { acceso: true, dispositivi: Array.from({ length: 12 }, (_, i) => `Dispositivo ${i}`) } },
};

test('aspetto', async ({ app }) => {
  test.setTimeout(120_000);
  mkdirSync('tests/.shots', { recursive: true });
  const page = await newtab(app);
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.filo.message({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    for (const [nome, l] of Object.entries(CASI)) {
      await app.evaluate(async (_, x) => {
        globalThis.__f = x;
        await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__f);
      }, l);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `tests/.shots/873-${tema}-${nome}.png` });
    }
    await page.locator('#sistema .dash-sis-voce[data-voce="bluetooth"]').click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/873-${tema}-box.png` });
    await page.keyboard.press('Escape');
    await page.locator('#sistema .dash-sis-voce[data-voce="batteria"]').hover();
    await page.waitForTimeout(300);
    await page.locator('#sistema').screenshot({ path: `tests/.shots/873-${tema}-hover.png` });
  }
  expect(true).toBe(true);
});
