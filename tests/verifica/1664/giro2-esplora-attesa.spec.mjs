// Esplorazione, giro 2: quanto aspetta la conferma della chat con cinque foto grandi da preparare.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('attesa della conferma con cinque foto grandi', async ({ app }) => {
  test.setTimeout(180_000);
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 4000;
    const h = 3000;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 4 === 3) ? 255 : ((i * 7919) % 251);
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(95).toString('base64');
  });
  const dir = cartellaTemporanea('filo-1664-attesa-');
  const foto = [1, 2, 3, 4, 5].map((n) => join(dir, `IMG_${n}.jpg`));
  for (const f of foto) writeFileSync(f, Buffer.from(b64, 'base64'));
  console.log('byte per foto', Buffer.from(b64, 'base64').length);

  const page = await home(app);
  await app.evaluate(() => { globalThis.__submitVero = globalThis.SN_FEEDBACK.submit; globalThis.SN_FEEDBACK.submit = async () => ({ id: 'x' }); });
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Foto', testo: 'Ecco le foto.', allegati: foto }) }] },
    { text: 'Inviata.' },
  ]);
  const t0 = Date.now();
  await chiedi(page, `manda queste foto\n${foto.map((f) => `File: ${f}`).join('\n')}`);
  const tChiesto = Date.now();
  const voci = [];
  const giro = setInterval(async () => {
    try { voci.push([Date.now() - tChiesto, await page.evaluate(() => document.querySelector('#chat, main, body').innerText.slice(-200))]); } catch (_) {}
  }, 500);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 90_000 });
  const tVisto = Date.now();
  clearInterval(giro);
  await page.screenshot({ path: 'tests/.shots/verifica-1664-g2-attesa.png' });
  const s = await confirmState(page);
  console.log('chiedi', tChiesto - t0, 'ms; conferma dopo', tVisto - tChiesto, 'ms; allegati', JSON.stringify(s.allegati));
  for (const [t, testo] of voci.slice(0, 12)) console.log(t, JSON.stringify(testo));
  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
  await ripristina(app);
});
