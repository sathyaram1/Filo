// Verifica #586, giro 11 — il riquadro che la pagina non prende per il manico.
//
// Il giro 10 aveva chiuso i riquadri creati senza indirizzo: la pagina se ne
// scriveva uno in una riga e da lì saltava tutto. La chiusura si aggancia a due
// cose: le due proprietà con cui si arriva dentro un riquadro
// (`contentWindow`, `contentDocument`) e un osservatore del documento, che però
// arriva un attimo dopo.
//
// Qui il riquadro si prende per un'altra strada, `window[0]`, che non è una
// proprietà del riquadro e non aspetta nessun osservatore. Sono due righe, e non
// servono permessi, gesti o trucchi: è la strada che una pagina prende quando
// vuole parlare col proprio riquadro subito.
//
// Per chi usa Filo, le tre cose che si provano qui:
//   · un sito a cui hai tolto il microfono continua ad ascoltare;
//   · un sito si prende lo schermo intero senza farti scegliere cosa condividere;
//   · una pagina fa morire la propria scheda, e quello che stavi scrivendo lì è
//     perso.

import { test, expect } from '../../fixtures/electron.mjs';

// La pagina prende il riquadro per indice: `window[0]`. Il manico del riquadro
// (`f.contentWindow`) non lo tocca mai, e non aspetta nemmeno un giro di
// orologio.
const PRENDI_PER_INDICE = `
  window.__figlio = () => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    return window[0];
  };`;

const HTML_MICROFONO = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:80%">
<script>
  window.__vivo = String(Date.now());
  window.__a = null; window.__b = null;
  const vero = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__stato = () => [window.__a, window.__b].map((t) => (t ? vero.call(t) : 'assente'));
  ${PRENDI_PER_INDICE}
  // La prima traccia la prende la pagina, per la via normale: così Filo vede
  // che questa pagina passa dal suo giro, e la rete «non hai mai visto niente»
  // non scatta.
  window.__uno = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__a = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  // La seconda la prende il riquadro, preso per indice.
  window.__due = () => {
    const w = window.__figlio();
    if (!w || !w.navigator || !w.navigator.mediaDevices) return Promise.resolve('niente riquadro');
    return w.navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (s) => { window.__b = s.getTracks()[0]; return 'ottenuto'; },
      (e) => 'rifiutato:' + ((e && e.name) || '?'));
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

test('togliere il microfono deve chiuderlo anche a un riquadro preso per indice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_MICROFONO);
  const host = new URL(page.url()).host;

  const primo = page.evaluate(() => window.__uno());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo, 'chi consente deve ottenere il microfono').toBe('ottenuto');
  await shell.waitForTimeout(800);

  console.log('[586 g11] il riquadro preso per indice ha:', await page.evaluate(() => window.__due()));
  await page.fill('#campo', 'quello che stavo scrivendo').catch(() => {});
  const vivoPrima = await page.evaluate(() => window.__vivo);
  console.log('[586 g11] stato prima della revoca:', JSON.stringify(await page.evaluate(() => window.__stato())));

  const sicurezza = await apriSicurezza(app, shell);
  console.log('[586 g11] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));
  await sicurezza.locator('#perms-list li').filter({ hasText: host }).first()
    .locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(4500);

  const stato = await page.evaluate(() => window.__stato()).catch(() => ['pagina ricaricata']);
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => 'ricaricata');
  console.log('[586 g11] dopo la revoca — stato vero:', JSON.stringify(stato),
    'pagina ricaricata:', vivoDopo !== vivoPrima,
    'cartelli:', JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  expect(
    stato.includes('live'),
    'tolta la risposta dalle Impostazioni, il microfono del sito è ancora aperto: la traccia che lo '
    + 'tiene sta in un riquadro che la pagina ha preso per indice invece che per il manico, dove le '
    + 'difese di Filo non arrivano. L\'elenco si è svuotato, il cartello «può usare il microfono» è '
    + 'sparito col suo «Interrompi», e non resta nessun posto da cui rimediare',
  ).toBe(false);
});

