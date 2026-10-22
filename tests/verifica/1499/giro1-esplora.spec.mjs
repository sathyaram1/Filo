// #1499, verifica giro 1: il bottone del file con un'etichetta lunghissima del modello, temi chiaro e scuro, e una
// ricerca in una cartella assoluta fuori dalla casa dietro un segno di citazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const testoDeiMessaggi = (m) => (m || []).map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))).join('\n');

test('etichetta lunghissima: il nome vero del file resta leggibile, in chiaro e in scuro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Vero');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'malevolo.pdf');
  writeFileSync(vero, '%PDF-1.4');
  try {
    const lunga = 'Bolletta della luce di marzo 2026 del fornitore di energia elettrica, quella giusta da pagare entro venerdì '.repeat(3);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta: lunga }) }] },
      { text: 'Ecco.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trovami la bolletta');
    const file = page.locator('.dash-file-btn');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await page.screenshot({ path: 'tests/.shots/v1499-etichetta-lunga-chiaro.png' });
    const misure = await file.locator('.dash-file-btn-nome').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 10_000 });
    await page.screenshot({ path: 'tests/.shots/v1499-etichetta-lunga-scuro.png' });
    expect(misure.sw, 'il nome vero non è tagliato').toBeLessThanOrEqual(misure.cw + 1);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una cartella assoluta fuori dalla casa dietro i caporali chiede prima di leggere', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'password', cartella: '«/etc' }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'cerca la password');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(1);
    const esito = testoDeiMessaggi((await chiamateAlModello(app))[1]);
    expect(esito).not.toMatch(/\/etc\/[a-z]/);
    await page.screenshot({ path: 'tests/.shots/v1499-etc.png' });
  } finally {
    await ripristina(app);
  }
});
