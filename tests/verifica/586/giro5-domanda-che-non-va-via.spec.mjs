// Verifica #586, giro 5 — la domanda che un sito può tenere accesa per sempre,
// e la posizione che dopo il sì non arriva mai.
//
// A) La × della pastiglia chiude senza ricordare: giusto, chi l'ha premuta non
//    ha deciso niente. Ma il sito può richiedere subito, e la pastiglia torna.
//    Un sito che richiede ogni decimo di secondo tiene la domanda incollata
//    sotto le schede: spinge giù la pagina, non si può togliere, e l'unico modo
//    di liberarsene è andarsene dal sito. Gli altri browser, dopo qualche
//    rifiuto, smettono di far comparire la domanda su quel sito.
//
// B) Dopo il «Consenti» a «vuole sapere dove sei», al sito non arriva nessuna
//    coordinata: arriva un errore di rete. Era la cosa che il giro 4 non era
//    riuscito a stabilire. Qui si prova che la rete della pagina funziona, così
//    resta solo la posizione a non funzionare.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML_NAG = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito insistente</p>
<script>
  window.__tentativi = 0;
  window.__insisti = () => {
    window.__tentativi++;
    return navigator.mediaDevices.getUserMedia({ video: true })
      .then(() => 'ok', () => { setTimeout(window.__insisti, 100); return 'no'; });
  };
</script></body></html>`;

const HTML_POS = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito che ti vuole trovare sulla mappa</p>
<script>
  window.__pos = () => new Promise((r) => navigator.geolocation.getCurrentPosition(
    (p) => r('coordinate ' + p.coords.latitude), (e) => r('errore ' + e.code + ': ' + e.message),
    { timeout: 25000 }));
  window.__rete = () => fetch(location.href).then((r) => 'ok ' + r.status, (e) => 'no ' + e.message);
</script></body></html>`;

test('un sito non deve poter tenere la domanda incollata sotto le schede', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML_NAG);
  page.evaluate(() => window.__insisti()).catch(() => {});

  // Chi naviga chiude la domanda quattro volte di fila.
  const presenti = [];
  for (let i = 0; i < 4; i++) {
    await shell.waitForTimeout(1500);
    const n = await shell.locator('.perm-chip').count();
    presenti.push(n);
    const x = shell.locator('.perm-chip .perm-chip-x');
    if (await x.count()) await x.first().click();
  }
  await shell.waitForTimeout(1500);
  const restano = await shell.locator('.perm-chip').count();
  console.log('[586 g5] pastiglie a ogni giro:', JSON.stringify(presenti), '→ dopo quattro ×:', restano);
  console.log('[586 g5] tentativi del sito:', await page.evaluate(() => window.__tentativi));
  if (restano) await shell.screenshot({ path: 'tests/.shots/586-giro5-domanda-che-non-va-via.png' });

  expect(
    restano,
    'dopo quattro «no» di fila il sito richiede ancora e la domanda torna: chi naviga non ha '
    + 'nessun modo di dire «smettila», e la pastiglia continua a spingere giù la pagina',
  ).toBe(0);
});

// La posizione, dopo il «Consenti», non arriva: il motore su cui Filo è
// costruito la chiede a un servizio di rete che nelle versioni pubbliche del
// motore non è raggiungibile, e non c'è nessuna chiave da nessuna parte nel
// progetto. Non è una cosa che Filo possa aggiustare da sé: servirebbe pagare
// un servizio, e quella è una scelta dell'owner, scritta nel report.
//
// Quello che Filo può fare, e che questa prova pretende, è non far finta: chi
// ha appena risposto «Consenti» deve sentirsi dire che la posizione non
// arriverà, invece di vedere una mappa rotta e dare la colpa al sito.
test('quando la posizione non arriva, Filo lo dice a chi naviga', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML_POS);
  const p = page.evaluate(() => window.__pos());
  await shell.waitForTimeout(2000);
  const consenti = shell.locator('.perm-chip .perm-chip-allow');
  expect(await consenti.count(), 'la domanda della posizione deve comparire').toBe(1);
  await consenti.first().click();

  const esito = await Promise.race([p, new Promise((r) => setTimeout(() => r('(nessuna risposta in 30s)'), 30_000))]);
  const rete = await page.evaluate(() => window.__rete());
  console.log('[586 g5] posizione dopo il Consenti:', esito, '| rete della pagina:', rete);

  const avvisi = shell.locator('.perm-live[data-notizia]');
  await expect(avvisi).toHaveCount(1, { timeout: 20_000 });
  const riga = await avvisi.first().textContent();
  console.log('[586 g5] avviso mostrato:', JSON.stringify(riga));
  if (!String(esito).includes('coordinate')) {
    await shell.screenshot({ path: 'tests/.shots/586-giro5-posizione-che-non-arriva.png' });
  }
  expect(
    riga,
    'la posizione non è arrivata e nessuno lo ha detto: chi ha appena risposto «Consenti» '
    + 'resta con una mappa rotta e dà la colpa al sito',
  ).toContain('non riesce a sapere dove sei');
});
