// Verifica #586, giro 11 — il menu di Filo spostato sotto il dito di chi clicca.
//
// Due voci del menu di Filo saltano la domanda del permesso, perché lì a
// chiedere è l'utente e non il sito: l'«Incolla», che legge gli appunti, e la
// «Detta», che accende il microfono. Dal giro 3 il gesto finto non passa più:
// Filo guarda `isTrusted`, che il browser mette e la pagina non può falsificare.
//
// Questo giro prova l'altra metà. Il gesto è VERO — lo fa una persona, col
// mouse — ma non cade dove quella persona crede. Il menu di Filo è un elemento
// HTML nel documento del sito, senza nessun confine che lo separi: il sito lo
// vede comparire e lo può rivestire, spostare, allargare. Basta stendere la voce
// «Incolla» sopra tutte le altre perché qualunque clic dentro il menu diventi un
// «Incolla».
//
// Per chi usa Filo: su un sito qualunque fai clic destro e scegli una voce del
// menu — «Traduci», «Spiega», quello che vuoi. Quello che avevi negli appunti
// (una password, un codice a sei cifre, l'indirizzo di casa) finisce al sito.
// Non compare nessuna domanda, e in Impostazioni non resta niente da togliere.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'password-negli-appunti-11K';

// La pagina è un articolo qualunque. Sopra c'è un foglio su cui si può
// scrivere, praticamente invisibile: serve solo perché il clic destro cada su
// qualcosa di scrivibile, così nel menu di Filo compare l'«Incolla». Un sito lo
// mette in una riga.
function pagina(voce) {
  return `<!doctype html><html><body style="margin:0">
<div style="padding:24px;font:16px system-ui">
  <h1>Ricetta della torta di mele</h1>
  <p id="testo">Tre mele, due uova, un bicchiere di latte. Parola difficile: Streuselkuchen.</p>
</div>
<div id="foglio" contenteditable="true"
     style="position:fixed;inset:0;opacity:0.01;outline:none"></div>
<script>
  window.__bottino = () => document.getElementById('foglio').innerText || '';
  // Il sito guarda comparire il menu di Filo e lo riveste: la voce che gli
  // interessa si stende su tutto il riquadro, le altre smettono di rispondere al
  // mouse. Da quel momento qualunque clic dentro il menu è quella voce.
  const vestilo = (menu) => {
    try {
      const cerca = ${JSON.stringify(voce)};
      const nodi = [...menu.querySelectorAll('*')];
      const bersaglio = nodi.find((n) => new RegExp(cerca, 'i').test(n.textContent || '')
        && n.children.length === 0)
        || nodi.find((n) => new RegExp(cerca, 'i').test(n.textContent || ''));
      if (!bersaglio) { window.__vestito = 'voce non trovata'; return; }
      const clicca = bersaglio.closest('[class*="main"], [class*="item"], [class*="row"]') || bersaglio;
      for (const n of menu.children) n.style.setProperty('pointer-events', 'none', 'important');
      menu.style.setProperty('position', 'fixed', 'important');
      const r = menu.getBoundingClientRect();
      const sopra = document.createElement('div');
      // Niente di finto: il clic vero della persona cade su questo pezzo, che
      // inoltra il gesto alla voce sotto. Ma basta anche stendere la voce stessa.
      clicca.style.setProperty('position', 'fixed', 'important');
      clicca.style.setProperty('left', r.left + 'px', 'important');
      clicca.style.setProperty('top', r.top + 'px', 'important');
      clicca.style.setProperty('width', Math.max(120, r.width) + 'px', 'important');
      clicca.style.setProperty('height', Math.max(60, r.height) + 'px', 'important');
      clicca.style.setProperty('pointer-events', 'auto', 'important');
      clicca.style.setProperty('z-index', '2147483647', 'important');
      clicca.style.setProperty('opacity', '0.01', 'important');
      sopra.remove();
      window.__vestito = 'fatto';
    } catch (e) { window.__vestito = 'errore: ' + e.message; }
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of (m.addedNodes || [])) {
        try {
          if (!n || n.nodeType !== 1) continue;
          const menu = n.classList && n.classList.contains('sn-menu')
            ? n : (n.querySelector && n.querySelector('.sn-menu'));
          if (menu) vestilo(menu);
        } catch (_) {}
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;
}

test('un clic vero dentro il menu di Filo non deve poter diventare un «Incolla» scelto dal sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);

  const page = await testServer.openReady(openTab, pagina('incolla|paste'));

  // Il clic destro lo fa una persona, sul testo dell'articolo: gesto vero, con
  // `isTrusted` a posto, esattamente come quando si vuole tradurre una parola.
  await page.click('#testo', { button: 'right', position: { x: 40, y: 8 } });
  await page.waitForSelector('.sn-menu', { timeout: 10_000 });
  await page.waitForTimeout(500);
  console.log('[586 g11] il sito ha rivestito il menu:', await page.evaluate(() => window.__vestito));

  const scatola = await page.locator('.sn-menu').first().boundingBox();
  console.log('[586 g11] riquadro del menu:', JSON.stringify(scatola));
  expect(scatola, 'il menu di Filo non è comparso').toBeTruthy();

  // La persona clicca su una voce del menu — qualunque voce, quella che vede
  // lei. Secondo clic vero, col mouse.
  await page.mouse.click(scatola.x + Math.min(60, scatola.width / 2), scatola.y + 14);
  await page.waitForTimeout(2000);

  const bottino = await page.evaluate(() => window.__bottino()).catch(() => '');
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g11] quello che il sito si è preso:', JSON.stringify(bottino),
    'domande comparse:', domande);

  expect(
    String(bottino || ''),
    'con un clic destro e un clic — due gesti veri di una persona, su un menu che la persona '
    + `credeva di usare per altro — il sito si è preso quello che c'era negli appunti. Nessuna `
    + `domanda è comparsa (pastiglie: ${domande}) e in Impostazioni non resta niente da togliere, `
    + 'perché nessuna scelta è stata presa. Il menu di Filo vive nel documento del sito senza '
    + 'nessun confine: il sito lo vede comparire e stende la voce che gli serve sopra tutte le altre',
  ).not.toContain(SEGRETO);
});

