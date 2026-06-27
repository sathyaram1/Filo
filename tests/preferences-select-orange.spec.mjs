// Verifica che il dropdown nativo <select> (es. Tema nella pagina Preferenze)
// abbia l'opzione selezionata/in-hover in arancione coerente con la palette
// Filo, invece del blu di sistema. L'utente l'aveva specificamente segnalato
// guardando lo screenshot del dropdown "Aspetto chiaro o scuro": l'opzione
// "Scuro" appariva con sfondo blu (#default-browser highlight).

import { test, expect } from './fixtures/electron.mjs';

test('preferences: select option:checked usa l\'accent arancione Filo, non il blu di sistema', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  // Ispeziona le regole CSS globali (theme.css) caricate sulla pagina.
  // Cerchiamo la regola `option:checked` (qualificata da [data-sn-theme] o no).
  const rule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; }
      for (const r of rules) {
        if (!r.selectorText) continue;
        if (/option:checked|option:hover/.test(r.selectorText)) {
          return {
            selector: r.selectorText,
            bg: r.style.backgroundColor || r.style.background || '',
            color: r.style.color || '',
          };
        }
      }
    }
    return null;
  });

  expect(rule, 'mancano regole per option:checked/option:hover').toBeTruthy();
  // L'accent Filo è --sn-accent: #c45a3b (rgb 196,90,59). La regola può usare
  // direttamente la variabile, quindi nei computed values cercheremo "var(--sn-accent)".
  expect(rule.bg).toMatch(/var\(--sn-accent\)|#c45a3b|196,?\s*90,?\s*59/i);
});
