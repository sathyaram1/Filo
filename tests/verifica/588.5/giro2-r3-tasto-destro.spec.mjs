// #588.5 giro 2, rilievo 3: il tasto destro su un avviso offre quello che si può fare con lui.
// Non presume come è fatto il menu: conta che «Apri cartella» compaia una volta in più, fuori dalla carta.
import { test, expect } from '../../fixtures/electron.mjs';

test('tasto destro sull’avviso di fine scaricamento: compare un menu con «Apri cartella»', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', {
    durationSec: 0,
    actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }],
  }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const quante = () => app.evaluate(async ({ BrowserWindow, webContents }) => {
    let n = 0;
    const conta = (t) => { n += (String(t || '').match(/Apri cartella/g) || []).length; };
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs || !w.isVisible()) continue;
      try { conta(await w.webContents.executeJavaScript('document.body ? document.body.innerText : ""')); } catch (_) {}
    }
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.getURL().includes('avvisi.html')) continue;
      try { conta(await wc.executeJavaScript('document.body ? document.body.innerText : ""')); } catch (_) {}
    }
    return n;
  });
  const prima = await quante();
  await vista.locator('.shell-notif-msg').click({ button: 'right' });
  await expect.poll(quante, { timeout: 4000 }).toBeGreaterThan(prima);
});
