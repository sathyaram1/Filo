// Verifica #586, giro 9 — «se te lo tolgo non ce l'hai più», e la pagina che
// risponde il falso.
//
// Per chiudere il microfono senza ricaricare la pagina (ricaricare buttava via
// quello che ci stavi scrivendo) Filo CHIEDE alla pagina di fermare le tracce che
// le ha consegnato, e si fida di quanto la pagina risponde: se dice che non è
// rimasto niente di vivo, non ricarica. C'è una rete — se la pagina dice di non
// aver mai visto passare niente, Filo non le crede e ricarica — ma la rete guarda
// il numero delle tracce VISTE, che è un altro numero della stessa risposta.
//
// Per chi usa Filo: un sito ti chiede il microfono e tu consenti. Più tardi vai
// in Impostazioni → Sicurezza e gli togli la risposta, che è la strada che il
// feedback chiede. L'elenco si svuota, il cartello sparisce, e il sito continua
// ad ascoltare.
//
// Quello che deve succedere: tolta la risposta, il microfono si chiude — o la
// pagina si ricarica, che è la strada dura ma sicura. Quello che non deve
// succedere è che una risposta della pagina basti a tenere aperto un sensore che
// l'utente ha appena tolto.

import { test, expect } from '../../fixtures/electron.mjs';

// La pagina mente su UNA cosa sola: dice che le sue tracce sono finite quando
// gliele si chiede. Continua a passare dal giro di Filo (quindi la rete che
// guarda «non hai mai visto niente» non scatta) e non tocca niente d'altro.
const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:80%">
<script>
  window.__tracce = [];
  // Da qui in poi ogni traccia si dichiara «finita» a chi guarda readyState,
  // anche mentre è viva. Il vero stato lo teniamo da parte.
  const d = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState');
  window.__veroStato = (t) => d.get.call(t);
  Object.defineProperty(MediaStreamTrack.prototype, 'readyState', {
    configurable: true, get() { return 'ended'; },
  });
  // E stop() non fa niente: il sito vuole restare acceso.
  MediaStreamTrack.prototype.stop = function () {};
  window.__chiedi = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce.push(...s.getTracks()); return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  window.__vero = () => window.__tracce.map((t) => window.__veroStato(t));
  window.__vivo = String(Date.now());
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

test('togliere il microfono deve chiuderlo anche se la pagina dice che è già chiuso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__chiedi());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await esito, 'chi consente deve ottenere il microfono').toBe('ottenuto');
  const vivoPrima = await page.evaluate(() => window.__vivo);
  console.log('[586 g9] stato vero appena consentito:', JSON.stringify(await page.evaluate(() => window.__vero())));

  // Impostazioni → Sicurezza → togli la risposta.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  console.log('[586 g9] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(3000);

  const vero = await page.evaluate(() => window.__vero()).catch(() => ['pagina ricaricata']);
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => 'ricaricata');
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g9] dopo la revoca — stato VERO delle tracce:', JSON.stringify(vero),
    'pagina ricaricata:', vivoDopo !== vivoPrima, 'cartelli:', JSON.stringify(cartelli));

  expect(
    vero.includes('live'),
    'tolta la risposta dalle Impostazioni, il microfono del sito è ancora aperto: alla domanda «hai '
    + 'ancora qualcosa di vivo?» la pagina ha risposto di no, e Filo le ha creduto. L\'elenco si è '
    + 'svuotato, il cartello «può usare il microfono» è sparito con il suo «Interrompi», e non resta '
    + 'nessun posto da cui rimediare: per chiudere davvero bisogna chiudere la scheda, e senza '
    + 'cartello non si sa quale. È la garanzia «se te lo tolgo non ce l\'hai più», riaperta da una '
    + 'quarta porta dopo i giri 4, 6 e 7',
  ).toBe(false);
});
