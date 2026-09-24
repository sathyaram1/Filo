import { test } from '../../fixtures/electron.mjs';

test('sonda: setVisible(false) rende nascosta la pagina?', async ({ app, openTab, testServer }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  const stato = async (etichetta) => {
    const v = await page.evaluate(() => ({ hidden: document.hidden, vs: document.visibilityState }));
    console.log('SONDA', etichetta, JSON.stringify(v));
  };
  await stato('subito');
  await openTab(testServer.html('<html><body>altro</body></html>'));
  await new Promise((r) => setTimeout(r, 600));
  await stato('dopo-altra-scheda');

  const esito = await app.evaluate(({ BaseWindow }) => {
    const out = [];
    for (const w of BaseWindow.getAllWindows()) {
      const scan = (v) => {
        const wc = v.webContents;
        if (wc) out.push({ url: String(wc.getURL()).slice(0, 60), visible: v.getVisible ? v.getVisible() : 'n/d' });
        for (const c of (v.children || [])) scan(c);
      };
      scan(w.contentView);
    }
    return out;
  });
  console.log('SONDA viste', JSON.stringify(esito));

  const fatto = await app.evaluate(({ BaseWindow }) => {
    for (const w of BaseWindow.getAllWindows()) {
      const scan = (v) => {
        const wc = v.webContents;
        if (wc && String(wc.getURL()).includes('manage/manage.html') && v.setVisible) {
          v.setVisible(false);
          return true;
        }
        for (const c of (v.children || [])) if (scan(c)) return true;
        return false;
      };
      if (scan(w.contentView)) return 'setVisible(false) chiamato';
    }
    return 'view di Gestione non trovata';
  });
  console.log('SONDA fatto', fatto);
  await new Promise((r) => setTimeout(r, 800));
  await stato('dopo-setVisible-false');
});
