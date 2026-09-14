// Verifica #586, giro 11 — tre porte che nessuno dei dieci giri aveva aperto.
//
//  1. Lo stesso sito aperto in DUE schede, col microfono in mano in tutte e due:
//     togliergli la risposta una volta deve chiuderlo in tutte e due, perché la
//     risposta è una sola e vale per il sito, non per la scheda.
//  2. La spunta «Fagli sentire anche l'audio del computer», nel riquadro in cui
//     si scegle cosa condividere, nasce spenta: lasciata spenta, al sito non
//     deve arrivare nessun audio del computer. Era il rilievo del giro 3 (si
//     dava via tutto quello che si sente senza che niente lo nominasse) e la
//     spunta è la correzione: se non tiene, la correzione non c'è.
//  3. La domanda del permesso si può chiudere con l'Esc, come ogni altro
//     riquadro che Filo apre sopra la pagina.

import { test, expect } from '../../fixtures/electron.mjs';

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

const HTML_MIC = `<!doctype html><html><body style="margin:0;padding:16px">
<p id="chi"></p>
<script>
  window.__vivo = String(Date.now());
  window.__t = null;
  const vero = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__stato = () => (window.__t ? vero.call(window.__t) : 'assente');
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__t = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
</script></body></html>`;

test('togliere il microfono al sito deve chiuderlo in tutte le schede che ce l\'hanno', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const a = await testServer.openReady(openTab, HTML_MIC);
  const host = new URL(a.url()).host;

  const primo = a.evaluate(() => window.__mic());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await primo, 'chi consente deve ottenere il microfono').toBe('ottenuto');

  // Seconda scheda, stesso sito: la risposta è già data, quindi il microfono
  // arriva senza nessuna domanda. È il caso di chi tiene aperta la stessa
  // videochiamata in due schede, o che ne apre una seconda per sbaglio.
  const b = await testServer.openReady(openTab, HTML_MIC);
  expect(new URL(b.url()).host, 'le due schede devono essere lo stesso sito').toBe(host);
  console.log('[586 g11] seconda scheda:', await b.evaluate(() => window.__mic()));
  await shell.waitForTimeout(800);
  console.log('[586 g11] stato prima della revoca — A:', await a.evaluate(() => window.__stato()),
    'B:', await b.evaluate(() => window.__stato()));

  const sicurezza = await apriSicurezza(app, shell);
  console.log('[586 g11] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));
  await sicurezza.locator('#perms-list li').filter({ hasText: host }).first()
    .locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(5000);

  const statoA = await a.evaluate(() => window.__stato()).catch(() => 'ricaricata');
  const statoB = await b.evaluate(() => window.__stato()).catch(() => 'ricaricata');
  console.log('[586 g11] dopo la revoca — A:', statoA, 'B:', statoB,
    'cartelli:', JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  expect(
    [statoA, statoB].includes('live'),
    `tolta l'unica risposta che il sito aveva, il microfono resta aperto in una delle due schede `
    + `(prima scheda: ${statoA}, seconda: ${statoB}). La risposta è una e vale per il sito: `
    + 'togliendola, il sito non deve più ascoltare da nessuna parte. In Impostazioni non resta '
    + 'niente da togliere, e sulla scheda rimasta ad ascoltare non c\'è nessun cartello da premere',
  ).toBe(false);
});

const HTML_SCHERMO = `<!doctype html><html><body style="margin:0;padding:16px">
<script>
  window.__tracce = [];
  window.__chiedi = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => {
      window.__tracce = s.getTracks().map((t) => t.kind + ':' + (t.label || '?'));
      return 'ottenuto';
    },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
</script></body></html>`;

test('la spunta dell\'audio del computer, lasciata spenta, deve tenere fuori l\'audio', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_SCHERMO);

  const esito = page.evaluate(() => window.__chiedi());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  console.log('[586 g11] la domanda dice:', await shell.locator('.perm-chip .perm-chip-text').first().innerText());
  await shell.locator('.perm-chip .perm-chip-allow').first().click();

  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 20_000 });
  const spunta = shell.locator('.perm-source .perm-source-audio input');
  console.log('[586 g11] la spunta dell\'audio c\'è:', await spunta.count(),
    'ed è accesa:', await spunta.isChecked().catch(() => 'assente'));
  // NON la si tocca: nasce spenta, e chi non la tocca non sta dando l'audio.
  await shell.locator('.perm-source .perm-source-item').first().click();

  const esitoV = await esito.catch((e) => 'errore:' + e.message);
  await shell.waitForTimeout(2500);
  const tracce = await page.evaluate(() => window.__tracce).catch(() => []);
  const segno = (await shell.locator('.perm-live').allTextContents()).join(' | ');
  console.log('[586 g11] esito:', esitoV, 'tracce arrivate:', JSON.stringify(tracce), 'cartello:', segno);
  test.skip(esitoV !== 'ottenuto', `qui la cattura schermo non parte (${esitoV}): niente da misurare`);

  expect(
    tracce.some((t) => t.startsWith('audio')),
    'lasciata spenta la spunta «Fagli sentire anche l\'audio del computer», al sito arriva comunque '
    + 'una traccia audio del computer: tutto quello che si sente sul computer, la musica, un video, '
    + 'la chiamata aperta in un\'altra finestra. La spunta spenta è la sola cosa che dice «solo '
    + `l'immagine», e non tiene. Tracce arrivate: ${JSON.stringify(tracce)}`,
  ).toBe(false);
  // E il cartello non deve nominare un audio che non è stato dato.
  expect(
    /audio/i.test(segno),
    `il cartello che resta dice di un audio che nessuno ha dato: «${segno}»`,
  ).toBe(false);
});

test('la domanda del permesso si deve poter chiudere con l\'Esc', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML_MIC);

  const chiesto = page.evaluate(() => window.__mic());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });

  // L'Esc lo preme chi sta guardando la pagina, che è dove sta il cursore quando
  // la domanda compare.
  await page.keyboard.press('Escape');
  await shell.waitForTimeout(1200);
  const rimaste = await shell.locator('.perm-chip').count();
  console.log('[586 g11] domande dopo l\'Esc:', rimaste, 'esito per il sito:',
    await Promise.race([chiesto, new Promise((r) => setTimeout(() => r('ancora appeso'), 1500))]));

  expect(
    rimaste,
    'l\'Esc non chiude la domanda del permesso: resta lì sopra la pagina, e l\'unico modo di '
    + 'toglierla di mezzo è prendere il mouse e premere la ×. In Filo l\'Esc chiude prima il '
    + 'riquadro aperto (è un pattern scritto del repo), e questo riquadro ha già una × che fa '
    + 'esattamente quello: chiudere senza decidere',
  ).toBe(0);
});