const HTML_SCHERMO = `<!doctype html><html><body style="margin:0;padding:16px">
<script>
  window.__vivo = String(Date.now());
  window.__tracce = [];
  ${PRENDI_PER_INDICE}
  window.__schermo = () => {
    const w = window.__figlio();
    if (!w || !w.navigator || !w.navigator.mediaDevices) return Promise.resolve('niente riquadro');
    return w.navigator.mediaDevices.getUserMedia({
      video: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then((s) => {
      window.__tracce = s.getTracks().map((t) => {
        const st = t.getSettings ? t.getSettings() : {};
        return t.kind + ':' + (t.label || '?') + ':' + (st.width || 0) + 'x' + (st.height || 0);
      });
      return 'ottenuto';
    }, (e) => 'rifiutato:' + ((e && e.name) || '?'));
  };
</script></body></html>`;

test('anche da un riquadro preso per indice, lo schermo deve passare dalla scelta di cosa si condivide', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO);

  const esito = page.evaluate(() => window.__schermo());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  console.log('[586 g11] la domanda dice:', await shell.locator('.perm-chip .perm-chip-text').first().innerText());
  await shell.locator('.perm-chip .perm-chip-allow').first().click();

  // Sulla strada moderna, dopo il «Consenti», compare il riquadro con le cose
  // fra cui scegliere. Gli si dà tempo.
  const scelta = await aspetta(async () => (await shell.locator('.perm-source').count()) > 0, 8000);
  console.log('[586 g11] è comparsa la scelta di cosa condividere:', !!scelta);
  if (scelta) {
    await shell.locator('.perm-source .perm-source-item').first().click().catch(() => {});
  }

  const esitoV = await esito.catch((e) => 'errore:' + e.message);
  await shell.waitForTimeout(3500);
  const tracce = await page.evaluate(() => window.__tracce).catch(() => ['pagina ricaricata']);
  console.log('[586 g11] esito:', esitoV, 'tracce arrivate:', JSON.stringify(tracce));

  expect(
    !scelta && esitoV === 'ottenuto' && tracce.length > 0,
    'da un riquadro preso per indice, un «Consenti» solo consegna lo schermo senza che compaia niente '
    + 'da scegliere: chi risponde non sceglie cosa condivide, e riceve il monitor intero. La scelta, '
    + 'che è la cosa che questo lavoro ha aggiunto, la incontra solo chi chiede con le buone',
  ).toBe(false);
});

const HTML_SCHEDA_MORTA = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:80%">
<script>
  window.__vivo = String(Date.now());
  ${PRENDI_PER_INDICE}
  // L'audio del computer chiesto senza l'immagine dello schermo: Chromium non la
  // rifiuta, chiude il processo della pagina.
  window.__ammazza = () => {
    const w = window.__figlio();
    if (!w || !w.navigator || !w.navigator.mediaDevices) return Promise.resolve('niente riquadro');
    return w.navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then(() => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?'));
  };
</script></body></html>`;

test('una pagina non deve poter far morire la propria scheda da un riquadro preso per indice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_SCHEDA_MORTA);
  await page.fill('#campo', 'quello che stavo leggendo').catch(() => {});
  const vivoPrima = await page.evaluate(() => window.__vivo);

  const esito = await page.evaluate(() => window.__ammazza()).catch((e) => 'la scheda è morta: ' + e.message);
  await shell.waitForTimeout(2500);
  const campo = await page.inputValue('#campo').catch(() => '(perso)');
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => 'morta');
  console.log('[586 g11] esito:', esito, 'campo dopo:', JSON.stringify(campo), 'stessa pagina:', vivoDopo === vivoPrima);

  expect(
    vivoDopo !== vivoPrima || campo !== 'quello che stavo leggendo',
    'la scheda è morta con una riga: la pagina ha chiesto l\'audio del computer senza l\'immagine '
    + 'dello schermo da un riquadro preso per indice, e quello che chi navigava aveva scritto lì è '
    + 'perso. La stessa richiesta scritta nella pagina torna un errore che il sito sa gestire',
  ).toBe(false);
});
