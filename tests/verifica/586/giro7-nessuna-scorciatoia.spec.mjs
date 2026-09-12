// Verifica #586, giro 7 — l'ultima passata sulle scorciatoie: strade meno
// battute per prendersi una delle sei cose senza che compaia niente.
//
// Nessuna di queste deve consegnare niente prima che l'utente abbia risposto:
//  · la posizione seguita nel tempo (watchPosition) invece di chiesta una volta;
//  · la lettura degli appunti nella forma completa (clipboard.read), non solo
//    quella di solo testo;
//  · i cookie di un sito dentro un altro (requestStorageAccess);
//  · il microfono chiesto scavalcando il pezzo di Filo che vive nella pagina,
//    cioè chiamando la funzione originale invece di quella che il sito si trova
//    addosso: il cancello vero sta nel processo principale e deve reggere lo
//    stesso.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:12px"><p>pagina</p>
<script>
  const entro = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('appeso'), ms))]);
  window.__posizione = () => entro(new Promise((res) => {
    try {
      navigator.geolocation.watchPosition(
        (p) => res('coordinate:' + (p && p.coords ? 'si' : '?')),
        (e) => res('no:' + (e && e.code)));
    } catch (e) { res('eccezione'); }
  }), 6000);
  window.__appunti = () => entro(navigator.clipboard.read().then(
    (items) => 'letti:' + items.length, (e) => 'no:' + ((e && e.name) || '?')), 6000);
  window.__cookieAltrove = () => entro(document.requestStorageAccess().then(
    () => 'ok', (e) => 'no:' + ((e && e.name) || '?')), 6000);
  window.__microfonoGrezzo = () => entro(
    MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, { audio: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
      (e) => 'no:' + ((e && e.name) || '?')), 6000);
</script></body></html>`;

test('nessuna di queste strade consegna qualcosa senza che l\'utente abbia risposto', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForTimeout(600);

  const esiti = {};
  for (const nome of ['__posizione', '__appunti', '__cookieAltrove', '__microfonoGrezzo']) {
    const p = page.evaluate((n) => window[n](), nome);
    await shell.waitForTimeout(2500);
    const domande = await shell.locator('.perm-chip').count();
    const testo = domande ? await shell.locator('.perm-chip .perm-chip-text').first().innerText() : '';
    const esito = await p;
    esiti[nome] = { domande, testo, esito };
    console.log('[586 g7]', nome, JSON.stringify(esiti[nome]));
    // Chiudo senza decidere e passo alla prossima.
    for (let i = 0; i < domande; i++) {
      await shell.locator('.perm-chip .perm-chip-x').first().click();
      await shell.waitForTimeout(200);
    }
    await shell.waitForTimeout(400);
  }

  expect(
    esiti.__posizione.esito.startsWith('coordinate'),
    'la posizione seguita nel tempo arriva al sito senza che nessuno abbia risposto',
  ).toBe(false);
  expect(
    esiti.__appunti.esito.startsWith('letti'),
    'il sito legge gli appunti nella forma completa senza che nessuno abbia risposto',
  ).toBe(false);
  expect(
    esiti.__microfonoGrezzo.esito,
    'il microfono chiesto scavalcando il pezzo di Filo che vive nella pagina arriva al sito senza '
    + 'che nessuno abbia risposto: il cancello del processo principale non lo ferma',
  ).not.toBe('ok');
});
