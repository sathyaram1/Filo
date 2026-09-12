// Verifica #586, giro 6 — dopo tre domande chiuse con la ×, Filo smette di
// chiedere per quel sito.
//
// La regola nasce dal giro 5 (un sito teneva la domanda incollata sotto le
// schede) ed è giusta. Qui si guarda dove arriva il silenzio che porta con sé:
//
//  · vale per TUTTO il sito, non per la cosa che si era chiusa. Chi chiude tre
//    volte la domanda della fotocamera e poi preme «trovami» non ottiene niente
//    e non vede niente: nessuna domanda, nessuna riga che lo spieghi;
//  · non c'è nessun segno che Filo abbia smesso di chiedere, e nessuna strada
//    per tornare indietro che non sia indovinare «ricarica la pagina».
//
// Il sintomo per chi naviga: un gesto suo, appena fatto, non produce niente.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px"><p>pagina</p>
<script>
  window.__esiti = [];
  window.__fotocamera = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    () => 'ok', (e) => 'no:' + ((e && e.name) || 'errore'));
  window.__trovami = () => new Promise((res) => {
    navigator.geolocation.getCurrentPosition(
      () => res('ok'), (e) => res('no:' + ((e && e.code) || '?')), { timeout: 8000 });
  });
</script></body></html>`;

test('chiudere tre volte la domanda della fotocamera non deve zittire anche «trovami»', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  // Tre domande della fotocamera, chiuse con la × (chiudo, non decido).
  for (let i = 0; i < 3; i++) {
    const p = page.evaluate(() => window.__fotocamera());
    await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
    await shell.locator('.perm-chip .perm-chip-x').click();
    await p;
    await shell.waitForTimeout(300);
  }

  // Ora l'utente preme «trovami»: un gesto suo, su un'altra cosa.
  const trovami = page.evaluate(() => window.__trovami());
  await shell.waitForTimeout(2500);

  const domande = await shell.locator('.perm-chip').count();
  const avvisi = await shell.evaluate(() => ({
    live: document.querySelectorAll('.perm-live').length,
    note: document.querySelectorAll('.perm-notice').length,
  }));
  console.log('[586 g6] domande comparse dopo le tre chiusure:', domande, 'avvisi:', JSON.stringify(avvisi));
  await shell.screenshot({ path: 'tests/.shots/586-giro6-silenzio-dopo-tre-chiusure.png' });

  const esito = await trovami;
  console.log('[586 g6] esito di «trovami»:', esito);

  expect(
    domande + avvisi.note,
    'chiuse tre volte la domanda della FOTOCAMERA, il sito resta zitto su tutto: premendo '
    + '«trovami» non compare né la domanda della posizione né una riga che dica che Filo ha '
    + 'smesso di chiedere. Il gesto appena fatto non produce niente, e non c\'è nessuna strada '
    + 'per tornare indietro',
  ).toBeGreaterThan(0);
});

test('dopo tre chiusure, la stessa cosa richiesta con un gesto deve almeno dire che è successo qualcosa', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  for (let i = 0; i < 3; i++) {
    const p = page.evaluate(() => window.__fotocamera());
    await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
    await shell.locator('.perm-chip .perm-chip-x').click();
    await p;
    await shell.waitForTimeout(300);
  }

  const quarto = await page.evaluate(() => window.__fotocamera());
  await shell.waitForTimeout(1500);
  const visibile = await shell.evaluate(() => ({
    chip: document.querySelectorAll('.perm-chip').length,
    note: document.querySelectorAll('.perm-notice').length,
    live: document.querySelectorAll('.perm-live').length,
  }));
  console.log('[586 g6] quarta richiesta:', quarto, 'cosa si vede:', JSON.stringify(visibile));

  expect(
    visibile.chip + visibile.note,
    'alla quarta richiesta il sito si vede negare in silenzio e nella cornice non compare '
    + 'niente: chi ha chiuso le domande non sa che Filo ha smesso di chiedere, e se adesso '
    + 'volesse consentire non ha nessun posto dove farlo',
  ).toBeGreaterThan(0);
});
