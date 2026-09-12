// Verifica #592, giro 1 — l'avviso del tetto si deve LEGGERE, anche al buio.
//
// Il rifiuto spiegato è l'unico posto in cui l'utente scopre perché il suo
// stile non è stato salvato: se sul tema scuro è un rosso cupo su fondo quasi
// nero, la spiegazione c'è ma non si legge, e lui resta convinto di aver
// salvato. Qui si misura il contrasto vero fra il testo e il suo sfondo.

import { test, expect } from '../../fixtures/electron.mjs';

// Contrasto WCAG fra due colori rgb().
function luminanza([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrasto(a, b) {
  const [x, y] = [luminanza(a), luminanza(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function rgb(s) {
  const m = String(s).match(/(\d+(?:\.\d+)?)/g) || [];
  return [Number(m[0] || 0), Number(m[1] || 0), Number(m[2] || 0)];
}

test('il rifiuto del tetto ha contrasto sufficiente su tema chiaro e su tema scuro', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 15_000 });
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);
  await page.fill('#agentStyleText', 'q'.repeat(max + 50));
  await expect(page.locator('#agentStyleError')).toBeVisible({ timeout: 6_000 });

  const misure = {};
  for (const tema of ['light', 'dark']) {
    await page.selectOption('#theme', tema);
    await page.waitForTimeout(500);
    const colori = await page.evaluate(() => {
      const el = document.getElementById('agentStyleError');
      const testo = getComputedStyle(el).color;
      // Lo sfondo effettivo: il primo antenato che ne dipinge uno.
      let n = el, sfondo = 'rgba(0, 0, 0, 0)';
      while (n) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { sfondo = bg; break; }
        n = n.parentElement;
      }
      return { testo, sfondo };
    });
    misure[tema] = { ...colori, contrasto: contrasto(rgb(colori.testo), rgb(colori.sfondo)) };
  }
  console.log('contrasto avviso tetto:', JSON.stringify(misure, null, 2));

  // 4.5:1 è la soglia per il testo normale: sotto, è una frase che c'è ma non
  // si legge — e questa frase è l'unica traccia del rifiuto.
  expect(misure.light.contrasto, `chiaro: ${JSON.stringify(misure.light)}`).toBeGreaterThanOrEqual(4.5);
  expect(misure.dark.contrasto, `scuro: ${JSON.stringify(misure.dark)}`).toBeGreaterThanOrEqual(4.5);
});
