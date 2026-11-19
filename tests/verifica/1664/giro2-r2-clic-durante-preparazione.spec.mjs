// Verifica #1664 giro 2, rilievo 2: mentre la chat prepara le foto grandi la conferma non c'è ancora e il tasto
// dell'azione resta cliccabile; un clic lì in quel momento non deve far partire la segnalazione due volte.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r2 un clic sul tasto della segnalazione mentre le foto si preparano non la manda due volte', async ({ app }) => {
  test.setTimeout(180_000);
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 4000;
    const h = 3000;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 4 === 3) ? 255 : ((i * 7919) % 251);
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(95).toString('base64');
  });
  const dir = cartellaTemporanea('filo-1664-doppio-');
  const foto = [1, 2, 3].map((n) => join(dir, `IMG_${n}.jpg`));
  for (const f of foto) writeFileSync(f, Buffer.from(b64, 'base64'));

  const page = await home(app);
  await app.evaluate(() => {
    globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
    globalThis.__depositati = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__depositati.push(p.title || p.text || ''); return { id: `fb-${globalThis.__depositati.length}` }; };
  });
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Foto', testo: 'Ecco le foto.', allegati: foto }) }] },
    { text: 'Inviata.' },
    { text: 'Inviata.' },
  ]);
  await chiedi(page, `manda queste foto\n${foto.map((f) => `File: ${f}`).join('\n')}`);
  const chip = page.getByText('Inviare questo feedback agli sviluppatori di Filo a tuo nome', { exact: false }).last();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  // L'utente, non vedendo succedere niente, clicca il tasto dell'azione.
  await chip.click({ timeout: 3_000 }).catch(() => {});

  for (let giro = 0; giro < 2; giro++) {
    const c = await page.locator(CONFIRM_HOST).first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
    if (!c) break;
    await aspettaConfermaPronta(page);
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect.poll(async () => (await confirmState(page))?.pronto ?? false, { timeout: 5_000 }).not.toBe(true).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2000);
  const n = await app.evaluate(() => globalThis.__depositati.length);
  expect(n, 'una segnalazione sola').toBe(1);

  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
  await ripristina(app);
});
