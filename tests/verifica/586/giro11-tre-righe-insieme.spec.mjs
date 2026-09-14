// Verifica #586, giro 11 — tre righe sotto le schede nello stesso momento.
//
// Sotto la fila delle schede questo lavoro può accendere quattro cose diverse:
// la domanda di un permesso, il riquadro in cui si scegle cosa condividere, il
// cartello «può usare il microfono» e la riga «la posizione non è arrivata». I
// giri passati le hanno provate a due a due (il giro 3 aveva trovato la domanda
// che copriva l'avviso della finestra bloccata, il giro 8 il cartello e la
// domanda insieme). Qui se ne accendono tre, che è quello che capita su un sito
// di videochiamate: il microfono già dato, la mappa che non arriva, e il sito
// che intanto chiede lo schermo.
//
// Quello che deve valere: nessuna delle tre copre le altre, e l'area della
// pagina comincia sotto l'ultima — se una riga finisce dentro la pagina, chi
// naviga non la vede e non la può premere (è il rilievo del giro 1).

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<script>
  window.__t = null;
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__t = s.getTracks()[0]; return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'));
  window.__dove = () => new Promise((ok) => {
    navigator.geolocation.getCurrentPosition(() => ok('arrivata'), (e) => ok('errore:' + e.code));
  });
  window.__schermo = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    () => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?'));
</script></body></html>`;

function sovrapposti(a, b) {
  return !(a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
    || a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5);
}

test('tre righe accese insieme non si coprono, e la pagina comincia sotto l\'ultima', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  // 1) il microfono: consentito, quindi resta il cartello «può usare il microfono».
  const mic = page.evaluate(() => window.__mic());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  console.log('[586 g11] microfono:', await mic);
  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 20_000 });

  // 2) la posizione: consentita, e qui non arriva — la riga che lo dice.
  const dove = page.evaluate(() => window.__dove());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  console.log('[586 g11] posizione:', await dove);

  // 3) lo schermo: la domanda resta aperta, senza rispondere.
  const schermo = page.evaluate(() => window.__schermo());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });

  await shell.waitForTimeout(900);
  const righe = await shell.evaluate(() => {
    const fuori = [];
    for (const el of document.querySelectorAll('.perm-chip, .perm-live, .perm-source, .perm-notice, [class*="perm-"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      fuori.push({
        classe: el.className,
        testo: (el.textContent || '').slice(0, 70),
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
      });
    }
    return fuori;
  });
  console.log('[586 g11] righe accese:', JSON.stringify(righe, null, 1));

  // Dove comincia l'area della pagina, secondo il main.
  const area = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const viste = w.contentView ? w.contentView.children : [];
    return viste.map((v) => {
      try { const b = v.getBounds(); return { y: b.y, height: b.height }; } catch (_) { return null; }
    }).filter(Boolean);
  });
  const cimaPagina = area.length ? Math.max(...area.map((a) => a.y)) : null;
  console.log('[586 g11] la pagina comincia a y =', cimaPagina, 'aree:', JSON.stringify(area));

  await shell.screenshot({ path: 'tests/.shots/586-giro11-tre-righe.png' }).catch(() => {});

  const coppieSovrapposte = [];
  for (let i = 0; i < righe.length; i++) {
    for (let j = i + 1; j < righe.length; j++) {
      // Solo fra riquadri che non si contengono a vicenda (un pulsante dentro
      // la sua riga si sovrappone per costruzione).
      const a = righe[i]; const b = righe[j];
      const dentro = (p, q) => p.x >= q.x - 1 && p.y >= q.y - 1
        && p.x + p.width <= q.x + q.width + 1 && p.y + p.height <= q.y + q.height + 1;
      if (dentro(a, b) || dentro(b, a)) continue;
      if (sovrapposti(a, b)) coppieSovrapposte.push([a.testo, b.testo]);
    }
  }
  expect(
    coppieSovrapposte.length,
    `due righe accese insieme si coprono: ${JSON.stringify(coppieSovrapposte)}. Chi naviga non `
    + 'può premere quella sotto, e con tre cose accese (il microfono dato, la posizione che non '
    + 'arriva, lo schermo che il sito chiede) è una situazione normale su un sito di videochiamate',
  ).toBe(0);

  const piuInBasso = righe.length ? Math.max(...righe.map((r) => r.y + r.height)) : 0;
  expect(
    cimaPagina === null || piuInBasso <= cimaPagina + 2,
    `l'ultima riga finisce a y=${piuInBasso} ma l'area della pagina comincia a y=${cimaPagina}: `
    + 'una parte di quello che Filo scrive sotto le schede cade dentro la pagina, che Filo disegna '
    + 'sopra la propria cornice, e chi naviga non la vede e non può risponderle',
  ).toBe(true);

  console.log('[586 g11] esito dello schermo (non risposto):', await Promise.race([
    schermo, new Promise((r) => setTimeout(() => r('ancora in attesa'), 1500)),
  ]));
});
