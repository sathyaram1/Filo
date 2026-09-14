// Verifica #586, giro 10 — «se te lo tolgo non ce l'hai più», ancora.
//
// Dal giro 9 il conto delle tracce consegnate non lo tiene più il mondo della
// pagina (che mentiva) ma il giro di Filo che vive accanto: ogni traccia viene
// appesa a un elemento nascosto nel documento, e da lì Filo la legge e la ferma
// con i propri stampi. La regola che decide: se dalla pagina non risulta NIENTE
// di consegnato, Filo non le crede e ricarica; se qualcosa risulta e dopo lo
// stop non resta vivo niente, Filo non ricarica.
//
// Per chi usa Filo: un sito ti chiede il microfono, tu consenti, e più tardi vai
// in Impostazioni → Sicurezza e gli togli la risposta. L'elenco si svuota, il
// cartello «può usare il microfono» sparisce col suo «Interrompi», e il sito
// continua ad ascoltare.
//
// Quello che deve succedere: tolta la risposta, il microfono si chiude — o la
// pagina si ricarica, che è la strada dura ma sicura.

import { test, expect } from '../../fixtures/electron.mjs';

// Il sito fa due cose, tutte e due dentro casa sua:
//   · la prima traccia la lascia contare, così Filo vede che la pagina passa dal
//     suo giro e la rete «non hai mai visto niente» non scatta;
//   · poi smette di far arrivare le tracce all'elemento che Filo guarda, e
//     spegne il proprio stop(). Dalla seconda in poi le sue tracce non risultano
//     a nessuno.
const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:80%">
<script>
  window.__vivo = String(Date.now());
  window.__a = null; window.__b = null;
  const vero = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__stato = () => [window.__a, window.__b].map((t) => (t ? vero.call(t) : 'assente'));
  window.__uno = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__a = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  window.__cieco = () => {
    // Gli elementi che Filo si appende per tenere il conto non riceveranno più
    // niente, e nessuna traccia si fermerà da sé.
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true, get() { return null; }, set(_v) {},
    });
    MediaStreamTrack.prototype.stop = function () {};
    return 'fatto';
  };
  window.__due = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__b = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
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

test('togliere il microfono deve chiuderlo anche la traccia che non si fa contare', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const primo = page.evaluate(() => window.__uno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo, 'chi consente deve ottenere il microfono').toBe('ottenuto');
  await shell.waitForTimeout(800);

  console.log('[586 g10] cieco:', await page.evaluate(() => window.__cieco()));
  console.log('[586 g10] seconda traccia:', await page.evaluate(() => window.__due()));
  await page.fill('#campo', 'quello che stavo scrivendo').catch(() => {});
  const vivoPrima = await page.evaluate(() => window.__vivo);
  console.log('[586 g10] stato prima della revoca:', JSON.stringify(await page.evaluate(() => window.__stato())));

  // Impostazioni → Sicurezza → togli la risposta, che è la strada che il
  // feedback chiede.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  console.log('[586 g10] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));
  await sicurezza.locator('#perms-list li').filter({ hasText: host }).first()
    .locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(4000);

  const stato = await page.evaluate(() => window.__stato()).catch(() => ['pagina ricaricata']);
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => 'ricaricata');
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g10] dopo la revoca — stato vero:', JSON.stringify(stato),
    'pagina ricaricata:', vivoDopo !== vivoPrima, 'cartelli:', JSON.stringify(cartelli));

  expect(
    stato.includes('live'),
    'tolta la risposta dalle Impostazioni, il microfono del sito è ancora aperto: la prima traccia si '
    + 'è fatta contare, la seconda no, e a Filo è bastato che il conto non fosse a zero per non '
    + 'prendere la strada dura. L\'elenco si è svuotato, il cartello «può usare il microfono» è '
    + 'sparito col suo «Interrompi», e non resta nessun posto da cui rimediare: per chiudere davvero '
    + 'bisogna chiudere la scheda, e senza cartello non si sa quale',
  ).toBe(false);
});

