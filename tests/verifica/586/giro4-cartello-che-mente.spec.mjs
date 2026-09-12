// Verifica #586, giro 4 — il cartello «può vedere il tuo schermo e sentire
// l'audio del computer» acceso per una ripresa che non è mai partita.
//
// La strada vecchia della cattura schermo non passa dalla scelta della fonte:
// Filo, un attimo e mezzo dopo il «Consenti», accende da solo il cartello che
// dice che il sito può vedere lo schermo e sentire l'audio del computer. Il
// cartello parte anche quando la cattura FALLISCE: il sito non ha ottenuto
// niente e Filo dice di sì. E non se ne va più — solo «Interrompi», che
// ricarica la pagina, o l'uscita dal sito.
//
// Perché conta fuori dai test: su Mac la ripresa dello schermo vuole anche il
// permesso di sistema, e finché non c'è la cattura fallisce esattamente così.
// Un cartello che grida al lupo e non si spegne è peggio di nessun cartello:
// la volta che è vero non ci crede più nessuno.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px"><p>pagina</p>
<script>
  // Cattura schermo alla vecchia maniera con una fonte che non esiste: il
  // permesso passa, la ripresa no.
  window.__fallisce = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:99999:0' } },
  }).then((s) => 'ottenuto: ' + s.getTracks().map((t) => t.label),
    (e) => 'fallita: ' + ((e && e.name) || 'errore'));
</script></body></html>`;

test('il cartello della ripresa non deve accendersi per una ripresa mai partita', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const esito = page.evaluate(() => window.__fallisce());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();

  const r = await Promise.race([esito, new Promise((x) => setTimeout(() => x('(in attesa)'), 15_000))]);
  console.log('[586 g4] la cattura:', JSON.stringify(r));
  expect(String(r), 'per questa prova la cattura deve fallire').toContain('fallita');

  // Passato l'attimo e mezzo con cui Filo decide che la strada era quella
  // vecchia, il cartello si accende.
  await shell.waitForTimeout(3000);
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g4] cartelli accesi:', JSON.stringify(cartelli));
  if (cartelli.length) await shell.screenshot({ path: 'tests/.shots/586-giro4-cartello-che-mente.png' });

  expect(cartelli.length, 'per questa prova il cartello si deve accendere').toBe(1);

  // Filo non può sapere se la cattura sia partita: la strada vecchia non passa
  // da nessun gestore. Quindi il cartello resta acceso, prudente, ma si deve
  // poter chiudere senza perdere la pagina. Prima l'unica via era «Interrompi»,
  // che ricarica.
  await page.evaluate(() => { window.__segno = 'sono la stessa pagina'; });
  const via = shell.locator('.perm-live .perm-chip-x');
  expect(
    await via.count(),
    'il cartello che Filo accende tirando a indovinare deve avere una × che lo chiude: '
    + 'senza, un avviso falso resta lì finché non si ricarica la pagina',
  ).toBe(1);
  await via.click();
  await expect(shell.locator('.perm-live')).toHaveCount(0, { timeout: 10_000 });

  await shell.waitForTimeout(1500);
  expect(
    await page.evaluate(() => window.__segno),
    'chiudere l\'avviso non deve toccare la pagina: chi lo chiude non deve perdere quello '
    + 'che stava facendo',
  ).toBe('sono la stessa pagina');
});
