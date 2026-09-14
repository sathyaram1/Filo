// Verifica #586, giro 9 — la scelta di COSA si condivide, saltata.
//
// Il feedback chiede che la condivisione dello schermo passi da una scelta, e
// Filo ha aggiunto il riquadro «cosa condividi»: tutto lo schermo o una finestra
// sola, e l'audio del computer come spunta a parte che parte spenta.
//
// Per chi usa Filo: quel riquadro compare solo quando il sito chiede lo schermo
// per la strada moderna. Per la strada vecchia — che Chromium tiene ancora
// aperta, che non ha bisogno di nessun clic per partire e che ogni sito può
// scrivere in una riga — la domanda è la STESSA parola per parola, ma dopo il
// «Consenti» non compare niente da scegliere: parte lo schermo intero, e l'audio
// del computer insieme se il sito l'ha chiesto. Chi risponde non ha modo di
// sapere a quale delle due sta rispondendo.
//
// Quello che deve succedere: se Filo fa scegliere cosa condividere, deve farlo
// scegliere sempre. Altrimenti la scelta esiste solo per i siti che chiedono con
// le buone.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<button id="moderno">Condividi lo schermo</button>
<script>
  const piatto = (s) => s.getTracks().map((t) => t.kind + ':' + (t.label || '?')
    + ':' + (t.getSettings ? (t.getSettings().width || 0) + 'x' + (t.getSettings().height || 0) : ''));
  window.__moderno = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => { window.__ultimo = s; return piatto(s); },
    (e) => ['rifiutato:' + ((e && e.name) || '?')]);
  // La strada vecchia: nessun gesto dell'utente serve.
  window.__vecchia = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(
    (s) => { window.__ultimo = s; return piatto(s); },
    (e) => ['rifiutato:' + ((e && e.name) || '?')]);
</script></body></html>`;

test('la strada vecchia dello schermo non deve saltare la scelta di cosa condividere', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  // 1 — La strada MODERNA, per avere il metro di paragone: domanda, poi il
  //     riquadro con le cose fra cui scegliere e la spunta dell'audio.
  const mod = page.evaluate(() => window.__moderno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  const domandaModerna = ((await shell.locator('.perm-chip').first().textContent()) || '')
    .replace(/\s+/g, ' ').trim();
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  const riquadroModerno = await shell.locator('.perm-source').first()
    .waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
  console.log('[586 g9] strada moderna — domanda:', JSON.stringify(domandaModerna),
    'riquadro della scelta:', riquadroModerno);
  if (riquadroModerno) {
    console.log('[586 g9] cose fra cui scegliere:',
      JSON.stringify(await shell.locator('.perm-source-item').allTextContents()),
      'spunta audio:', await shell.locator('.perm-source-audio').count());
    await shell.locator('.perm-source-cancel').first().click();
  }
  console.log('[586 g9] esito moderno (annullato):', JSON.stringify(await mod));
  await shell.waitForTimeout(600);

  // 2 — La strada VECCHIA, dalla stessa pagina e senza nessun clic.
  const vec = page.evaluate(() => window.__vecchia());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  const domandaVecchia = ((await shell.locator('.perm-chip').first().textContent()) || '')
    .replace(/\s+/g, ' ').trim();
  await shell.locator('.perm-chip .perm-chip-allow').first().click();

  const riquadroVecchio = await shell.locator('.perm-source').first()
    .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
  const esitoVecchio = await vec;
  await shell.waitForTimeout(2500);
  const segno = (await shell.locator('.perm-live').allTextContents()).join(' | ');
  console.log('[586 g9] strada vecchia — domanda:', JSON.stringify(domandaVecchia),
    'riquadro della scelta:', riquadroVecchio);
  console.log('[586 g9] quello che è arrivato al sito:', JSON.stringify(esitoVecchio));
  console.log('[586 g9] il segno che resta:', JSON.stringify(segno));

  expect(
    domandaVecchia.replace(/^[^ ]+ /, ''),
    'le due strade fanno la stessa domanda, parola per parola: chi risponde non può sapere se '
    + 'dopo il «Consenti» gli verrà chiesto cosa condividere o se lo schermo intero parte subito',
  ).toBe(domandaModerna.replace(/^[^ ]+ /, ''));

  expect(
    riquadroVecchio,
    'dalla strada vecchia, dopo il «Consenti», non compare niente da scegliere: al sito è andato '
    + `${JSON.stringify(esitoVecchio)}, cioè lo schermo intero (e l'audio del computer se l'ha `
    + 'chiesto), senza che chi ha risposto abbia potuto scegliere una finestra sola né rifiutare '
    + 'il suono. La scelta che Filo ha aggiunto vale solo per i siti che chiedono con le buone, e '
    + 'basta una riga per saltarla',
  ).toBe(true);
});
