// #584, sesto giro — il riquadrino «Ha funzionato?» guardato, non solo misurato.
//
// Il quarto giro ha misurato il contrasto della riga che avvisa «rispondendo,
// pubblichi». Qui si guarda l'immagine: che la riga stia dove si decide, sopra
// i pulsanti, che non sbordi dal riquadro e che regga anche col testo più
// lungo. Le catture restano in tests/.shots/ come traccia del giro.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const NEWTAB = 'filo://newtab/';
const SHOTS = 'tests/.shots';

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
  test(`il riquadro che pubblica, tema ${tema}: la riga sta sopra i pulsanti e dentro il riquadro`, async ({ app, openTab }) => {
    mkdirSync(SHOTS, { recursive: true });
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: t });
    }, tema);

    const page = await openTab(NEWTAB);
    await apriRiquadro(page);

    const misure = await page.evaluate(() => {
      const box = document.querySelector('.sn-sidebar-feedback');
      const nota = document.querySelector('.sn-sidebar-feedback-nota');
      const riga = document.querySelector('.sn-sidebar-feedback-row');
      const r = (el) => { const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      return {
        testo: nota ? nota.textContent.trim() : '',
        box: r(box), nota: r(nota), riga: r(riga),
        sbordaSotto: nota.scrollHeight > nota.clientHeight + 1,
      };
    });

    await page.screenshot({ path: `${SHOTS}/584-giro6-riquadro-${tema}.png` });

    // C'è, e dice cosa succede.
    expect(misure.testo).toContain('condividi');
    // Sta sopra i pulsanti: si legge prima di scegliere, non dopo.
    expect(misure.nota.b).toBeLessThanOrEqual(misure.riga.t + 1);
    // E dentro il riquadro, in tutte e due le direzioni.
    expect(misure.nota.l).toBeGreaterThanOrEqual(misure.box.l - 1);
    expect(misure.nota.r).toBeLessThanOrEqual(misure.box.r + 1);
    expect(misure.nota.b).toBeLessThanOrEqual(misure.box.b + 1);
    expect(misure.sbordaSotto).toBe(false);
  });
}
