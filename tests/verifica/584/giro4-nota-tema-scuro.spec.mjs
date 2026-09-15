// Verifica #584, giro 4 — la riga che avvisa «rispondendo, pubblichi» deve
// leggersi anche col tema scuro.
//
// È una riga di testo piccolo e smorzato dentro il riquadrino dell'Aiuto: se
// il colore non segue il tema, sul fondo scuro diventa testo quasi invisibile
// proprio dove l'utente sta decidendo se pubblicare i suoi passi.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

function luminanza(rgb) {
  const m = String(rgb).match(/(\d+(?:\.\d+)?)/g) || [];
  const [r, g, b] = m.slice(0, 3).map(Number);
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

async function apriRiquadro(page) {
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.renderFeedbackPrompt === 'function',
    null, { timeout: 8000 },
  );
  await page.evaluate(() => {
    window.SN_SIDEBAR.open();
    window.__filoSidebarTest.renderFeedbackPrompt();
  });
  await page.waitForSelector('.sn-sidebar-feedback', { timeout: 8000 });
}

for (const tema of ['light', 'dark']) {
  test(`col tema ${tema} la riga dell'avviso si stacca dal fondo`, async ({ app, openTab }) => {
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: t });
    }, tema);

    const page = await openTab(NEWTAB);
    await apriRiquadro(page);

    const misura = await page.evaluate(() => {
      const el = document.querySelector('.sn-sidebar-feedback-nota');
      const box = document.querySelector('.sn-sidebar-feedback');
      const sfondo = (function risali(n) {
        while (n) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(c)) return c;
          n = n.parentElement;
        }
        return 'rgb(255, 255, 255)';
      })(box);
      const r = el.getBoundingClientRect();
      return {
        testo: (el.textContent || '').trim(),
        colore: getComputedStyle(el).color,
        sfondo,
        altezza: r.height,
        larghezza: r.width,
      };
    });

    expect(misura.testo.length).toBeGreaterThan(40);
    expect(misura.altezza).toBeGreaterThan(8);
    expect(misura.larghezza).toBeGreaterThan(80);

    // Contrasto WCAG fra il testo e il fondo su cui poggia: sotto 3 la riga
    // non si legge. Non si chiede il 4.5 del testo normale perché è una nota
    // secondaria, ma sparire no.
    const a = luminanza(misura.colore);
    const b = luminanza(misura.sfondo);
    const rapporto = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(rapporto).toBeGreaterThan(3);

    await page.screenshot({ path: `tests/.shots/584-giro4-nota-${tema}.png` });
  });
}
