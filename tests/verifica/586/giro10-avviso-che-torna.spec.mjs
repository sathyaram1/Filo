// Verifica #586, giro 10 — la riga «ho smesso di chiedere» e la sua ×.
//
// Dal giro 5 un sito non può più tenere la domanda incollata sotto le schede:
// dopo tre domande chiuse senza rispondere Filo smette di chiedere per quel sito
// su quella pagina, e lo dice con una riga che porta «Chiedimelo di nuovo». La
// riga ha anche una ×, che promette di toglierla di mezzo.
//
// Qui si guarda se quella promessa vale con un sito che continua a chiedere.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<p style="font:14px system-ui">Una pagina qualunque</p>
<script>
  window.__quante = 0;
  let acceso = false;
  const giro = () => {
    if (!acceso) return;
    window.__quante++;
    navigator.mediaDevices.getUserMedia({ video: true }).then(() => {}, () => {});
    setTimeout(giro, 300);
  };
  window.__insisti = () => { acceso = true; giro(); };
  window.__basta = () => { acceso = false; };
</script></body></html>`;

test('la × della riga «ho smesso di chiedere» deve toglierla di mezzo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => window.__insisti());

  // Tre domande chiuse con la × — quello che fa chiunque con una domanda che non
  // ha chiesto.
  for (let i = 0; i < 3; i++) {
    await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
    await shell.locator('.perm-chip .perm-chip-x').first().click();
    await shell.waitForTimeout(400);
  }

  const avviso = shell.locator('.perm-live[data-notizia]');
  await expect(avviso).toHaveCount(1, { timeout: 20_000 });
  console.log('[586 g10] la riga dice:',
    JSON.stringify(((await avviso.first().textContent()) || '').replace(/\s+/g, ' ').trim()));

  // La ×, che promette di togliere la riga.
  await avviso.first().locator('.perm-chip-x').click();
  await shell.waitForTimeout(2500);
  const tornata = await shell.locator('.perm-live[data-notizia]').count();
  console.log('[586 g10] dopo la ×, righe rimaste:', tornata,
    '— richieste fatte dal sito:', await page.evaluate(() => window.__quante));

  expect(
    tornata,
    'premuta la × la riga torna da sola, perché il sito continua a chiedere e ogni richiesta la '
    + 'riaccende: finché si resta su quel sito non c\'è modo di togliersela di mezzo, e intanto tiene '
    + 'giù la pagina. È il rilievo del giro 5 (il sito che teneva la domanda incollata sotto le '
    + 'schede) spostato sull\'avviso che lo doveva chiudere',
  ).toBe(0);
});
