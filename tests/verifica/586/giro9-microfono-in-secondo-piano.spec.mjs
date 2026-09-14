// Verifica #586, giro 9 — il microfono aperto in una scheda che non si sta
// guardando.
//
// Il cartello «può usare il microfono» esiste perché su un fisso, e su quasi
// tutti i portatili, il microfono non accende nessuna spia: senza quella riga un
// sito ascoltava e niente lo diceva. Il cartello però appartiene alla scheda che
// l'ha chiesto e viene nascosto appena si guarda un'altra scheda.
//
// Per chi usa Filo: sei in videochiamata su una scheda, e apri un'altra scheda
// per cercare una cosa — è il gesto più normale del mondo. Da quel momento in
// Filo non c'è più niente che dica che il microfono è aperto, né sulla scheda di
// prima né altrove, e «Interrompi» non si raggiunge: per fermare il microfono
// bisogna prima indovinare quale scheda era.
//
// Quello che deve succedere: finché un sito può usare il microfono o la
// fotocamera, dev'esserci un segno visibile anche quando si sta guardando
// un'altra scheda — sulla scheda che lo tiene aperto, come fa la spia
// dell'audio.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<p>videochiamata</p>
<script>
  window.__tracce = [];
  window.__chiedi = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce.push(...s.getTracks()); return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  window.__stato = () => window.__tracce.map((t) => t.kind + ':' + t.readyState);
</script></body></html>`;

test('il microfono aperto in una scheda lascia un segno anche da un\'altra scheda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__chiedi());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  expect(await esito, 'chi consente deve ottenere il microfono').toBe('ottenuto');

  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 20_000 });
  console.log('[586 g9] cartello sulla scheda della chiamata:',
    JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  // Si apre un'altra scheda, come fa chiunque mentre parla.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.waitForTimeout(2000);

  const traccia = await page.evaluate(() => window.__stato());
  const visibili = await shell.locator('.perm-live:visible').count();
  const testi = await shell.locator('.perm-live').allTextContents();
  // Qualunque segno, da qualunque parte della cornice, che nomini il microfono o
  // il sito che lo tiene aperto.
  const cornice = await shell.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const segnoAltrove = new RegExp(`microfono|${host.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 'i').test(cornice);
  await shell.screenshot({ path: 'tests/.shots/586-giro9-microfono-in-secondo-piano.png' }).catch(() => {});
  console.log('[586 g9] dopo il cambio scheda — traccia:', JSON.stringify(traccia),
    'cartelli visibili:', visibili, 'testi:', JSON.stringify(testi),
    'qualcosa nella cornice nomina il microfono o il sito:', segnoAltrove);

  expect(traccia, 'il microfono deve essere ancora aperto: è il presupposto della prova')
    .toEqual(['audio:live']);

  expect(
    visibili > 0 || segnoAltrove,
    'aperta un\'altra scheda, il microfono di prima è ancora acceso e in tutta la cornice di Filo '
    + 'non c\'è più niente che lo dica: nessun cartello, nessun segno sulla scheda che lo tiene '
    + 'aperto. Chi vuole chiuderlo deve prima indovinare da quale scheda arriva, e «Interrompi» '
    + 'non si raggiunge da nessun\'altra parte. Il cartello esiste proprio perché il microfono non '
    + 'accende nessuna spia sul computer',
  ).toBe(true);
});
