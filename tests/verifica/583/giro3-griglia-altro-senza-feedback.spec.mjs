// Verifica #583, giro 3 — la griglia «Altro…» dopo che l'icona Feedback è
// sparita per chi i feedback non li gestisce.
//
// Togliere un'icona da una griglia è il genere di cosa che lascia un buco: una
// riga spaiata, un'icona mozzata, la griglia che non si chiude più dentro il
// menu. Chi non gestisce i feedback è la stragrande maggioranza di chi apre
// Filo, e il menu del tasto destro è il cammino principale: qui si guarda che
// la griglia stia in piedi, nel tema chiaro E in quello scuro, con le icone
// tutte intere e dentro il menu.
//
// Il tema si cambia dov'è cambiabile davvero — dalle Preferenze di Filo — e non
// fingendo la preferenza del sistema operativo: il tema di Filo è una sua
// impostazione, e una pagina di prova che emula `prefers-color-scheme` resta
// chiara e fa credere di aver guardato lo scuro.

import { test, expect } from './../../fixtures/electron.mjs';

const HTML = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';

async function apriGriglia(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const griglia = page.locator('.sn-menu [data-sn-icon-id="openOptions"]');
  if (await griglia.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
  }
  await expect(page.locator('.sn-menu [data-sn-icon-id="openOptions"]')).toBeVisible({ timeout: 8000 });
}

test('la griglia «Altro…» resta intera senza l\'icona Feedback, nei due temi', async ({ openTab, testServer }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#theme', { timeout: 8000 });

  const page = await testServer.openReady(openTab, HTML);

  for (const tema of ['light', 'dark']) {
    await prefs.selectOption('#theme', tema);
    await page.waitForTimeout(300);

    await apriGriglia(page);

    // L'icona che porta alla posta delle segnalazioni non c'è: qui non c'è
    // nessun amministratore, e quella pagina non avrebbe niente da mostrare.
    await expect(page.locator('.sn-menu [data-sn-icon-id="feedbackApp"]')).toHaveCount(0);
    // Le vicine di casa nella griglia ci sono tutte: se sparissero anche loro,
    // il filtro avrebbe tagliato troppo.
    await expect(page.locator('.sn-menu [data-sn-icon-id="editorApp"]')).toHaveCount(1);
    await expect(page.locator('.sn-menu [data-sn-icon-id="home"]')).toHaveCount(1);

    const misure = await page.evaluate(() => {
      const menu = document.querySelector('.sn-menu');
      const box = menu.getBoundingClientRect();
      const griglia = menu.querySelector('.sn-menu-icon-grid') || menu;
      const items = Array.from(menu.querySelectorAll('[data-sn-icon-id]'));
      const fondo = getComputedStyle(griglia).backgroundColor;
      return {
        menu: { w: box.width, left: box.left },
        finestra: window.innerWidth,
        fondo,
        colore: items.length ? getComputedStyle(items[0]).color : '',
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
      expect(ic.left, `${tema}: l'icona ${ic.id} esce a sinistra dal menu`).toBeGreaterThanOrEqual(misure.menu.left - 1);
      expect(ic.right, `${tema}: l'icona ${ic.id} esce a destra dal menu`).toBeLessThanOrEqual(misure.menu.left + misure.menu.w + 1);
    }
    expect(misure.menu.left + misure.menu.w).toBeLessThanOrEqual(misure.finestra + 1);
    // Icone invisibili nel tema: colore uguale allo sfondo.
    expect(misure.colore, `${tema}: le icone hanno il colore dello sfondo`).not.toBe(misure.fondo);

    await page.screenshot({ path: `tests/.shots/583-griglia-altro-${tema}.png` });
    await page.keyboard.press('Escape');
  }
});
