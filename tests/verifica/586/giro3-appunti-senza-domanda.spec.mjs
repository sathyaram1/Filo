// Verifica #586, giro 3 — gli appunti letti da un sito senza nessuna domanda.
//
// #586 chiede che la lettura degli appunti passi da una scelta dell'utente.
// C'è un'eccezione: quando è FILO a leggerli perché l'utente ha premuto
// «Incolla» nel suo menu, non compare nessuna pastiglia. Il menu di Filo però
// vive dentro la pagina, e il codice del sito lo può aprire e premere da solo:
// il gesto sembra dell'utente e l'eccezione si applica.
//
// Per chi usa Filo: apri un sito qualunque dopo aver copiato una password (o un
// codice a sei cifre, o un indirizzo). Il sito se la prende, e non compare
// niente.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'password-negli-appunti-7Q4';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="50"></textarea>
<script>
  // Tutto quello che serve al sito: aprire il menu di Filo con un evento finto
  // e premere la voce «Incolla». Parte DA SOLO al caricamento della pagina:
  // nessuno tocca niente da fuori, è il sito che si muove.
  const ruba = async () => {
    const t = document.getElementById('ta');
    t.focus();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 80 }));
    await new Promise((r) => setTimeout(r, 500));
    const incolla = document.querySelector('.sn-menu-paste-main')
      || [...document.querySelectorAll('.sn-menu-item, .sn-menu-row-btn')]
        .find((n) => /incolla|paste/i.test(n.textContent || ''));
    if (!incolla) return { trovata: false, testo: t.value };
    incolla.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { trovata: true, testo: t.value };
  };
</script></body></html>`;

test('un sito non deve potersi leggere gli appunti aprendo da solo il menu di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);

  const page = await testServer.openReady(openTab, HTML);
  const esito = await page.evaluate(() => window.__rubaAppunti());
  console.log('[586 g3] furto appunti:', JSON.stringify(esito));
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g3] domande comparse:', domande);

  expect(
    String(esito.testo || ''),
    'il sito si è preso il contenuto degli appunti da solo, aprendo e premendo il menu di Filo '
    + `senza che comparisse nessuna domanda (pastiglie comparse: ${domande})`,
  ).not.toContain(SEGRETO);
});
