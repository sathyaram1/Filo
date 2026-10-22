// #1499, verifica giro 1: con un'etichetta del modello lunga il nome vero del file sul bottone si riduce a poche lettere.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

for (const [quale, etichetta] of [
  ['di una riga', 'Bolletta della luce Enel di marzo 2026, periodo dal 01/03 al 31/03'],
  ['lunghissima', 'Bolletta della luce di marzo 2026 del fornitore di energia elettrica, quella giusta da pagare entro venerdì '.repeat(3)],
]) {
  test(`r1 etichetta ${quale}: il nome vero del file resta intero sul bottone`, async ({ app }) => {
    test.setTimeout(90_000);
    const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Vero');
    mkdirSync(dir, { recursive: true });
    const vero = join(dir, 'malevolo.pdf');
    writeFileSync(vero, '%PDF-1.4');
    try {
      await modelloFinto(app, [
        { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta }) }] },
        { text: 'Ecco.' },
      ]);
      const page = await home(app);
      await chiedi(page, 'trovami la bolletta');
      const nome = page.locator('.dash-file-btn .dash-file-btn-nome');
      await expect(nome).toHaveText('malevolo.pdf', { timeout: 20_000 });
      const m = await nome.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(m.sw, 'il nome vero non è tagliato').toBeLessThanOrEqual(m.cw + 1);
    } finally {
      await ripristina(app);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
