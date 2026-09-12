// Verifica #586, giro 5 — la scheda che muore con una riga, dall'altra porta.
//
// Il giro 4 aveva trovato che una pagina qualunque fa fuori la propria scheda
// chiedendo l'AUDIO del computer con la strada vecchia della cattura schermo
// senza chiedere anche l'immagine. La correzione ha messo una guardia, e quella
// forma adesso torna un errore che il sito può gestire.
//
// La stessa causa ha una seconda porta, che la guardia non copre: chiedere
// l'IMMAGINE dello schermo alla vecchia maniera insieme a un MICROFONO normale.
// È la combinazione che fanno i siti di videochiamata vecchi quando condividono
// lo schermo e la voce insieme, ed è una riga sola.
//
// Per chi usa Filo: stai leggendo una pagina, il sito prova a condividere
// schermo e microfono nello stesso momento, e la scheda muore all'istante. Al
// suo posto compare la pagina di errore di Filo. Quello che avevi aperto lì è
// perso, senza un avviso e senza aver toccato niente.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p id="p">una pagina che stavi leggendo</p>
<script>
  window.__go = (v) => navigator.mediaDevices.getUserMedia(v)
    .then((s) => ({ ok: true, tracce: s.getTracks().map((t) => t.kind) }),
          (e) => ({ ok: false, errore: (e && e.name) || 'errore' }));
</script></body></html>`;

const DESKTOP = { mandatory: { chromeMediaSource: 'desktop' } };

test('chiedere lo schermo alla vecchia maniera insieme al microfono non deve ammazzare la scheda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const urlPrima = await page.evaluate(() => location.href);

  // Una riga sola, dal riquadro principale, senza nessun gesto dell'utente.
  page.evaluate((v) => window.__go(v), { video: DESKTOP, audio: true }).catch(() => {});
  await shell.waitForTimeout(6000);

  let viva = null;
  try { viva = await page.evaluate(() => location.href); } catch (e) { viva = null; }
  console.log('[586 g5] la scheda dopo la richiesta:', viva === null ? 'MORTA' : viva);
  console.log('[586 g5] domande comparse:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));

  expect(
    viva,
    'la scheda è morta: una pagina qualunque, con una riga e senza nessun clic, fa sparire '
    + 'quello che chi naviga aveva aperto lì. La guardia messa nel giro 4 copre solo la forma '
    + 'gemella (audio del computer senza immagine): questa, che è quella dei siti di '
    + 'videochiamata vecchi, passa',
  ).toBe(urlPrima);
});

test('la forma gemella, chiusa nel giro 4, resta chiusa', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const urlPrima = await page.evaluate(() => location.href);
  const esito = await page.evaluate((v) => window.__go(v), { audio: DESKTOP }).catch(() => 'MORTA');
  console.log('[586 g5] audio del computer da solo:', JSON.stringify(esito));
  let viva = null;
  try { viva = await page.evaluate(() => location.href); } catch (_) { viva = null; }
  expect(viva, 'regressione del giro 4: la scheda non deve morire').toBe(urlPrima);
});
