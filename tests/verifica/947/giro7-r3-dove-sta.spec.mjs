// Verifica #947 giro 7. r3: il bottone del file trovato dice dove sta con le ultime due cartelle del percorso così
// come sono sul disco: per un file appena scaricato esce il nome dell'account e «Downloads», non «Download» come la
// chiamano Filo in Preferenze e il sistema in italiano.

import { test, expect } from '../../fixtures/electron.mjs';
import { join, basename, dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO } from '../../helpers/documentiFinti.mjs';

const RICHIESTA = 'Mi serve la bolletta della luce di marzo. Dov\'è?';

test('r3 il file appena scaricato, in cima ai Download: il bottone dice «Download», non la cartella dell\'account', async ({ app }) => {
  test.setTimeout(90_000);
  const scaricati = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  cartellaDellaProva(scaricati);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: RICHIESTA }) }] },
      { text: `È ${BOLLETTA_MARZO}, nei Download: è la bolletta dell'energia elettrica di marzo.` },
    ]);
    const page = await home(app);
    await chiedi(page, RICHIESTA);
    const dove = page.locator('.dash-bubble-actions .dash-file-btn .dash-file-btn-dove');
    await expect(dove).toHaveCount(1, { timeout: 20_000 });
    await page.screenshot({ path: 'tests/.shots/verifica-947-g7-dove.png' });
    const testo = await dove.textContent();
    expect(testo, `il bottone dice «${testo}»`).not.toContain(basename(dirname(scaricati)));
    expect(testo).toBe('Download');
  } finally {
    await ripristina(app);
    rmSync(join(scaricati, BOLLETTA_MARZO), { force: true });
  }
});
