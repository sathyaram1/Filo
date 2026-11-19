// Verifica #1664 giro 1, rilievo 1: una foto del telefono (oltre 4 MB) lasciata nella chat della home entra come
// riga «File:» col suo percorso; chiesto a Filo di mandarla con la segnalazione, deve arrivare all'owner.
// Modello finto e deposito finto, come tests/feedback-allegati-chat.spec.mjs.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const TETTO = 4 * 1024 * 1024;
const byteDi = (u) => Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4);

test('r1 una foto da più di 4 MB data alla chat della home parte con la segnalazione', async ({ app }) => {
  test.setTimeout(120_000);
  // Un JPEG vero di rumore, come una foto: nativeImage nel main, così il file sul disco è quello di una fotocamera.
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 2600;
    const h = 2000;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(95).toString('base64');
  });
  const foto = join(cartellaTemporanea('filo-1664-'), 'IMG_2041.jpg');
  writeFileSync(foto, Buffer.from(b64, 'base64'));
  expect(Buffer.from(b64, 'base64').length, 'la foto di prova supera il tetto').toBeGreaterThan(TETTO);

  const page = await home(app);
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__submitVero = FB.submit;
    globalThis.__depositati = [];
    FB.submit = async (p) => { globalThis.__depositati.push(JSON.parse(JSON.stringify(p))); return { id: 'fb-1' }; };
  });
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Zoom rotto', testo: 'Lo zoom non si ingrandisce.', allegati: [foto] }) }] },
    { text: 'Inviata, con la tua foto.' },
  ]);
  await chiedi(page, `manda questa foto con la segnalazione\nFile: ${foto}`);

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(1);
  const s = await confirmState(page);
  console.log('riquadro:', JSON.stringify({ allegati: s.allegati, nota: s.notaAllegati }));
  await page.screenshot({ path: 'tests/.shots/verifica-1664-foto-grande-chat.png' });
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');

  await expect.poll(async () => (await app.evaluate(() => globalThis.__depositati || [])).length, { timeout: 15_000 }).toBe(1);
  const [p] = await app.evaluate(() => globalThis.__depositati);
  const partite = [...(p.images || []), ...(p.files || [])];
  expect(partite, 'la foto parte con la segnalazione').toHaveLength(1);
  expect(partite[0].dataUrl).toMatch(/^data:image\//);
  expect(byteDi(partite[0].dataUrl)).toBeLessThanOrEqual(TETTO);

  await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
  await ripristina(app);
});
