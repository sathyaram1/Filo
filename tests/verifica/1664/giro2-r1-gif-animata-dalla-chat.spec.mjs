// Verifica #1664 giro 2, rilievo 1: una GIF animata oltre i 4 MB data alla chat della home come riga «File:» parte
// ferma, del solo primo fotogramma: il riquadro di conferma deve dirlo, come lo dice la casella «Invia feedback».

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const TETTO = 4 * 1024 * 1024;

function gifAnimataGrande() {
  const fotogramma = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  const blocchi = Math.ceil((TETTO + 64 * 1024) / 255);
  const commento = Buffer.alloc(2 + blocchi * 256 + 1, 0x41);
  commento[0] = 0x21; commento[1] = 0xfe;
  for (let k = 0; k < blocchi; k++) commento[2 + k * 256] = 255;
  commento[commento.length - 1] = 0;
  return Buffer.concat([
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff]),
    commento, Buffer.from(fotogramma), Buffer.from(fotogramma), Buffer.from([0x3b]),
  ]);
}

test('r1 la conferma della chat dice che una GIF animata oltre i 4 MB parte ferma', async ({ app }) => {
  test.setTimeout(90_000);
  const gif = join(cartellaTemporanea('filo-1664-gif-'), 'difetto.gif');
  writeFileSync(gif, gifAnimataGrande());

  const page = await home(app);
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__submitVero = FB.submit;
    FB.submit = async () => ({ id: 'fb-1' });
  });
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Menu rotto', testo: 'Il menu sfarfalla.', allegati: [gif] }) }] },
    { text: 'Inviata.' },
  ]);
  await chiedi(page, `manda questa registrazione con la segnalazione\nFile: ${gif}`);

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.[0]?.immagine, { timeout: 20_000 }).toBe(true);
  const s = await confirmState(page);
  await page.screenshot({ path: 'tests/.shots/verifica-1664-g2-gif-chat.png' });
  expect(`${s.text}\n${s.notaAllegati || ''}`, 'chi manda sa che l’animazione non parte').toMatch(/ferma/);

  await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
  await ripristina(app);
});
