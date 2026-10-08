// #947 giro 5: il bottone del file si aggiunge a quello che la risposta NOMINA; una parola comune della risposta
// («ricevuta», «bolletta») non deve far comparire il bottone di un altro documento che si chiama così.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaDellaProva } from '../../helpers/documentiFinti.mjs';

test('r1 la risposta che parla della ricevuta dell\'assicurazione mostra solo il file scelto, non ricevuta.pdf', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Giro5');
  cartellaDellaProva(dir);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'ricevuta assicurazione' }) }] },
      { text: 'Ecco la ricevuta dell\'assicurazione: è xyz123.pdf, la quietanza della polizza RC auto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'è la ricevuta dell\'assicurazione?');
    const file = page.locator('.dash-bubble-actions .dash-file-btn');
    await expect(file.first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const nomi = await file.locator('.dash-file-btn-nome').allTextContents();
    await page.screenshot({ path: 'tests/.shots/giro5-r1.png' });
    expect(nomi).toEqual(['xyz123.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
