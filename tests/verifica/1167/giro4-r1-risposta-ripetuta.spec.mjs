// #1167, giro 4, rilievo 1: il modello ripete nel giro dopo il bottone la risposta già scritta col bottone.
// La bolla deve dire la cifra una volta sola, in diretta e a turno finito.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';

async function bollettaTari(app) {
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tasse');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'tari-2026.pdf');
  writeFileSync(file, '%PDF-1.4');
  return { dir, file };
}
const apriFile = (file, id = 'f1') => ({ id, name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file }) });

test('r1 il modello ripete la risposta nel giro dopo il bottone: la bolla la dice una volta sola', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: `${RISPOSTA} Ti ho messo il bottone per aprirlo.` },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    const testo = await bolla.evaluate((el) => el.textContent);
    expect(testo).toContain('Ti ho messo il bottone');
    expect(testo.split('305,40').length - 1).toBe(1);
    const chat = await app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0]));
    expect(chat.messages[1].text.split('305,40').length - 1).toBe(1);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