test('anche l\'«Interrompi» del cartello deve chiudere la traccia che non si fa contare', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  const primo = page.evaluate(() => window.__uno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo).toBe('ottenuto');
  await shell.waitForTimeout(800);
  await page.evaluate(() => window.__cieco());
  await page.evaluate(() => window.__due());
  console.log('[586 g10] cartello:', JSON.stringify((await shell.locator('.perm-live').allTextContents()).join(' ')));

  await shell.locator('.perm-live .perm-chip-btn').first().click();
  await shell.waitForTimeout(4000);
  const stato = await page.evaluate(() => window.__stato()).catch(() => ['pagina ricaricata']);
  console.log('[586 g10] dopo l\'Interrompi — stato vero:', JSON.stringify(stato),
    'cartelli rimasti:', await shell.locator('.perm-live').count());

  expect(
    stato.includes('live'),
    'premuto «Interrompi» sul cartello «può usare il microfono», il microfono del sito è ancora '
    + 'aperto, e il cartello — con il suo «Interrompi» — è sparito: da lì non resta nessun posto '
    + 'dove riprovare',
  ).toBe(false);
});

// Il conto delle tracce «mai viste» si fa SOMMANDO le risposte di tutti i
// riquadri: basta che un riquadro qualunque ne abbia vista passare una perché la
// rete non scatti per nessuno degli altri.
const HTML_DUE_RIQUADRI = `<!doctype html><html><body style="margin:0;padding:16px">
<script>
  window.__vivo = String(Date.now());
  window.__a = null; window.__b = null;
  const vero = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__stato = () => [window.__a, window.__b].map((t) => (t ? vero.call(t) : 'assente'));
  // La pagina prende la prima traccia e la lascia contare.
  window.__uno = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__a = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  // La seconda la prende un riquadro con srcdoc — che la guardia ce l'ha — dopo
  // essersi accecato da solo: le sue tracce non risultano a nessuno, e la sua
  // risposta «non ho mai visto niente» viene coperta da quella della pagina.
  window.__due = () => new Promise((ok) => {
    const f = document.createElement('iframe');
    f.srcdoc = '<!doctype html><html><body>r</body></html>';
    f.onload = () => {
      const w = f.contentWindow;
      w.Object.defineProperty(w.HTMLMediaElement.prototype, 'srcObject', {
        configurable: true, get() { return null; }, set(_v) {},
      });
      w.MediaStreamTrack.prototype.stop = function () {};
      w.navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        window.__b = s.getTracks()[0]; ok('ottenuto');
      }, (e) => ok('rifiutato:' + ((e && e.name) || '?')));
    };
    document.body.appendChild(f);
  });
</script></body></html>`;

test('un riquadro che non si fa contare non deve poter tenere aperto il microfono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_DUE_RIQUADRI);
  const host = new URL(page.url()).host;

  const primo = page.evaluate(() => window.__uno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo).toBe('ottenuto');
  await shell.waitForTimeout(800);
  console.log('[586 g10] il riquadro ha ottenuto:', await page.evaluate(() => window.__due()));
  const vivoPrima = await page.evaluate(() => window.__vivo);

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  await sicurezza.locator('#perms-list li').filter({ hasText: host }).first()
    .locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(4000);

  const stato = await page.evaluate(() => window.__stato()).catch(() => ['pagina ricaricata']);
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => 'ricaricata');
  console.log('[586 g10] dopo la revoca — stato vero:', JSON.stringify(stato),
    'pagina ricaricata:', vivoDopo !== vivoPrima);

  expect(
    stato.includes('live'),
    'il microfono preso da un riquadro incorporato che si è accecato da solo resta aperto a permesso '
    + 'tolto: il conto delle tracce «mai viste» si somma fra i riquadri, quindi basta che un riquadro '
    + 'qualunque ne abbia vista passare una perché la rete non scatti per nessuno',
  ).toBe(false);
});
