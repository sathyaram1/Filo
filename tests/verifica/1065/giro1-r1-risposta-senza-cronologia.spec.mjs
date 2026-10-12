// #1065 giro 1, rilievo 1: se il disco rifiuta la riga della Cronologia AI, la risposta del modello arriva lo stesso.
// Prima della cronologia in file propri un errore di scrittura restava nel log del salvataggio e la chat rispondeva.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Il museo apre alle nove e chiude alle diciotto.';

test('r1 con la cronologia che non si può scrivere la chat mostra comunque la risposta del modello', async ({ app }) => {
  test.setTimeout(60_000);
  const dati = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(() => globalThis.SN_HISTORY.prepara());
  // Il file del mese corrente non si può aprire in scrittura (disco pieno, file bloccato): qui è una cartella.
  const mese = new Date().toISOString().slice(0, 7);
  const file = join(dati, 'cronologia-ai', mese + '.jsonl');
  rmSync(file, { force: true, recursive: true });
  mkdirSync(file, { recursive: true });
  try {
    await modelloFinto(app, [{ text: RISPOSTA }]);
    const page = await home(app);
    await chiedi(page, 'A che ora apre il museo?');
    await expect(page.getByText(RISPOSTA)).toBeVisible({ timeout: 20_000 });
  } finally {
    await ripristina(app);
  }
});
