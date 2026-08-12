// VERIFICA #427 (temporaneo, cancellato a fine run).
// Sintomo utente: su filo://manage/manage.html "Ctrl +" non ingrandisce;
// l'unico zoom disponibile è la modalità rotella. Richiesta: zoom ovunque
// con rotella, trackpad e Ctrl.
//
// Test BLACK-BOX: guarda lo stato reale di zoom del browser (zoomFactor del
// webContents), che è esattamente "quanto è grande la pagina" per l'utente.

import { test, expect } from './fixtures/electron.mjs';

// Legge lo zoomFactor reale della pagina il cui URL contiene `needle`.
async function zoomOf(app, needle) {
  return app.evaluate(async ({ webContents }, n) => {
    const all = webContents.getAllWebContents();
    const wc = all.find((w) => {
      try { return w.getURL().includes(n); } catch (_) { return false; }
    });
    if (!wc) return null;
    return wc.getZoomFactor();
  }, needle);
}

async function focusPage(page) {
  // Click "vero" dentro la view, come farebbe l'utente prima di premere Ctrl+.
  await page.mouse.click(300, 300).catch(() => {});
  await page.waitForTimeout(200);
}

test.describe('#427 zoom su pagine filo://', () => {
  test('Ctrl + ingrandisce la pagina Gestione (la lamentela esatta)', async ({ app, openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    const before = await zoomOf(app, 'manage');
    expect(before, 'zoomFactor iniziale leggibile').not.toBeNull();
    expect(before).toBeCloseTo(1, 2);

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+Equal');
      await page.waitForTimeout(150);
    }
    const after = await zoomOf(app, 'manage');
    console.log('[427] manage Ctrl+ :', before, '->', after);
    expect(after, 'dopo 3x Ctrl+ la pagina deve essere piu grande').toBeGreaterThan(before);
  });

  test('Ctrl - e Ctrl 0 sulla pagina Gestione', async ({ app, openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(250);
    const up = await zoomOf(app, 'manage');
    expect(up).toBeGreaterThan(1);

    await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(250);
    const down = await zoomOf(app, 'manage');
    console.log('[427] manage Ctrl- :', up, '->', down);
    expect(down).toBeLessThan(up);

    await page.keyboard.press('Control+0');
    await page.waitForTimeout(250);
    const reset = await zoomOf(app, 'manage');
    console.log('[427] manage Ctrl0 :', down, '->', reset);
    expect(reset).toBeCloseTo(1, 2);
  });

  test('Ctrl+rotella / pizzico trackpad sulla pagina Gestione', async ({ app, openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    const before = await zoomOf(app, 'manage');
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(120);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const after = await zoomOf(app, 'manage');
    console.log('[427] manage ctrl+wheel :', before, '->', after);
    expect(after, 'ctrl+rotella deve ingrandire').toBeGreaterThan(before);

    // e in giu
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(120);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const back = await zoomOf(app, 'manage');
    console.log('[427] manage ctrl+wheel giu :', after, '->', back);
    expect(back).toBeLessThan(after);
  });

  test('altre pagine filo:// (impostazioni, cronologia, home)', async ({ app, openTab }) => {
    for (const [url, needle] of [
      ['filo://options/options.html', 'options'],
      ['filo://history/history.html', 'history'],
      ['filo://newtab/', 'newtab'],
    ]) {
      const page = await openTab(url);
      await page.waitForTimeout(600);
      await focusPage(page);
      const before = await zoomOf(app, needle);
      await page.keyboard.press('Control+Equal');
      await page.keyboard.press('Control+Equal');
      await page.waitForTimeout(300);
      const after = await zoomOf(app, needle);
      console.log(`[427] ${needle} :`, before, '->', after);
      expect(after, `${url} deve zoomare con Ctrl+`).toBeGreaterThan(before);
    }
  });

  test('controllo: un sito normale zooma ancora', async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, '<h1>sito</h1><p>testo</p>');
    await page.waitForTimeout(400);
    await focusPage(page);
    const before = await zoomOf(app, '127.0.0.1');
    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(300);
    const after = await zoomOf(app, '127.0.0.1');
    console.log('[427] sito :', before, '->', after);
    expect(after).toBeGreaterThan(before);
  });
});
