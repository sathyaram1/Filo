// Giro 14, rilievo 8: un indirizzo senza «https://» dal modello apre una scheda bianca.
import { test, expect } from './helpers/banco.mjs';

test('NAVIGA con un indirizzo nudo porta la scheda a quell\'indirizzo', async ({ app, shell }) => {
  await shell.waitForTimeout(1000);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    // Come fa l'azione NAVIGA con un indirizzo che non ha lo schema davanti.
    const id = w._filoTabs.openTab('libero.test/pagina', { activate: true });
    await new Promise((r) => setTimeout(r, 3000));
    const t = w._filoTabs.tabs.find((x) => x.id === id);
    return t ? t.view.webContents.getURL() : null;
  });
  expect(out).toBeTruthy();
  expect(decodeURIComponent(out)).toContain('libero.test/pagina');
});
