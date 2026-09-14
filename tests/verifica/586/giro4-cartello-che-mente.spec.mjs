// Verifica #586, giro 4 — il cartello «può vedere il tuo schermo e sentire
// l'audio del computer» acceso per una ripresa che non è mai partita.
//
// COM'ERA. La strada vecchia della cattura schermo non passava dalla scelta
// della fonte: Filo, un attimo e mezzo dopo il «Consenti», accendeva da solo il
// cartello che dice che il sito può vedere lo schermo e sentire l'audio del
// computer. Il cartello partiva anche quando la cattura FALLIVA: il sito non
// aveva ottenuto niente e Filo diceva di sì. E non se ne andava più — solo
// «Interrompi», che ricarica la pagina, o l'uscita dal sito.
//
// COM'È DAL GIRO 9. La strada vecchia non salta più niente: prima di partire
// diventa quella moderna, quindi passa dalla domanda E dal riquadro «cosa
// condividi». Filo non tira più a indovinare, e la fonte che non esiste sparisce
// con i vincoli vecchi. La garanzia che questa prova difende resta la stessa e
// si controlla dal punto in cui oggi può ancora rompersi: chi annulla la scelta
// non deve ritrovarsi acceso un cartello che dice che il sito vede il suo
// schermo, e chi lo vede non deve perdere la pagina per toglierlo.
//
// Perché conta fuori dai test: su Mac la ripresa dello schermo vuole anche il
// permesso di sistema, e finché non c'è la cattura fallisce. Un cartello che
// grida al lupo e non si spegne è peggio di nessun cartello: la volta che è
// vero non ci crede più nessuno.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px"><p>pagina</p>
<script>
  // Cattura schermo alla vecchia maniera, con in più una fonte che non esiste.
  window.__fallisce = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:99999:0' } },
  }).then((s) => 'ottenuto: ' + s.getTracks().map((t) => t.label),
    (e) => 'fallita: ' + ((e && e.name) || 'errore'));
</script></body></html>`;

test('nessun cartello resta acceso per una ripresa che non è mai partita', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => { window.__segno = 'sono la stessa pagina'; });

  const esito = page.evaluate(() => window.__fallisce());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();

  // La strada vecchia adesso arriva qui: si sceglie cosa condividere. Chi ci
  // ripensa preme Annulla.
  const box = shell.locator('.perm-source');
  await expect(
    box,
    'anche la strada vecchia deve passare dalla scelta di cosa si condivide',
  ).toHaveCount(1, { timeout: 20_000 });
  await box.locator('.perm-source-cancel').click();

  const r = await Promise.race([esito, new Promise((x) => setTimeout(() => x('(in attesa)'), 15_000))]);
  console.log('[586 g4] la cattura dopo l\'annulla:', JSON.stringify(r));
  expect(String(r), 'annullata la scelta, al sito non deve arrivare niente').not.toContain('ottenuto');

  // Passato anche l'attimo e mezzo con cui Filo decideva che la strada era
  // quella vecchia, non deve restare acceso nessun cartello.
  await shell.waitForTimeout(3500);
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g4] cartelli accesi:', JSON.stringify(cartelli));
  if (cartelli.length) await shell.screenshot({ path: 'tests/.shots/586-giro4-cartello-che-mente.png' });
  expect(
    cartelli.join(' | '),
    'è rimasto acceso un cartello che dice che il sito può vedere lo schermo, per una ripresa che '
    + 'non è mai partita: la volta che è vero non ci crede più nessuno',
  ).not.toMatch(/schermo/i);

  expect(
    await page.evaluate(() => window.__segno),
    'annullare la scelta non deve toccare la pagina: chi ci ripensa non deve perdere quello '
    + 'che stava facendo',
  ).toBe('sono la stessa pagina');
});
