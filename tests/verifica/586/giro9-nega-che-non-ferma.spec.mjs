// Verifica #586, giro 9 — la domanda dello schermo che un «Nega» non ferma.
//
// Per chi usa Filo: un sito chiede di vedere il tuo schermo. Tu premi «Nega».
// Lui richiede subito, e la domanda torna. Premi «Nega» di nuovo, e torna
// ancora. La scelta dello schermo per scelta non si ricorda (una ripresa dello
// schermo non lascia segni, quindi un «sempre» lì è pericoloso), ma proprio per
// questo un «Nega» non chiude niente: la via d'uscita che Filo si è dato — dopo
// tre domande CHIUSE senza rispondere smetto di chiedere — non scatta mai,
// perché chi risponde «Nega» ha risposto.
//
// E la richiesta non ha bisogno di nessun clic: la strada vecchia della cattura
// dello schermo (getUserMedia con chromeMediaSource «desktop») parte da sola.
//
// Quello che deve succedere: rispondere «Nega» tre volte di fila deve portare a
// qualcosa — la domanda che smette, o una riga che dice come farla smettere. Non
// a una domanda che torna all'infinito mentre la pagina resta lì.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<p>prova</p>
<script>
  window.__esiti = [];
  // La strada vecchia: nessun gesto dell'utente serve.
  window.__chiediSchermo = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(
    (s) => { window.__esiti.push('ok'); s.getTracks().forEach((t) => t.stop()); return 'ok'; },
    (e) => { window.__esiti.push('no:' + ((e && e.name) || '?')); return 'no'; },
  );
</script></body></html>`;

test('rispondere «Nega» allo schermo deve portare a qualcosa: la domanda non può tornare all\'infinito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  const negati = [];
  for (let giro = 1; giro <= 4; giro++) {
    const esito = page.evaluate(() => window.__chiediSchermo());
    const comparsa = await shell.locator('.perm-chip').first()
      .waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false);
    if (!comparsa) { negati.push(`giro ${giro}: nessuna domanda`); await esito.catch(() => {}); break; }
    const testo = (await shell.locator('.perm-chip').first().textContent()) || '';
    negati.push(`giro ${giro}: ${testo.replace(/\s+/g, ' ').trim()}`);
    await shell.locator('.perm-chip .perm-chip-btn', { hasText: 'Nega' }).first().click();
    await esito.catch(() => {});
    await shell.waitForTimeout(300);
  }

  const avvisi = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g9] domande comparse una dopo l\'altra:', JSON.stringify(negati));
  console.log('[586 g9] righe che spiegano come farla smettere:', JSON.stringify(avvisi));

  // Il quarto giro è quello che conta: dopo tre «Nega» il sito non deve poter
  // rimettere in mezzo la stessa domanda senza che Filo offra una via d'uscita.
  const quarta = negati[3] || '';
  const viaDUscita = avvisi.join(' | ');
  expect(
    quarta.includes('nessuna domanda') || /smesso di chiedere/i.test(viaDUscita),
    'dopo tre «Nega» di fila la domanda dello schermo torna ancora, e non compare nessuna riga '
    + 'che dica come farla smettere: chi ha detto no tre volte non ha nessuna via d\'uscita '
    + `tranne andarsene dal sito. Quello che è comparso al quarto giro: ${quarta}`,
  ).toBe(true);
});
