// VERIFICA #427 (temporaneo, cancellato a fine run).
// Sintomo utente: su filo://manage/manage.html "Ctrl +" non ingrandisce;
// l'unico zoom disponibile è la modalità rotella. Richiesta: zoom ovunque
// con rotella, trackpad e Ctrl.
//
// Test BLACK-BOX. Misura lo zoom DALLA PAGINA STESSA via devicePixelRatio
// (in Chromium/Electron dPR = deviceScaleFactor * zoomFactor): evita di
// pescare il webContents sbagliato quando piu tab hanno URL simile.

import { test, expect } from './fixtures/electron.mjs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

async function focusPage(page) {
  await page.mouse.click(300, 300).catch(() => {});
  await page.waitForTimeout(200);
}

async function pressN(page, key, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
}

test.describe('#427 zoom su pagine filo://', () => {
  test('Ctrl + / - / 0 sulla pagina Gestione (la lamentela esatta)', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    const base = await z(page);
    await pressN(page, 'Control+Equal', 3);
    const up = await z(page);
    console.log('[427] manage Ctrl+ :', base, '->', up);
    expect(up, 'dopo 3x Ctrl+ la pagina deve essere piu grande').toBeGreaterThan(base);

    await pressN(page, 'Control+Minus', 1);
    const down = await z(page);
    console.log('[427] manage Ctrl- :', up, '->', down);
    expect(down).toBeLessThan(up);

    await pressN(page, 'Control+0', 1);
    const reset = await z(page);
    console.log('[427] manage Ctrl0 :', down, '->', reset);
    expect(reset).toBeCloseTo(base, 3);
  });

  test('Ctrl+rotella / pizzico trackpad sulla pagina Gestione', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    const base = await z(page);
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const up = await z(page);
    console.log('[427] manage ctrl+wheel su :', base, '->', up);
    expect(up).toBeGreaterThan(base);

    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(120); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const back = await z(page);
    console.log('[427] manage ctrl+wheel giu :', up, '->', back);
    expect(back).toBeLessThan(up);
  });

  for (const [label, url] of [
    ['impostazioni', 'filo://options/options.html'],
    ['cronologia', 'filo://history/history.html'],
    ['home/newtab', 'filo://newtab/'],
    ['dashboard', 'filo://dashboard/dashboard.html'],
    ['feedback', 'filo://feedback/feedback.html'],
  ]) {
    test(`Ctrl+ su ${label}`, async ({ openTab }) => {
      const page = await openTab(url);
      await page.waitForTimeout(700);
      await focusPage(page);
      const base = await z(page);
      await pressN(page, 'Control+Equal', 2);
      const up = await z(page);
      console.log(`[427] ${label} :`, base, '->', up);
      expect(up, `${url} deve zoomare con Ctrl+`).toBeGreaterThan(base);

      // e la rotella col Ctrl
      await page.keyboard.press('Control+0');
      await page.waitForTimeout(200);
      const b2 = await z(page);
      await page.keyboard.down('Control');
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(110); }
      await page.keyboard.up('Control');
      await page.waitForTimeout(300);
      const w = await z(page);
      console.log(`[427] ${label} wheel :`, b2, '->', w);
      expect(w, `${url} deve zoomare con ctrl+rotella`).toBeGreaterThan(b2);
    });
  }

  test('controllo: un sito normale zooma ancora', async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, '<h1>sito</h1><p>testo</p>');
    await page.waitForTimeout(400);
    await focusPage(page);
    const base = await z(page);
    await pressN(page, 'Control+Equal', 2);
    const up = await z(page);
    console.log('[427] sito :', base, '->', up);
    expect(up).toBeGreaterThan(base);
  });
});
