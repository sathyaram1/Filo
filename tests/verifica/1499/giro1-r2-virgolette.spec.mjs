// #1499, verifica giro 1: un percorso di questo computer fra virgolette, che il main apre, in chat non diventa il bottone del file.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('r2 un percorso fra virgolette o caporali diventa il bottone del file, come senza', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Vero');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'bolletta.pdf');
  writeFileSync(vero, '%PDF-1.4');
  try {
    await modelloFinto(app, [
      { toolCalls: [
        { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: `"${vero}"`, etichetta: 'Bolletta' }) },
        { id: 'f2', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: `«${vero}»`, etichetta: 'Bolletta' }) },
      ] },
      { text: 'Ecco.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trovami la bolletta');
    await expect(page.locator('.dash-file-btn .dash-file-btn-nome')).toHaveText(['bolletta.pdf', 'bolletta.pdf'], { timeout: 20_000 });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
