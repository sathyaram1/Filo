import { test, expect } from '../../fixtures/electron.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');

async function newtab(app) {
  const t = Date.now() + 10_000;
  while (Date.now() < t) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab assente');
}

const misura = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const w = r(document.getElementById('inputForm'));
  const s = r(document.querySelector('#sendBtn:not([hidden]), #stopBtn:not([hidden])'));
  const m = document.querySelector('#inputForm .sn-voce-btn:not([hidden])');
  const mm = m ? r(m) : null;
  const c = r(document.getElementById('input'));
  return {
    wrapH: w.height, sopra: s.top - w.top, sotto: w.bottom - s.bottom, destra: w.right - s.right,
    sinistraCampo: c.left - w.left, campoH: c.height, campoCentro: c.top + c.height / 2 - (s.top + s.height / 2),
    micCentro: mm ? mm.top + mm.height / 2 - (s.top + s.height / 2) : null, micDx: mm ? s.left - mm.right : null,
  };
});

test('esplora stati del campo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#inputForm .sn-voce-btn')).toBeVisible({ timeout: 8_000 });
  const out = {};
  out.vuoto = await misura(page);
  await page.locator('#input').click();
  await page.keyboard.type('x'.repeat(400));
  out.lungo = await misura(page);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  out.svuotato = await misura(page);
  await page.keyboard.type('a\nb'.replace('\n', ''));
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.evaluate(() => { const d = document.getElementById('dashDir'); d.hidden = false; d.textContent = '/home/user/progetto'; });
  out.dir = await misura(page);
  await page.locator('#inputForm').screenshot({ path: join(SHOTS, '1489-v-dir.png') });
  await page.evaluate(() => { document.getElementById('dashDir').hidden = true; });
  await page.locator('#inputForm').screenshot({ path: join(SHOTS, '1489-v-scuro.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.locator('#inputForm').screenshot({ path: join(SHOTS, '1489-v-chiaro.png') });
  await page.screenshot({ path: join(SHOTS, '1489-v-pagina-chiaro.png') });
  console.log('MISURE', JSON.stringify(out, null, 1));
});
