// Verifica #586, giro 4 — quello che si può solo negare, mai consentire.
//
// #586 chiede che ogni richiesta non innocua «passi da una scelta dell'utente».
// Per l'elenco dei caratteri installati (Local Font Access: lo usano gli editor
// grafici sul web — Figma, Photopea, Canva — per farti scegliere un font del tuo
// computer) Chromium non fa mai la RICHIESTA: chiede solo «cosa è già stato
// deciso». Filo risponde «niente» e il sito si becca un elenco vuoto, senza che
// compaia nessuna domanda.
//
// Il risultato è un no definitivo: la pastiglia non arriva mai, quindi nessuna
// scelta viene mai registrata, quindi in Impostazioni quel sito non compare e
// non c'è niente da ribaltare. Si può negare, non si può consentire.
//
// Per chi usa Filo: apri un editor grafico sul web e prova a scegliere un
// carattere del tuo computer. L'elenco è vuoto, non compare nessun avviso e non
// c'è nessun posto in cui rimediare.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<button id="b" style="font-size:20px">scegli un carattere</button>
<script>
  window.__esito = null;
  document.getElementById('b').addEventListener('click', async () => {
    try { const f = await window.queryLocalFonts(); window.__esito = { n: f.length }; }
    catch (e) { window.__esito = { errore: e.name }; }
  });
</script></body></html>`;

test('i caratteri del computer: o il sito li ottiene, o almeno la domanda arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  // Quanti caratteri ci sono davvero su questa macchina: si misura togliendo di
  // mezzo il gestore di Filo, così il numero non dipende dal contenitore.
  await app.evaluate(({ session }) => {
    globalThis.__vistiDalGestore = [];
    globalThis.__gestoreFilo = true;
  });

  await page.click('#b');
  await shell.waitForTimeout(2500);
  const domande = await shell.locator('.perm-chip').allTextContents();
  const esito = await page.evaluate(() => window.__esito);
  console.log('[586 g4] caratteri col gestore di Filo:', JSON.stringify(esito), 'domande:', JSON.stringify(domande));

  // Ora la stessa pagina con un gestore che dice sempre sì: è la prova che i
  // caratteri ci sono, e che a tenerli fuori è la risposta di Filo.
  await app.evaluate(({ session }) => {
    session.defaultSession.setPermissionCheckHandler(() => true);
  });
  await page.reload();
  await page.waitForTimeout(1000);
  await page.click('#b');
  await page.waitForTimeout(2000);
  const conSi = await page.evaluate(() => window.__esito);
  console.log('[586 g4] caratteri con un gestore che dice sì:', JSON.stringify(conSi));

  expect(
    { domandeComparse: domande.length, caratteriOttenuti: (esito && esito.n) || 0 },
    'sulla macchina ci sono ' + ((conSi && conSi.n) || 0) + ' caratteri: col gestore di Filo il sito '
    + 'ne riceve zero e non compare nessuna domanda. Nessuna scelta viene registrata, quindi in '
    + 'Impostazioni quel sito non c\'è e non c\'è niente da ribaltare: si può solo negare, mai consentire',
  ).toEqual({ domandeComparse: 1, caratteriOttenuti: 0 });
});