test('lo stesso clic non deve poter diventare una «Detta» scelta dal sito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, pagina('detta'));

  await page.click('#testo', { button: 'right', position: { x: 40, y: 8 } });
  await page.waitForSelector('.sn-menu', { timeout: 10_000 });
  await page.waitForTimeout(500);
  console.log('[586 g11] rivestito per la dettatura:', await page.evaluate(() => window.__vestito));

  const scatola = await page.locator('.sn-menu').first().boundingBox();
  expect(scatola, 'il menu di Filo non è comparso').toBeTruthy();
  await page.mouse.click(scatola.x + Math.min(60, scatola.width / 2), scatola.y + 14);
  await page.waitForTimeout(3000);

  // Il microfono acceso da Filo per la dettatura lascia un segno: il cartello
  // «può usare il microfono» non c'è (la richiesta è di Filo), ma la dettatura
  // sì, e si vede nella pagina. Quello che si misura qui è se il microfono si è
  // acceso senza che comparisse nessuna domanda.
  const dettando = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      indicatore: !!(q('.sn-dictate-overlay') || q('[class*="dictate"]') || q('[class*="sn-mic"]')),
      classi: [...document.querySelectorAll('[class*="dict"], [class*="mic"]')]
        .map((n) => n.className).slice(0, 6),
    };
  }).catch(() => ({ indicatore: false, classi: [] }));
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g11] dettatura partita:', JSON.stringify(dettando), 'domande comparse:', domande);

  expect(
    dettando.indicatore && domande === 0,
    'con due clic veri su un menu rivestito dal sito è partita la dettatura di Filo, cioè il '
    + 'microfono, senza che comparisse nessuna domanda: il sito si porta via anche la trascrizione '
    + 'di quello che si dice davanti al computer',
  ).toBe(false);
});
