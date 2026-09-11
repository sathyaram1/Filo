// Verifica #583, giro 3 — la griglia «Altro…» dopo che l'icona Feedback è
// sparita per chi i feedback non li gestisce.
//
// Togliere un'icona da una griglia è il genere di cosa che lascia un buco: una
// riga spaiata, un'icona mozzata, la griglia che non si chiude più dentro il
// menu. Chi non gestisce i feedback è la stragrande maggioranza di chi apre
// Filo, e il menu del tasto destro è il cammino principale: qui si guarda che
// la griglia stia in piedi, in tema chiaro e in tema scuro, con le icone tutte
// intere e dentro il menu.

import { test, expect } from './../../fixtures/electron.mjs';

const HTML = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';

test('la griglia «Altro…» resta intera senza l\'icona Feedback, nei due temi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  await page.locator('.sn-menu-row-overflow').first().click();

  const icone = page.locator('.sn-menu [data-sn-icon-id]');
  await expect(icone.first()).toBeVisible({ timeout: 8000 });

  // L'icona che porta alla posta delle segnalazioni non c'è: qui non c'è
  // nessun amministratore, e quella pagina non avrebbe niente da mostrare.
  await expect(page.locator('.sn-menu [data-sn-icon-id="feedbackApp"]')).toHaveCount(0);
  // Le altre ci sono tutte, Editor compreso (è la vicina di casa nella griglia:
  // se sparisse anche lei, il filtro avrebbe tagliato troppo).
  await expect(page.locator('.sn-menu [data-sn-icon-id="editorApp"]')).toHaveCount(1);
  await expect(page.locator('.sn-menu [data-sn-icon-id="openOptions"]')).toHaveCount(1);

  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForTimeout(150);

    const misure = await page.evaluate(() => {
      const menu = document.querySelector('.sn-menu');
      const box = menu.getBoundingClientRect();
      const items = Array.from(menu.querySelectorAll('[data-sn-icon-id]'));
      return {
        menu: { w: box.width, h: box.height, left: box.left, top: box.top },
        finestra: { w: window.innerWidth, h: window.innerHeight },
        icone: items.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-sn-icon-id'), w: r.width, h: r.height, left: r.left, right: r.right };
        }),
      };
    });

    // Nessuna icona di larghezza o altezza zero: un buco nella griglia si vede
    // così, ed è invisibile a un test che conti soltanto gli elementi.
    for (const ic of misure.icone) {
      expect(ic.w, `${tema}: l'icona ${ic.id} è larga zero`).toBeGreaterThan(4);
      expect(ic.h, `${tema}: l'icona ${ic.id} è alta zero`).toBeGreaterThan(4);
      // E nessuna esce dai fianchi del menu.
      expect(ic.left, `${tema}: l'icona ${ic.id} esce a sinistra dal menu`).toBeGreaterThanOrEqual(misure.menu.left - 1);
      expect(ic.right, `${tema}: l'icona ${ic.id} esce a destra dal menu`).toBeLessThanOrEqual(misure.menu.left + misure.menu.w + 1);
    }
    // Il menu resta dentro la finestra.
    expect(misure.menu.left + misure.menu.w).toBeLessThanOrEqual(misure.finestra.w + 1);

    await page.screenshot({ path: `tests/.shots/583-griglia-altro-${tema}.png` });
  }
});
