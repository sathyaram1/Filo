// Verifica #588.5 giro 1, rilievo 3: la X dell'avviso, passandoci sopra, dice cosa fa
// (il suggerimento di Filo, come le altre icone cliccabili della barra).
import { test, expect } from '../../fixtures/electron.mjs';

test('passando sopra la X di un avviso compare il suggerimento «Chiudi»', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await vista.locator('.shell-notif-close').hover();
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const testi = [];
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs || !w.isVisible()) continue;
      try { testi.push(await w.webContents.executeJavaScript('document.body ? document.body.innerText : ""')); } catch (_) {}
    }
    return testi.join(' | ');
  }), { timeout: 4000 }).toMatch(/Chiudi/);
});
