// Verifica #586, giro 11 — la funzione presa in prestito da un riquadro.
//
// Il conto di quello che è stato consegnato lo tiene un pezzo di Filo che vive
// nel mondo della pagina, e per tenerlo SOSTITUISCE sullo stampo la funzione con
// cui il microfono si chiede: l'originale resta solo nella sua chiusura, «non
// più raggiungibile da nessuna parte in questa finestra» (è la chiusura del
// giro 7).
//
// «In questa finestra». Ogni riquadro incorporato è un'altra finestra, con i
// suoi stampi. Un riquadro creato senza indirizzo e preso per indice
// (`window[0]`, che non passa da nessuna proprietà e non aspetta nessun
// osservatore) porta una copia INTONSA di quella funzione. La pagina se la
// prende, butta via il riquadro e da lì in poi chiede il microfono con quella:
// le tracce non passano dal conto e Filo non sa che esistono.
//
// Per chi usa Filo: dai il microfono a un sito, poi vai in Impostazioni,
// Sicurezza, e toglighelo. L'elenco si svuota, il cartello sparisce, e il sito
// continua ad ascoltare.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:16px">
<h1>Videochiamata</h1>
<input id="campo" style="width:70%">
<script>
  window.__vivo = String(Date.now());
  window.__a = null; window.__b = null;
  const veroStato = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__stato = () => [window.__a, window.__b].map((t) => (t ? veroStato.call(t) : 'assente'));

  // La prima traccia per la via normale: così Filo vede che questa pagina passa
  // dal suo giro, e la rete «non hai mai visto passare niente» non scatta.
  window.__uno = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__a = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));

  // Il prestito: un riquadro nato senza indirizzo, preso per indice, la sua
  // copia intonsa della funzione, e il riquadro buttato via subito dopo. Da
  // quel momento in casa non resta nessun riquadro che non sappia rispondere.
  window.__presta = () => {
    try {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      document.body.appendChild(f);
      const w = window[0];
      if (!w || !w.MediaDevices) return 'niente riquadro';
      window.__intonsa = w.MediaDevices.prototype.getUserMedia;
      f.remove();
      return typeof window.__intonsa === 'function' ? 'preso' : 'non è una funzione';
    } catch (e) { return 'errore: ' + e.message; }
  };

  // La seconda traccia con la funzione presa in prestito: stessa finestra,
  // stesso sito, ma fuori dal conto.
  window.__due = () => {
    if (typeof window.__intonsa !== 'function') return Promise.resolve('niente prestito');
    try {
      return window.__intonsa.call(navigator.mediaDevices, { audio: true }).then(
        (s) => { window.__b = s.getTracks()[0]; return 'ottenuto'; },
        (e) => 'rifiutato:' + ((e && e.name) || '?'));
    } catch (e) { return Promise.resolve('errore: ' + e.message); }
  };
</script></body></html>`;

async function aspetta(fn, ms = 20_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function apriSicurezza(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const pag = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(pag, 'pagina Sicurezza non trovata').toBeTruthy();
  await pag.waitForLoadState('domcontentloaded').catch(() => {});
  await pag.waitForTimeout(1200);
  return pag;
}

test('togliere il microfono deve chiuderlo anche alla traccia presa con una funzione in prestito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).host;

  const primo = page.evaluate(() => window.__uno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 25_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo, 'chi consente deve ottenere il microfono').toBe('ottenuto');
  await shell.waitForTimeout(800);

  console.log('[586 g11] il prestito:', await page.evaluate(() => window.__presta()));
  console.log('[586 g11] la seconda traccia:', await page.evaluate(() => window.__due()));
  await page.fill('#campo', 'quello che stavo scrivendo').catch(() => {});
  const vivoPrima = await page.evaluate(() => window.__vivo);
  console.log('[586 g11] stato prima della revoca:', JSON.stringify(await page.evaluate(() => window.__stato())));

  const sicurezza = await apriSicurezza(app, shell);
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  console.log('[586 g11] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(5000);

  const statoDopo = await page.evaluate(() => window.__stato()).catch(() => ['pagina ricaricata', 'pagina ricaricata']);
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => null);
  const cartelli = await shell.locator('.perm-uso, .perm-badge, [class*="perm-uso"]').allTextContents().catch(() => []);
  console.log('[586 g11] dopo la revoca — stato VERO:', JSON.stringify(statoDopo),
    'pagina ricaricata:', vivoDopo !== vivoPrima, 'cartelli:', JSON.stringify(cartelli));

  expect(
    (statoDopo || []).filter((s) => s === 'live'),
    'tolta la risposta dalle Impostazioni il sito continua ad ascoltare: la traccia presa con la '
    + 'copia intonsa della funzione, presa in prestito da un riquadro poi buttato via, non passa '
    + 'dal conto, quindi la pagina risponde che non è rimasto niente di vivo e la ricarica non '
    + 'parte. L\'elenco si svuota, il cartello sparisce col suo Interrompi, e non resta nessun '
    + 'posto da cui rimediare',
  ).toEqual([]);
});
